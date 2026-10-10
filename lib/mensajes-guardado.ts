/**
 * El guardado de mensajes en `messages` (F27): un solo camino para Instagram y
 * WhatsApp. Cada proveedor tiene su adaptador, que traduce el aviso a
 * `MensajeParaGuardar`; de acá para abajo no hay condicionales por plataforma.
 *
 * ── LA UNICIDAD ─────────────────────────────────────────────────────────────
 *
 * Un mensaje es (conversación, identificador del proveedor, dirección): la
 * restricción `messages_mensaje_unico` de la 00032. Los dos caminos de entrada
 * —el aviso del proveedor y la importación del historial— pueden traer el mismo
 * mensaje, y también el echo de lo que se envía desde la bandeja. Se guarda con
 * `upsert ... ignoreDuplicates`, así que el segundo no hace nada.
 *
 * Por qué `onConflict` nombra las tres columnas y por qué es una restricción y
 * no un índice parcial: PostgREST solo encuentra restricciones, y Postgres no
 * infiere un índice parcial sin su predicado. Probado el 08/10/2026 contra la
 * base, con tablas temporales (ver la cabecera de la 00032).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { seDescarga } from "./adjuntos";

export const CONFLICTO_DE_MENSAJE = "conversation_id,platform_message_id,direction";

export type TipoDeMensaje =
  | "texto"
  | "imagen"
  | "audio"
  | "documento"
  | "video"
  | "sticker"
  | "ubicacion"
  | "otro";

/** Lo mínimo de un adjunto que el servidor guarda. Nunca viaja al navegador tal cual. */
export interface AdjuntoCrudo {
  type?: string;
  url?: string;
  [clave: string]: unknown;
}

export interface MensajeParaGuardar {
  conversationId: string;
  direction: "inbound" | "outbound";
  /** Identificador del proveedor. Nulo solo en envíos que fallaron. */
  platformMessageId: string | null;
  text: string | null;
  attachments: AdjuntoCrudo[] | null;
  messageType: TipoDeMensaje;
  quotedMessageId: string | null;
  /** El identificador del chat tal como llegó (F26). */
  remoteJid: string | null;
  /** Fecha del proveedor, en ISO. */
  createdAt: string;
  sentByUserId?: string | null;
}

/** Tipo a partir de los adjuntos que manda el proveedor. Sin adjunto, texto. */
export function tipoPorAdjuntos(adjuntos: readonly AdjuntoCrudo[] | null | undefined): TipoDeMensaje {
  const tipo = adjuntos?.[0]?.type?.toLowerCase();
  if (!tipo) return "texto";
  if (tipo.startsWith("image") || tipo === "photo") return "imagen";
  if (tipo.startsWith("video")) return "video";
  if (tipo.startsWith("audio")) return "audio";
  if (tipo === "file" || tipo.startsWith("document")) return "documento";
  if (tipo.startsWith("sticker")) return "sticker";
  if (tipo === "location") return "ubicacion";
  return "otro";
}

/**
 * `marcarDescarga` lo pasa SOLO el receptor (F28): pone `media_intentos` en 0
 * en los entrantes con archivo, que es lo que el reintento busca. La
 * importación no lo pasa, así que lo que trae queda en nulo y no se baja.
 */
function fila(m: MensajeParaGuardar, opciones: { marcarDescarga?: boolean } = {}) {
  const conAdjunto = (m.attachments?.length ?? 0) > 0;
  return {
    ...(opciones.marcarDescarga && seDescarga(m) ? { media_intentos: 0 } : {}),
    conversation_id: m.conversationId,
    direction: m.direction,
    platform_message_id: m.platformMessageId,
    text: m.text,
    attachments: conAdjunto ? m.attachments : null,
    message_type: m.messageType,
    quoted_message_id: m.quotedMessageId,
    remote_jid: m.remoteJid,
    media_status: conAdjunto ? "pendiente" : null,
    status: "sent",
    created_at: m.createdAt,
    ...(m.sentByUserId ? { sent_by_user_id: m.sentByUserId } : {}),
  };
}

/**
 * Guarda los mensajes; los que ya están no se tocan. Devuelve el error de la
 * base, si hubo: el que llama decide (el receptor libera el reclamo y responde
 * 500 para que el proveedor reintente).
 */
export async function guardarMensajes(
  supabase: SupabaseClient,
  mensajes: readonly MensajeParaGuardar[],
  opciones: { marcarDescarga?: boolean } = {},
): Promise<{ error: { message: string; code?: string } | null }> {
  if (mensajes.length === 0) return { error: null };
  const { error } = await supabase
    .from("messages")
    .upsert(mensajes.map((m) => fila(m, opciones)), { onConflict: CONFLICTO_DE_MENSAJE, ignoreDuplicates: true });
  return { error: error ? { message: error.message, code: error.code } : null };
}

/**
 * El envío desde la bandeja. Si el echo del proveedor llegó primero, la fila ya
 * existe sin autor: este upsert le completa `sent_by_user_id` en vez de
 * duplicarla.
 */
export async function guardarEnvioDeLaBandeja(
  supabase: SupabaseClient,
  mensaje: MensajeParaGuardar & { sentByUserId: string },
): Promise<{ id: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("messages")
    .upsert(fila(mensaje), { onConflict: CONFLICTO_DE_MENSAJE })
    .select("id")
    .single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error ? { message: error.message } : null };
}
