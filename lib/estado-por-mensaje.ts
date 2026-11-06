/**
 * El estado de la conversación y los no leídos cuando llega un mensaje (F35,
 * tramo D de S8). Lo usan los dos receptores, ANTES del acuse: son solo
 * escrituras en la base.
 *
 * LAS REGLAS:
 *   - Una conversación que nace de un mensaje del negocio nace cerrada; una
 *     que nace de un mensaje del lead, abierta. Las dos, con 0 no leídos.
 *   - El alta no pisa una que ya existe (`ignoreDuplicates`, el patrón de
 *     lib/inbox-sync.ts:389-412). A una que existe se le cambian solo el último
 *     mensaje y lo que diga el receptor: nunca el estado ni los no leídos.
 *     Antes el `upsert` escribía `status: "open"` siempre (lo del negocio
 *     también reabría) y `unread_count: 1` (pisaba lo que había, y
 *     `increment_unread` sumaba uno más: quedaba en 2 con cualquier mensaje
 *     del lead de un contacto conocido, medido el 04/11/2026 en el rojo de
 *     scripts/verify-estados-bandeja.mjs).
 *   - Un mensaje del lead, en vivo: si es nuevo, suma uno (`increment_unread`,
 *     que además abre esa conversación); y abre TODAS las conversaciones
 *     cerradas de ese contacto en el espacio, sin las eliminadas. Esto último va
 *     siempre, aunque el mensaje sea repetido: si un intento anterior guardó el
 *     mensaje y falló después, el reintento del proveedor igual saca al lead de
 *     «Cerradas». El costo: en ese caso se pierde un +1.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { marcarSiPideBaja } from "./no-contactar";

export interface ClavesDeConversacion {
  workspace_id: string;
  channel_id: string;
  contact_id: string;
  platform: string;
}

/**
 * La conversación del mensaje: la crea si no existe (cerrada si escribió el
 * negocio) o le actualiza `cambios`. Tira si no pudo: el receptor libera el
 * reclamo y responde 500.
 */
export async function conversacionDelMensaje<F extends { id: string }>(
  supabase: SupabaseClient,
  {
    claves,
    delLead,
    cambios,
    columnas,
  }: { claves: ClavesDeConversacion; delLead: boolean; cambios: Record<string, unknown>; columnas: string },
): Promise<F> {
  const { data: creada, error: errAlta } = await supabase
    .from("conversations")
    .upsert(
      { ...claves, ...cambios, status: delLead ? "open" : "closed", unread_count: 0 },
      { onConflict: "channel_id,contact_id", ignoreDuplicates: true },
    )
    .select(columnas)
    .maybeSingle();
  if (errAlta) throw new Error(`conversations: ${errAlta.message}`);
  if (creada) return creada as unknown as F;

  const { data: existente, error } = await supabase
    .from("conversations")
    .update(cambios)
    .eq("channel_id", claves.channel_id)
    .eq("contact_id", claves.contact_id)
    .select(columnas)
    .single();
  if (error || !existente) throw new Error(`conversations: ${error?.message ?? "no se pudo guardar la conversación"}`);
  return existente as unknown as F;
}

/** Lo que hace un mensaje del lead, en vivo, después de guardarlo. Tira si no pudo. */
export async function alEscribirElLead(
  supabase: SupabaseClient,
  { conversationId, workspaceId, contactId, preview, nuevo, texto = null }: {
    conversationId: string;
    workspaceId: string;
    contactId: string;
    preview: string | null;
    /** Si la base insertó el mensaje (no era repetido). */
    nuevo: boolean;
    /** El texto del lead, para la detección de baja de F34. */
    texto?: string | null;
  },
): Promise<void> {
  if (nuevo) {
    const r = await supabase.rpc("increment_unread", { conv_id: conversationId, preview });
    if (r?.error) throw new Error(`increment_unread: ${r.error.message}`);
  }
  const { error } = await supabase
    .from("conversations")
    .update({ status: "open" })
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "closed")
    .is("deleted_at", null);
  if (error) throw new Error(`conversations: ${error.message}`);
  // F34: si el mensaje pide no recibir más, se marca el contacto. Solo con un
  // mensaje nuevo: uno repetido ya pasó por acá. Si la marca falla, NO tira:
  // el mensaje ya está guardado y el aviso se acusa igual (pedido de Marcos
  // del 06/11/2026). Queda en el registro del servidor, sin el texto.
  if (nuevo) {
    try {
      await marcarSiPideBaja(supabase, { workspaceId, contactId, texto });
    } catch (err) {
      console.error(`[no-contactar] no se pudo revisar la baja del contacto ${contactId}:`, err instanceof Error ? err.message : "error");
    }
  }
}
