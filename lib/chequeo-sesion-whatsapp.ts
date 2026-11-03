/**
 * El chequeo periódico de la sesión de WhatsApp (F32), una tarea más de
 * `correrTareas`. Hace falta además del aviso por evento porque ante una caída
 * pasajera Evolution reconecta solo y no manda `close` (criterio 2).
 *
 * Por cada canal activo de Evolution del espacio:
 *   1. Lee el token de la instancia en Vault, por el mismo camino que los
 *      adjuntos (`lib/adjuntos.ts`). Sin token no llama a Evolution: queda «no
 *      se pudo verificar» con motivo `sin_credencial`.
 *   2. `GET /instance/connectionState/{instancia}` con ese token (Evolution
 *      2.3.7 acepta el token de la instancia, `auth.guard.ts:10-50`). No trae
 *      `ownerJid`.
 *   3. Solo si el canal todavía no tiene la marca de vinculado y no leyó
 *      `open`: `GET /instance/fetchInstances?instanceName=…`, del que usa
 *      únicamente si `ownerJid` está vacío. Esa respuesta trae el token de la
 *      instancia: no se loguea ni se guarda nada de ella.
 *   4. `registrarLectura`, y el correo si la transición lo pide (acá no hay
 *      acuse que esperar: sale después de escribir).
 *
 * Cada llamada tiene 8 s: la corrida entera tiene 60 (el `curl` del servicio
 * «vigilancia-cron»). Un canal que falla no frena a los demás.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarLectura as registrarReal, type LecturaDeSesion, type Transicion } from "./sesion-whatsapp";

export const MS_POR_LLAMADA = 8_000;

export function claveDeChequeoDeSesion(workspaceId: string): string {
  return `sesion_whatsapp:${workspaceId}`;
}

interface Conexion {
  url: string;
  fetch?: typeof fetch;
}

const ESTADOS = new Set(["open", "connecting", "close", "refused"]);

function raiz(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** El estado de la sesión según Evolution. Nunca tira. */
export async function leerSesionDeEvolution(instancia: string, token: string, c: Conexion): Promise<LecturaDeSesion> {
  const f = c.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${raiz(c.url)}/instance/connectionState/${encodeURIComponent(instancia)}`, {
      headers: { apikey: token },
      signal: AbortSignal.timeout(MS_POR_LLAMADA),
    });
  } catch {
    return { tipo: "sin_verificar", motivo: "sin_respuesta" };
  }
  if (!res.ok) return { tipo: "sin_verificar", motivo: `http_${res.status}` };
  try {
    const cuerpo = (await res.json()) as { instance?: { state?: unknown } };
    const estado = cuerpo?.instance?.state;
    if (typeof estado === "string" && ESTADOS.has(estado)) {
      return { tipo: "estado", estado: estado as "open" | "connecting" | "close" | "refused" };
    }
    return { tipo: "sin_verificar", motivo: "sin_state" };
  } catch {
    return { tipo: "sin_verificar", motivo: "respuesta_ilegible" };
  }
}

/**
 * ¿Evolution tiene un `ownerJid` para la instancia? Es la tercera señal de la
 * marca (se escribe solo al pasar a `open`, B:493). Nunca tira: ante cualquier
 * duda, false. Del cuerpo se lee únicamente `ownerJid`.
 */
export async function tieneOwnerJid(instancia: string, token: string, c: Conexion): Promise<boolean> {
  const f = c.fetch ?? fetch;
  try {
    const res = await f(`${raiz(c.url)}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {
      headers: { apikey: token },
      signal: AbortSignal.timeout(MS_POR_LLAMADA),
    });
    if (!res.ok) return false;
    const cuerpo = (await res.json()) as unknown;
    const filas = Array.isArray(cuerpo) ? cuerpo : [];
    return filas.some((i) => {
      const jid = i && typeof i === "object" ? (i as { ownerJid?: unknown }).ownerJid : null;
      return typeof jid === "string" && jid.trim() !== "";
    });
  } catch {
    return false;
  }
}

export interface ResumenDeSesion {
  canales: Array<{ id: string; lectura: string; estado: string | null; error: string | null }>;
}

export async function chequearSesionesDelEspacio({
  servicio,
  workspaceId,
  ahora,
  leerToken,
  leerEstado,
  leerOwnerJid,
  registrar = registrarReal,
  notificar,
}: {
  servicio: SupabaseClient;
  workspaceId: string;
  ahora: Date;
  leerToken: (servicio: SupabaseClient, workspaceId: string, canalId: string) => Promise<string | null>;
  leerEstado: (instancia: string, token: string) => Promise<LecturaDeSesion>;
  leerOwnerJid: (instancia: string, token: string) => Promise<boolean>;
  registrar?: typeof registrarReal;
  notificar: (t: Transicion, o: { servicio: SupabaseClient }) => Promise<unknown>;
}): Promise<ResumenDeSesion> {
  const { data, error } = await servicio
    .from("channels")
    .select("id, instance_name, session_linked_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "evolution")
    .eq("is_active", true);
  if (error) throw new Error(`channels: ${error.message}`);

  const resumen: ResumenDeSesion = { canales: [] };
  for (const canal of (data ?? []) as Array<{ id: string; instance_name: string | null; session_linked_at: string | null }>) {
    let lectura: LecturaDeSesion = { tipo: "sin_verificar", motivo: "sin_instancia" };
    try {
      let ownerJid = false;
      const token = canal.instance_name ? await leerToken(servicio, workspaceId, canal.id) : null;
      if (!canal.instance_name) {
        lectura = { tipo: "sin_verificar", motivo: "sin_instancia" };
      } else if (!token) {
        lectura = { tipo: "sin_verificar", motivo: "sin_credencial" };
      } else {
        lectura = await leerEstado(canal.instance_name, token);
        if (canal.session_linked_at === null && lectura.tipo === "estado" && lectura.estado !== "open") {
          ownerJid = await leerOwnerJid(canal.instance_name, token);
        }
      }
      const t = await registrar(servicio, canal.id, lectura, ahora, ownerJid);
      if (t?.avisar) await notificar(t, { servicio });
      resumen.canales.push({ id: canal.id, lectura: textoDeLectura(lectura), estado: t?.a ?? null, error: null });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : "error";
      console.error(`[sesion] canal ${canal.id}:`, motivo);
      resumen.canales.push({ id: canal.id, lectura: textoDeLectura(lectura), estado: null, error: motivo });
    }
  }
  return resumen;
}

function textoDeLectura(l: LecturaDeSesion): string {
  return l.tipo === "estado" ? l.estado : l.motivo;
}
