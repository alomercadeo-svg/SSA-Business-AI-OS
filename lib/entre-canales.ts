/**
 * F29, la detección de contacto entre canales, del lado del receptor.
 *
 * Al llegar un mensaje de un remitente que este canal no conoce, se busca el
 * contacto en el resto del espacio (`buscar_contacto_entre_canales`, 00039):
 *   - teléfono E.164 o correo exactos, y únicos: se VINCULA solo. Se crea el
 *     registro de canal (`contact_channels`) sobre el contacto que ya estaba,
 *     su conversación es otra (una por canal, la restricción de siempre), y
 *     queda «contacto.vinculado» en el historial, con el Sistema de autor;
 *   - solo el nombre de usuario: se crea el contacto nuevo como siempre y se
 *     le SUGIERE la unión al operador (`sugerencias_union`). Nunca se une solo:
 *     F26 prefiere un duplicado visible a una fusión equivocada.
 * Y cuando `reconciliar_telefono` devuelve conflicto en el camino automático,
 * también queda una sugerencia (motivo «teléfono»): F26 lo dejó escrito como
 * de F29.
 *
 * Qué trae cada canal al llegar, hoy: WhatsApp, el teléfono (del JID);
 * Instagram, el usuario. Ninguno trae correo: la búsqueda por correo existe y
 * se prueba directo en la base, y sus datos reales llegan con la importación
 * (F37).
 *
 * Respuestas de Marcos del 20/10/2026: el teléfono se busca también en
 * `whatsapp_phone` y el correo en el secundario; y si el que coincide está
 * eliminado (dentro de los 30 días), la búsqueda lo devuelve marcado y el
 * receptor lo restaura antes de vincular.
 *
 * NUNCA TIRA (revisión del 20/10/2026): corre después de que el contacto ya se
 * creó. Si tirara, el receptor respondería 500 y el reintento encontraría al
 * remitente como «existente» (sin flujo de primer mensaje y sin sugerencia).
 * Un fallo se registra y se sigue sin vincular ni sugerir.
 *
 * Todo con la clave de servicio: corre en el receptor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarAuditoria } from "./auditoria";

export interface Hallazgo {
  tipo: "exacto" | "sugerencia";
  por: "telefono" | "correo" | "usuario";
  contact_id: string;
  /** El que coincide está eliminado (dentro de los 30 días): se restaura antes de vincular. */
  eliminado?: boolean;
}

export async function buscarEntreCanales(
  servicio: SupabaseClient,
  q: { workspaceId: string; telefono?: string | null; correo?: string | null; usuario?: string | null; canalId?: string | null; excluir?: string | null },
): Promise<Hallazgo | null> {
  const { data, error } = await servicio.rpc("buscar_contacto_entre_canales", {
    p_workspace: q.workspaceId,
    p_telefono: q.telefono ?? null,
    p_correo: q.correo ?? null,
    p_usuario: q.usuario ?? null,
    p_canal: q.canalId ?? null,
    p_excluir: q.excluir ?? null,
  });
  if (error) {
    console.error("[entre-canales] búsqueda:", error.message);
    return null;
  }
  return (data as Hallazgo | null) ?? null;
}

/**
 * Vincula el remitente de este canal a un contacto que ya estaba: su registro
 * de canal y la fila del historial. Tira si no pudo: el receptor responde 500 y
 * el proveedor reintenta.
 */
export async function vincularCanal(
  servicio: SupabaseClient,
  v: {
    contactId: string;
    canal: { id: string; workspace_id: string; platform?: string | null };
    senderId: string;
    rawJid?: string | null;
    addressingMode?: string | null;
    usuario?: string | null;
    por: Hallazgo["por"];
  },
): Promise<void> {
  const { error } = await servicio.from("contact_channels").insert({
    contact_id: v.contactId,
    channel_id: v.canal.id,
    platform_sender_id: v.senderId,
    raw_jid: v.rawJid ?? v.senderId,
    ...(v.addressingMode ? { addressing_mode: v.addressingMode } : {}),
    platform_username: v.usuario ?? null,
  });
  if (error) throw new Error(`contact_channels: ${error.message}`);
  const { data: c } = await servicio.from("contacts").select("display_name").eq("id", v.contactId).maybeSingle();
  await registrarAuditoria({
    workspaceId: v.canal.workspace_id,
    actor: null,
    accion: "contacto.vinculado",
    entidad: { tipo: "contacto", id: v.contactId, etiqueta: (c as { display_name?: string | null } | null)?.display_name ?? null },
    detalle: { por: v.por, plataforma: v.canal.platform ?? null, canal_id: v.canal.id },
  });
}

/**
 * Deja la sugerencia «¿Es la misma persona?». Si el par ya existe, en
 * cualquier orden y aunque se haya descartado, no se repite: «No es la misma»
 * no se vuelve a sugerir.
 */
export async function sugerirUnion(
  servicio: SupabaseClient,
  s: { workspaceId: string; contactoId: string; otroId: string; motivo: "usuario" | "telefono"; detalle?: Record<string, unknown> },
): Promise<boolean> {
  if (s.contactoId === s.otroId) return false;
  const { data: ya, error: errYa } = await servicio
    .from("sugerencias_union")
    .select("id")
    .or(`and(contacto_id.eq.${s.contactoId},otro_id.eq.${s.otroId}),and(contacto_id.eq.${s.otroId},otro_id.eq.${s.contactoId})`)
    .limit(1);
  if (errYa) {
    console.error("[entre-canales] sugerencia (lectura):", errYa.message);
    return false;
  }
  if ((ya ?? []).length > 0) return false;
  const { error } = await servicio.from("sugerencias_union").insert({
    workspace_id: s.workspaceId,
    contacto_id: s.contactoId,
    otro_id: s.otroId,
    motivo: s.motivo,
    detalle: s.detalle ?? {},
  });
  // Dos avisos a la vez: el segundo choca con el índice único del par, y está bien.
  if (error && error.code !== "23505") console.error("[entre-canales] sugerencia:", error.message);
  return !error;
}
