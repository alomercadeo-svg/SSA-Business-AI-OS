/**
 * Procesamiento de los eventos de Evolution.
 *
 * Hasta el 08/10/2026 era un stub que solo registraba un resumen: la frontera
 * entre el Bloque 2 (la cañería) y el Bloque 3. Con F27 tiene dos mitades:
 *
 *   - `guardarEventoEvolution`, ANTES del acuse: los mensajes (contacto,
 *     conversación y mensaje, solo escrituras en la base). Si falla, el
 *     receptor libera el reclamo y responde 500, y Evolution reintenta.
 *   - `procesarEventoEvolution`, DESPUÉS del acuse: los avisos de contacto
 *     (vía 2 de F26) y el resumen en el log.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ El número de WhatsApp sigue sin vincularse: la compuerta son F27 **y     │
 * │ F32** (§4.7 del plano). F27 guarda; F32 avisa cuando la sesión se cae y  │
 * │ permite volver a vincular. F32 es del Bloque 4.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ningún log de acá escribe el cuerpo del aviso: trae la API key de la
 * instancia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaveMensaje } from "@/lib/evolution-webhook";
import {
  EVENTOS_CON_MENSAJES,
  EVENTOS_DE_CONTACTO,
  guardarMensajesDeEvolution,
  normalizarEvento,
  procesarAvisoDeContacto,
  type MensajeEvolution,
} from "@/lib/evolution-guardado";

export interface MensajeEntrante {
  key?: ClaveMensaje;
  messageType?: string;
  /** Unix en SEGUNDOS, no milisegundos. La conversión la hace F27 al guardar. */
  messageTimestamp?: number;
}

export interface EventoEvolution {
  supabase: SupabaseClient;
  canal: { id: string; workspace_id: string; platform: string };
  /** `messages.upsert`, `messages.set`, `connection.update`, etc. */
  evento: string;
  instancia: string;
  /** Ya filtrados por idempotencia: acá no llegan repetidos. */
  mensajes: MensajeEntrante[];
}

/** ¿Este evento trae mensajes que hay que guardar antes del acuse? */
export function traeMensajes(evento: string): boolean {
  return EVENTOS_CON_MENSAJES.has(normalizarEvento(evento));
}

/**
 * Guarda los mensajes de un evento ya autenticado y sin duplicados. Corre
 * ANTES del acuse; tira si no pudo guardar.
 */
export async function guardarEventoEvolution(evento: EventoEvolution): Promise<void> {
  if (!traeMensajes(evento.evento)) return;
  await guardarMensajesDeEvolution(
    evento.supabase,
    evento.canal,
    evento.evento,
    evento.mensajes as MensajeEvolution[],
  );
}

/**
 * Lo que va después del acuse: los avisos de contacto y el resumen. El resumen
 * es pobre en datos a propósito (evento, instancia, cantidad y tipos): alcanza
 * para responder "¿está entrando algo?" sin ser un canal de fuga.
 */
export async function procesarEventoEvolution(evento: EventoEvolution & { data?: unknown }): Promise<void> {
  const nombre = normalizarEvento(evento.evento);
  let reconciliados = 0;
  if (EVENTOS_DE_CONTACTO.has(nombre)) {
    reconciliados = await procesarAvisoDeContacto(evento.supabase, evento.canal, evento.data);
  }
  const tipos = [...new Set(evento.mensajes.map((m) => m.messageType ?? "desconocido"))];
  console.log(
    `[evolution] evento=${evento.evento} instancia=${evento.instancia} ` +
    `canal=${evento.canal.id} mensajes=${evento.mensajes.length}` +
    (tipos.length > 0 && traeMensajes(evento.evento) ? ` tipos=${tipos.join(",")}` : "") +
    (EVENTOS_DE_CONTACTO.has(nombre) ? ` reconciliados=${reconciliados}` : ""),
  );
}
