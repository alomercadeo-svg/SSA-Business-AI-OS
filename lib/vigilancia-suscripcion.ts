/**
 * La suscripción del webhook de Zernio, vigilada por F39.
 *
 * La marca del último entrante contesta «¿llegó algo?». Esto contesta otra
 * cosa: «¿dejó de llegar un tipo de aviso mientras los demás siguen?». Si a la
 * suscripción le falta `message.sent`, los leads siguen escribiendo, la marca
 * sigue fresca y la revisión de silencio sigue callada, mientras desaparecen
 * las respuestas escritas desde la app (plano, nota de F39).
 *
 * Lee la suscripción con `leerWebhook` (`lib/integraciones-estado.ts`), el mismo
 * camino que la pantalla de Integraciones, y la compara contra `WEBHOOK_EVENTS`.
 * - Si falta alguno, abre `suscripcion_incompleta` nombrando cuál.
 * - Se cierra cuando la lista vuelve a estar completa.
 * - Si la lectura falla, no abre ni cierra nada: guarda el error y la pantalla
 *   lo dice. Una lectura fallida nunca se muestra como completa.
 *
 * El secreto de firma que trae la respuesta no entra al resultado, ni siquiera
 * su máscara: el resultado se guarda en `tareas_estado.resultado`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEBHOOK_EVENTS } from "./zernio-webhook";
import type { EstadoWebhook } from "./integraciones";
import { abrirOSumar, cerrar, type Auditar, type Notificar } from "./vigilancia-canales";

export const CONDICION_SUSCRIPCION = "suscripcion_incompleta";
export const FUENTE_SUSCRIPCION = "zernio";

export interface ResultadoSuscripcion {
  leida_el: string | null;
  registrado: boolean;
  activo: boolean | null;
  eventos: string[];
  faltan: string[];
  error: string | null;
  alerta: "abierta" | "sigue" | "cerrada" | "ninguna" | "sin_leer";
}

export function eventosFaltantes(eventos: readonly string[]): string[] {
  return WEBHOOK_EVENTS.filter((e) => !eventos.includes(e));
}

export async function revisarSuscripcion({
  servicio,
  workspaceId,
  leer,
  notificar,
  auditar,
}: {
  servicio: SupabaseClient;
  workspaceId: string;
  /** `leerWebhook` con el cliente de Zernio del espacio. */
  leer: () => Promise<EstadoWebhook>;
  notificar: Notificar;
  auditar: Auditar;
}): Promise<ResultadoSuscripcion> {
  const w = await leer();
  const base = { leida_el: w.verificado_el, registrado: w.registrado, activo: w.activo, eventos: w.eventos };

  if (w.error) return { ...base, faltan: [], error: w.error, alerta: "sin_leer" };

  // Sin nuestro webhook registrado, faltan todos.
  const faltan = eventosFaltantes(w.registrado ? w.eventos : []);
  if (faltan.length === 0) {
    const cerro = await cerrar(servicio, FUENTE_SUSCRIPCION, CONDICION_SUSCRIPCION, workspaceId);
    return { ...base, faltan, error: null, alerta: cerro ? "cerrada" : "ninguna" };
  }

  const alerta = await abrirOSumar(
    servicio,
    { source: FUENTE_SUSCRIPCION, condition: CONDICION_SUSCRIPCION, workspaceId, channelId: null, detail: `Falta: ${faltan.join(", ")}` },
    notificar,
    auditar,
  );
  return { ...base, faltan, error: null, alerta };
}

/**
 * Qué dice la pestaña Vigilancia de canales sobre la suscripción. `null` es que
 * todavía no se leyó; `"sin_clave"`, que el espacio no tiene clave de Zernio.
 */
export function textoDeSuscripcion(r: ResultadoSuscripcion | null | "sin_clave"): {
  titulo: string;
  tono: "ok" | "error" | "neutro";
} {
  if (r === "sin_clave") return { titulo: "Este espacio no tiene clave de Zernio: no hay suscripción que vigilar.", tono: "neutro" };
  if (!r) return { titulo: "La suscripción todavía no se leyó.", tono: "neutro" };
  if (r.error) return { titulo: `No se pudo leer la suscripción: ${r.error}`, tono: "error" };
  if (r.faltan.length > 0) return { titulo: `Avisos de Instagram suscritos: falta ${r.faltan.join(", ")}`, tono: "error" };
  return { titulo: "Avisos de Instagram suscritos: completos", tono: "ok" };
}
