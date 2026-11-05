/**
 * La ventana de conversación de Instagram (F40, S9 tramo A, 05/11/2026).
 *
 * Meta deja que el sistema le envíe al lead solo dentro de las 24 horas desde
 * el último mensaje del lead. `conversations.window_expires_at` (00048) guarda
 * hasta cuándo. Sin "use client": la usan los receptores, la ruta del envío,
 * la ficha y la bandeja.
 *
 * QUÉ HORA CUENTA. La de Meta (`sentAt`, que el receptor guarda como
 * `messages.created_at`, lib/zernio-aviso.ts:131), no la de recepción: Meta
 * cuenta desde su hora, y la recepción siempre llega después (unos 3 s en el
 * aviso real, lib/fixtures/zernio-webhook-message-received.json; minutos si
 * Zernio reintenta). Contar desde la recepción haría decir «abierta» cuando
 * Meta ya la cerró. Si `sentAt` viene en el futuro, se usa la hora de ahora:
 * un reloj adelantado no alarga la ventana.
 *
 * SOLO ADELANTA. Un reintento, o un mensaje del lead más viejo que llega
 * después, no la atrasa. Lo que escribe el negocio (el echo, el envío desde la
 * bandeja, los flujos, los comentarios) no la mueve: no se llama.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const HORA_MS = 60 * 60 * 1000;
/** El corte de «por vencer»: el mismo de la 00048 y del filtro de F35. */
export const POR_VENCER_MS = 2 * HORA_MS;

/**
 * La ventana de cada canal, por proveedor y plataforma (decidido por Marcos
 * el 05/11/2026, D3): una tabla en el código y no una columna de `channels`,
 * porque la regla es de Meta y el negocio no la puede cambiar. `channels`
 * guarda el proveedor (`provider`, 00022:26 y :31-32).
 *
 * - Instagram por Zernio: 24 horas.
 * - WhatsApp por Evolution: sin ventana (el camino principal).
 * - WhatsApp por la API oficial vía Zernio (plan B): tiene ventana, 24 horas,
 *   o 72 si el contacto llegó por un anuncio click-to-WhatsApp
 *   (`window_source = 'ctwa'`). Escrito y sin construir: hoy no hay ningún
 *   canal así, y la bandeja y el filtro muestran ventana solo para Instagram.
 *   Si se activa el plan B, hay que separar acá el caso de 72 horas.
 */
const VENTANAS: Record<string, { horas: number } | null> = {
  "zernio:instagram": { horas: 24 },
  "zernio:whatsapp": { horas: 24 },
  "evolution:whatsapp": null,
};

export function reglaDeVentana(proveedor: string | null | undefined, plataforma: string | null | undefined): { horas: number } | null {
  return VENTANAS[`${proveedor ?? ""}:${plataforma ?? ""}`] ?? null;
}

/** Hasta cuándo queda abierta la ventana que abre un mensaje del lead con esa hora de Meta. */
export function venceEn(sentAt: string | null | undefined, ahora: Date, horas: number): string {
  const meta = sentAt ? new Date(sentAt).getTime() : NaN;
  const base = Number.isFinite(meta) ? Math.min(meta, ahora.getTime()) : ahora.getTime();
  return new Date(base + horas * HORA_MS).toISOString();
}

/**
 * Adelanta la ventana de una conversación, nunca la atrasa. Tira si la base
 * falla: el receptor libera el reclamo y responde 500, y el proveedor reintenta.
 */
export async function moverVentana(
  supabase: SupabaseClient,
  { conversationId, vence }: { conversationId: string; vence: string },
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ window_expires_at: vence, window_source: "mensaje" })
    .eq("id", conversationId)
    .or(`window_expires_at.is.null,window_expires_at.lt."${vence}"`);
  if (error) throw new Error(`conversations (ventana): ${error.message}`);
}

// ── Para la pantalla ─────────────────────────────────────────────────────────

export type EstadoDeVentana =
  | { estado: "abierta"; restanteMs: number }
  | { estado: "por_vencer"; restanteMs: number }
  | { estado: "cerrada" };

/**
 * El estado de la ventana para mostrar, o null si la conversación no es de
 * Instagram (la bandeja no muestra ventana para WhatsApp). Sin ningún mensaje
 * del lead (`window_expires_at` en null), está cerrada.
 */
export function estadoDeVentana(
  conv: { platform: string | null; window_expires_at?: string | null },
  ahoraMs: number,
): EstadoDeVentana | null {
  if (conv.platform !== "instagram") return null;
  const vence = conv.window_expires_at ? new Date(conv.window_expires_at).getTime() : NaN;
  if (!Number.isFinite(vence) || vence <= ahoraMs) return { estado: "cerrada" };
  const restanteMs = vence - ahoraMs;
  return restanteMs <= POR_VENCER_MS ? { estado: "por_vencer", restanteMs } : { estado: "abierta", restanteMs };
}

/** «Vence en 1 h 20 min», o «Vence en 45 min» con menos de una hora (D1, decidido el 05/11/2026). */
export function textoDeVence(restanteMs: number): string {
  const minutos = Math.max(1, Math.ceil(restanteMs / 60000));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `Vence en ${m} min`;
  return m === 0 ? `Vence en ${h} h` : `Vence en ${h} h ${m} min`;
}

/**
 * El texto de la ventana, según dónde (el criterio reescrito el 05/11/2026,
 * con los textos de prototipo-fase1.html:456, :458 y :459). En la lista, solo
 * lo que pide atención: «Ventana cerrada» o el aviso de que vence; con más de
 * 2 horas, nada. En el encabezado y la ficha, siempre el estado.
 */
export function textoDeVentana(e: EstadoDeVentana | null, lugar: "lista" | "encabezado"): string | null {
  if (!e) return null;
  if (e.estado === "cerrada") return "Ventana cerrada";
  if (e.estado === "por_vencer") return textoDeVence(e.restanteMs);
  return lugar === "lista" ? null : `Ventana abierta · quedan ${Math.floor(e.restanteMs / HORA_MS)} h`;
}

/** El aviso cuando el envío se rechaza por la ventana (D5, prototipo-fase1.html:1015). */
export const AVISO_VENTANA_CERRADA =
  "No se envió: la ventana de 24 horas se cerró mientras escribías. Escribile desde la app de Instagram.";
