/**
 * La descarga de adjuntos (F28): el archivo que manda un lead se baja al
 * recibirlo y se guarda en el bucket privado `message-media` (migración 00034).
 *
 * ── QUÉ SE BAJA ─────────────────────────────────────────────────────────────
 *
 * Solo los ENTRANTES con un adjunto de archivo (imagen, audio, video,
 * documento, sticker) que el RECEPTOR marcó al guardarlos (`media_intentos` en
 * 0). Los históricos —importados o anteriores a F28— tienen `media_intentos`
 * nulo y nada de este archivo los toca: son de la parte B. Los `share`,
 * `template` y `ephemeral` de Instagram caen en el tipo `otro` y no se marcan.
 *
 * ── LA CARRERA ENTRE EL RECEPTOR Y EL REINTENTO ──────────────────────────────
 *
 * Los dos pueden intentar la misma fila: el `after()` del receptor y el
 * reintento de las tareas programadas. Cada intento:
 *   1. TOMA la fila subiendo `media_intentos` de n a n+1, solo si sigue en n y
 *      en `pendiente` o `fallido`. Si otro la tomó antes, no hace nada.
 *   2. Baja, con un tiempo máximo (`TIEMPO_MAXIMO_DE_DESCARGA_MS`, 60 s), menor
 *      que la espera del reintento (`ESPERA_DEL_REINTENTO_MS`, 2 min, contada
 *      desde `media_reclamado_at`).
 *   3. ESCRIBE el resultado solo si `media_intentos` sigue en n+1 y el estado
 *      sigue en `pendiente` o `fallido`. Si otro intento la tomó en el medio,
 *      no escribe nada. Así un intento lento no pisa a uno más nuevo, y un
 *      `descargado` no vuelve nunca a `fallido`.
 *
 * ── EL TIPO REAL ─────────────────────────────────────────────────────────────
 *
 * Sale de los primeros bytes (`lib/adjuntos-formatos.ts`), no de la extensión
 * ni de lo que diga el proveedor. Lo que no está en la lista no se guarda.
 *
 * Nunca se registra el contenido del mensaje ni la dirección del proveedor:
 * los errores van como un código corto en `media_error`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectarFormato, BYTES_PARA_DETECTAR } from "./adjuntos-formatos";

export const BUCKET_DE_ADJUNTOS = "message-media";
export const TECHO_DE_INTENTOS = 5;
export const ESPERA_DEL_REINTENTO_MS = 2 * 60 * 1000;
export const TIEMPO_MAXIMO_DE_DESCARGA_MS = 60 * 1000;
export const ADJUNTOS_POR_CORRIDA = 20;
const TAMANO_MAXIMO_POR_DEFECTO_MB = 25;

const TIPOS_CON_ARCHIVO = new Set(["imagen", "audio", "video", "documento", "sticker"]);

/** ¿El receptor tiene que marcar este mensaje para bajar su archivo? */
export function seDescarga(m: { direction: string; messageType: string; attachments: readonly unknown[] | null }): boolean {
  return m.direction === "inbound" && TIPOS_CON_ARCHIVO.has(m.messageType) && (m.attachments?.length ?? 0) > 0;
}

/** `ADJUNTOS_TAMANO_MAXIMO_MB`, o 25 MB si no está o no es un número positivo. */
export function tamanoMaximoEnBytes(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.ADJUNTOS_TAMANO_MAXIMO_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : TAMANO_MAXIMO_POR_DEFECTO_MB) * 1024 * 1024;
}

// ── El acceso a la base y a Storage ─────────────────────────────────────────

export interface FilaDeAdjunto {
  id: string;
  conversation_id: string;
  workspace_id: string;
  direction: string;
  attachments: unknown;
  media_status: string | null;
  media_intentos: number | null;
}

export type Cierre =
  | { media_status: "descargado"; media_path: string; media_mime: string; media_bytes: number; media_error: null }
  | { media_status: "fallido" | "no_disponible"; media_error: string };

/** Lo que la descarga necesita de afuera. En producción, Supabase y `fetch`. */
export interface Almacen {
  leer(id: string): Promise<FilaDeAdjunto | null>;
  /** Sube los intentos de `desde` a `desde + 1`, solo si siguen en `desde` y el estado es pendiente o fallido. */
  tomar(id: string, desde: number, ahora: Date): Promise<boolean>;
  /** Escribe el resultado solo si los intentos siguen en `tomado` y el estado es pendiente o fallido. */
  cerrar(id: string, tomado: number, cierre: Cierre): Promise<boolean>;
  subir(ruta: string, datos: Uint8Array, mime: string): Promise<{ error: string | null }>;
  /** Los que el reintento puede tomar. */
  porReintentar(ahora: Date, limite: number): Promise<string[]>;
}

export function almacenDeSupabase(servicio: SupabaseClient): Almacen {
  const ESTADOS_ABIERTOS = ["pendiente", "fallido"];
  return {
    async leer(id) {
      const { data, error } = await servicio
        .from("messages")
        .select("id, conversation_id, direction, attachments, media_status, media_intentos, conversations(workspace_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`messages: ${error.message}`);
      if (!data) return null;
      const d = data as unknown as Omit<FilaDeAdjunto, "workspace_id"> & { conversations: { workspace_id: string } | null };
      if (!d.conversations?.workspace_id) return null;
      return { ...d, workspace_id: d.conversations.workspace_id };
    },
    async tomar(id, desde, ahora) {
      const { data, error } = await servicio
        .from("messages")
        .update({ media_intentos: desde + 1, media_reclamado_at: ahora.toISOString() })
        .eq("id", id)
        .eq("media_intentos", desde)
        .in("media_status", ESTADOS_ABIERTOS)
        .select("id");
      if (error) throw new Error(`messages: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async cerrar(id, tomado, cierre) {
      const { data, error } = await servicio
        .from("messages")
        .update(cierre)
        .eq("id", id)
        .eq("media_intentos", tomado)
        .in("media_status", ESTADOS_ABIERTOS)
        .select("id");
      if (error) throw new Error(`messages: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async subir(ruta, datos, mime) {
      const { error } = await servicio.storage
        .from(BUCKET_DE_ADJUNTOS)
        .upload(ruta, datos, { contentType: mime, upsert: true });
      return { error: error ? error.message : null };
    },
    async porReintentar(ahora, limite) {
      const antesDe = new Date(ahora.getTime() - ESPERA_DEL_REINTENTO_MS).toISOString();
      const { data, error } = await servicio
        .from("messages")
        .select("id")
        .not("media_intentos", "is", null)
        .lt("media_intentos", TECHO_DE_INTENTOS)
        .in("media_status", ESTADOS_ABIERTOS)
        .eq("direction", "inbound")
        .or(`media_reclamado_at.is.null,media_reclamado_at.lt.${antesDe}`)
        .order("created_at", { ascending: true })
        .limit(limite);
      if (error) throw new Error(`messages: ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).map((f) => f.id);
    },
  };
}

// ── La descarga ─────────────────────────────────────────────────────────────

export interface OpcionesDeDescarga {
  almacen: Almacen;
  bajar?: typeof fetch;
  ahora?: () => Date;
  tamanoMaximo?: number;
  tiempoMaximoMs?: number;
}

export type ResultadoDeDescarga = "descargado" | "fallido" | "no_disponible" | "omitido" | "tomado_por_otro" | "pisado";

class FalloDeDescarga extends Error {
  constructor(readonly codigo: string, readonly definitivo: boolean) {
    super(codigo);
  }
}

function direccionDelAdjunto(attachments: unknown): string | null {
  const primero = Array.isArray(attachments) ? (attachments[0] as { url?: unknown } | undefined) : undefined;
  return typeof primero?.url === "string" && /^https?:\/\//.test(primero.url) ? primero.url : null;
}

/** Baja el cuerpo cortando apenas pasa el máximo: no confía solo en `Content-Length`. */
async function leerConTecho(res: Response, maximo: number): Promise<Uint8Array> {
  const declarado = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maximo) throw new FalloDeDescarga("excede_tamano", true);
  if (!res.body) throw new FalloDeDescarga("sin_cuerpo", false);
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await lector.cancel().catch(() => {});
      throw new FalloDeDescarga("excede_tamano", true);
    }
    partes.push(value);
  }
  const todo = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    todo.set(p, i);
    i += p.byteLength;
  }
  return todo;
}

export async function descargarAdjunto(id: string, o: OpcionesDeDescarga): Promise<ResultadoDeDescarga> {
  const { almacen } = o;
  const ahora = o.ahora ?? (() => new Date());
  const bajar = o.bajar ?? fetch;
  const maximo = o.tamanoMaximo ?? tamanoMaximoEnBytes();
  const tiempo = o.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_DESCARGA_MS;

  const fila = await almacen.leer(id);
  if (
    !fila ||
    fila.media_intentos === null ||
    fila.direction !== "inbound" ||
    (fila.media_status !== "pendiente" && fila.media_status !== "fallido") ||
    fila.media_intentos >= TECHO_DE_INTENTOS
  ) {
    return "omitido";
  }

  const desde = fila.media_intentos;
  if (!(await almacen.tomar(id, desde, ahora()))) return "tomado_por_otro";
  const tomado = desde + 1;

  try {
    const url = direccionDelAdjunto(fila.attachments);
    if (!url) throw new FalloDeDescarga("sin_direccion", true);

    let res: Response;
    try {
      res = await bajar(url, { signal: AbortSignal.timeout(tiempo), redirect: "follow" });
    } catch (err) {
      const nombre = (err as { name?: string })?.name;
      throw new FalloDeDescarga(nombre === "TimeoutError" || nombre === "AbortError" ? "tiempo_agotado" : "red", false);
    }
    if (!res.ok) throw new FalloDeDescarga(`http_${res.status}`, false);

    let datos: Uint8Array;
    try {
      datos = await leerConTecho(res, maximo);
    } catch (err) {
      if (err instanceof FalloDeDescarga) throw err;
      throw new FalloDeDescarga("tiempo_agotado", false);
    }

    const formato = detectarFormato(datos.subarray(0, BYTES_PARA_DETECTAR));
    if (!formato) throw new FalloDeDescarga("tipo_no_permitido", true);

    const ruta = `${fila.workspace_id}/${fila.conversation_id}/${fila.id}/archivo.${formato.ext}`;
    const subida = await almacen.subir(ruta, datos, formato.mime);
    if (subida.error) throw new FalloDeDescarga("subida", false);

    const escrito = await almacen.cerrar(id, tomado, {
      media_status: "descargado",
      media_path: ruta,
      media_mime: formato.mime,
      media_bytes: datos.byteLength,
      media_error: null,
    });
    return escrito ? "descargado" : "pisado";
  } catch (err) {
    const fallo = err instanceof FalloDeDescarga ? err : new FalloDeDescarga("error", false);
    const estado = fallo.definitivo || tomado >= TECHO_DE_INTENTOS ? "no_disponible" : "fallido";
    const escrito = await almacen.cerrar(id, tomado, { media_status: estado, media_error: fallo.codigo });
    return escrito ? estado : "pisado";
  }
}

// ── El reintento ────────────────────────────────────────────────────────────

export interface ResumenDeReintento {
  revisados: number;
  descargados: number;
  fallidos: number;
  noDisponibles: number;
  errores: number;
}

/**
 * Una pasada del reintento: toma hasta `ADJUNTOS_POR_CORRIDA` adjuntos que el
 * receptor marcó y que siguen sin bajar, y los intenta de a uno. Un error en
 * uno no corta a los demás.
 */
export async function reintentarAdjuntos(o: OpcionesDeDescarga & { ahoraFijo: Date }): Promise<ResumenDeReintento> {
  const ids = await o.almacen.porReintentar(o.ahoraFijo, ADJUNTOS_POR_CORRIDA);
  const r: ResumenDeReintento = { revisados: ids.length, descargados: 0, fallidos: 0, noDisponibles: 0, errores: 0 };
  for (const id of ids) {
    try {
      const res = await descargarAdjunto(id, o);
      if (res === "descargado") r.descargados += 1;
      if (res === "fallido") r.fallidos += 1;
      if (res === "no_disponible") r.noDisponibles += 1;
    } catch (err) {
      r.errores += 1;
      console.error("[adjuntos] reintento:", err instanceof Error ? err.message : "error");
    }
  }
  return r;
}
