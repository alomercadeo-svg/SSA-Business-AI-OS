/**
 * La purga diaria del borrado suave (F30): borra definitivamente lo que lleva
 * más de 30 días eliminado, en cascada. La corre `correrTareas`
 * (`lib/tareas-programadas.ts`) por espacio, una vez cada 24 horas.
 *
 * QUÉ BORRA. Los contactos eliminados hace más de 30 días, y con ellos (por
 * las claves en cascada) sus conversaciones, mensajes, canales del contacto,
 * etiquetas, campos propios y notas; las conversaciones eliminadas hace más de
 * 30 días que quedaran sueltas; y las notas eliminadas hace más de 30 días.
 * `whatsapp_adjuntos_por_bajar` se va con su mensaje (00035).
 *
 * LOS ARCHIVOS PRIMERO. Ninguna cascada de la base alcanza `message-media`
 * (nota de la sesión 2, tramo 4). §9: «si el contacto se purga a los 30 días
 * de eliminado, sus archivos también». Se juntan los `media_path` de los
 * mensajes que se van, se borran de Storage, y recién después las filas. Si
 * Storage falla, no se borra ninguna fila: la purga tira, queda el error en su
 * marca, y la del otro día lo vuelve a intentar con las mismas rutas. Al revés
 * quedarían archivos que ya nadie puede encontrar.
 *
 * `audit_log` NO se toca: no tiene claves foráneas (00028) y su trigger impide
 * borrarlo. El historial de lo purgado queda para siempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_DE_ADJUNTOS } from "./adjuntos";
import { DIAS_DE_RETENCION } from "./borrado";

/** Una corrida diaria basta; la marca se pone en rojo a las 25 horas (`lib/tareas-estado.ts`). */
export const HORAS_ENTRE_PURGAS = 24;

/** Ids por pedido, para que la dirección de PostgREST no se haga demasiado larga. */
const LOTE = 100;

/**
 * Filas por página al leer. PostgREST devuelve como máximo `max_rows` filas por
 * pedido (1000 por defecto en Supabase; no se verificó el valor de este
 * proyecto), así que se lee por páginas hasta que una venga incompleta.
 */
const PAGINA = 1000;

export function claveDePurga(workspaceId: string): string {
  return `purga_eliminados:${workspaceId}`;
}

export interface AlmacenParaPurgar {
  /** Borra estas rutas del bucket. Tira si no pudo. */
  borrar(rutas: string[]): Promise<void>;
}

export function almacenParaPurgar(servicio: SupabaseClient): AlmacenParaPurgar {
  return {
    async borrar(rutas) {
      const { error } = await servicio.storage.from(BUCKET_DE_ADJUNTOS).remove(rutas);
      if (error) throw new Error(`message-media: ${error.message}`);
    },
  };
}

export interface ResumenDePurga {
  contactos: number;
  conversaciones: number;
  notas: number;
  archivos: number;
}

/** El instante antes del cual lo eliminado ya se purga. */
export function corteDePurga(ahora: Date): string {
  return new Date(ahora.getTime() - DIAS_DE_RETENCION * 86_400_000).toISOString();
}

/** ¿Toca correr? Sí si nunca terminó bien, o si la última buena tiene más de 24 horas. */
export function tocaPurgar(ultimoOk: string | null | undefined, ahora: Date): boolean {
  if (!ultimoOk) return true;
  return ahora.getTime() - new Date(ultimoOk).getTime() >= HORAS_ENTRE_PURGAS * 3_600_000;
}

function lotes<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) out.push(xs.slice(i, i + LOTE));
  return out;
}

type Consulta = { range(a: number, b: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Todas las filas de una consulta ordenada, página por página. */
async function todas<T>(armar: () => Consulta, que: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armar().range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${que}: ${error.message}`);
    const pagina = (data ?? []) as T[];
    filas.push(...pagina);
    if (pagina.length < PAGINA) return filas;
  }
}

async function ids(armar: () => Consulta, que: string): Promise<string[]> {
  return (await todas<{ id: string }>(armar, que)).map((f) => f.id);
}

export async function purgarEspacio({
  servicio,
  workspaceId,
  ahora,
  almacen,
}: {
  servicio: SupabaseClient;
  workspaceId: string;
  ahora: Date;
  almacen: AlmacenParaPurgar;
}): Promise<ResumenDePurga> {
  const corte = corteDePurga(ahora);

  const contactos = await ids(
    () => servicio.from("contacts").select("id").eq("workspace_id", workspaceId).lt("deleted_at", corte).order("id"),
    "contacts",
  );
  const convDeContactos: string[] = [];
  for (const l of lotes(contactos)) {
    convDeContactos.push(...(await ids(() => servicio.from("conversations").select("id").in("contact_id", l).order("id"), "conversations")));
  }
  const convSueltas = await ids(
    () => servicio.from("conversations").select("id").eq("workspace_id", workspaceId).lt("deleted_at", corte).order("id"),
    "conversations",
  );
  const conversaciones = [...new Set([...convDeContactos, ...convSueltas])];

  // 1. Los archivos.
  const rutas: string[] = [];
  for (const l of lotes(conversaciones)) {
    const filas = await todas<{ media_path: string }>(
      () => servicio.from("messages").select("media_path").in("conversation_id", l).not("media_path", "is", null).order("id"),
      "messages",
    );
    rutas.push(...filas.map((m) => m.media_path));
  }
  for (const l of lotes(rutas)) await almacen.borrar(l);

  // 2. Las filas. Las conversaciones primero (sus mensajes, en cascada), después
  // los contactos (lo demás, en cascada) y las notas sueltas. El borrado repite
  // la condición: un lead que escribió entre la lectura y acá ya se restauró
  // (`deleted_at` vacío) y no se borra. Sus archivos sí se fueron en el paso 1:
  // esa carrera queda abierta, anotada en docs/estado-fase1.md.
  for (const l of lotes(conversaciones)) {
    const { error } = await servicio.from("conversations").delete().in("id", l).lt("deleted_at", corte);
    if (error) throw new Error(`conversations: ${error.message}`);
  }
  for (const l of lotes(contactos)) {
    const { error } = await servicio.from("contacts").delete().in("id", l).lt("deleted_at", corte);
    if (error) throw new Error(`contacts: ${error.message}`);
  }
  const { data: notas, error: errNotas } = await servicio
    .from("contact_notes")
    .delete()
    .eq("workspace_id", workspaceId)
    .lt("deleted_at", corte)
    .select("id");
  if (errNotas) throw new Error(`contact_notes: ${errNotas.message}`);

  return {
    contactos: contactos.length,
    conversaciones: conversaciones.length,
    notas: (notas ?? []).length,
    archivos: rutas.length,
  };
}
