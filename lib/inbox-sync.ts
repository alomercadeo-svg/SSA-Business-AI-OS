/**
 * Inbox backfill from Zernio.
 *
 * The local `conversations` table is otherwise populated only by inbound
 * webhooks, so conversations that predate webhook registration never appear
 * in the Inbox (#12). This module pages through Zernio's inbox conversations
 * per channel and imports the ones missing locally.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { messagePreview } from "@/lib/message-preview";
import { registrarAuditoria } from "@/lib/auditoria";

/** Cap per channel: 4 pages x 50 conversations. */
const MAX_PAGES_PER_CHANNEL = 4;
const PAGE_SIZE = 50;

export interface BackfillChannel {
  id: string;
  late_account_id: string;
  platform: string;
}

/**
 * Deja solo los canales que el backfill puede atender.
 *
 * El backfill trae conversaciones por la API de Zernio, así que un canal sin
 * `late_account_id` no tiene por dónde consultarse: es un canal de Evolution,
 * cuyo historial vive en otro lado y se trae de otra forma. Filtrarlo acá es
 * mejor que dejarlo entrar y que falle adentro con un `accountId: null`, que
 * Zernio respondería con un error genérico difícil de atribuir.
 */
export function canalesConCuentaDeZernio(
  canales: Array<{ id: string; late_account_id: string | null; platform: string }>
): BackfillChannel[] {
  return canales.filter(
    (c): c is BackfillChannel => typeof c.late_account_id === "string"
  );
}

/** Conversation item shape returned by Zernio's listInboxConversations. */
interface ZernioInboxConversation {
  id?: string;
  participantId?: string;
  participantName?: string;
  /**
   * El handle. El SDK (0.2.519) no lo declara en el listado, pero llega: se
   * midió el 22/09/2026 (F25, nota "Por qué, medido"). Si no viene, el handle
   * no se deduce de `participantName`, aunque tenga pinta de handle.
   */
  participantUsername?: string | null;
  participantPicture?: string | null;
  lastMessage?: string;
  updatedTime?: string;
  status?: "active" | "archived";
  unreadCount?: number | null;
}

/**
 * Finds or creates the contact behind a platform sender: reuses the mapping in
 * `contact_channels` (channel_id, platform_sender_id); otherwise inserts the
 * contact, its channel mapping, and a `contact_created` analytics event.
 * Returns null when the contact insert fails; `existed` tells whether the
 * sender was already known on this channel.
 * With `stampExisting: false` an existing contact's last_interaction_at is
 * left untouched; the caller stamps it once the interaction is confirmed.
 *
 * F25 y F31, agregado el 07/10/2026:
 *   - El handle (`platform_username`) se escribe con el que trae el proveedor,
 *     también en un contacto que ya existía: si cambió, se reemplaza. Si el
 *     aviso no lo trae, no se borra el que había: que no venga no prueba que
 *     cambió. Nunca se deduce de otro campo.
 *   - El nombre de un contacto que ya existe no se toca: ni acá ni en ningún
 *     otro camino automático. Un nombre `manual` (F25) no lo pisa nadie.
 *   - La búsqueda es solo por (canal, identificador del remitente). Nunca por
 *     nombre: F26 prefiere un duplicado visible a una fusión equivocada.
 *   - Un contacto nuevo queda en el historial de auditoría, con el Sistema
 *     como actor.
 */
export async function upsertContactForSender({
  supabase,
  channel,
  senderId,
  senderName,
  senderPicture,
  senderUsername,
  interactionAt,
  stampExisting = true,
}: {
  supabase: SupabaseClient;
  channel: { id: string; workspace_id: string; platform?: string };
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  senderUsername?: string | null;
  interactionAt: string;
  stampExisting?: boolean;
}): Promise<{ contactId: string; existed: boolean } | null> {
  const { data: existingContactChannel } = await supabase
    .from("contact_channels")
    .select("contact_id, platform_username")
    .eq("channel_id", channel.id)
    .eq("platform_sender_id", senderId)
    .single();

  if (existingContactChannel) {
    const handle = handleDelProveedor(senderUsername);
    if (handle && handle !== existingContactChannel.platform_username) {
      await actualizarHandle(supabase, channel.id, senderId, handle);
    }
    if (stampExisting) {
      await supabase
        .from("contacts")
        .update({ last_interaction_at: interactionAt })
        .eq("id", existingContactChannel.contact_id);
    }
    return { contactId: existingContactChannel.contact_id, existed: true };
  }

  const { data: newContact } = await supabase
    .from("contacts")
    .insert({
      workspace_id: channel.workspace_id,
      display_name: senderName,
      avatar_url: senderPicture,
      last_interaction_at: interactionAt,
    })
    .select("id")
    .single();

  if (!newContact) return null;

  await supabase.from("contact_channels").insert({
    contact_id: newContact.id,
    channel_id: channel.id,
    platform_sender_id: senderId,
    platform_username: handleDelProveedor(senderUsername),
    // F26: el identificador tal como llegó. Para Instagram es el id del
    // remitente que manda Zernio, el mismo valor que platform_sender_id.
    raw_jid: senderId,
  });

  await supabase.from("analytics_events").insert({
    workspace_id: channel.workspace_id,
    contact_id: newContact.id,
    event_type: "contact_created",
  });

  await registrarAuditoria(
    {
      workspaceId: channel.workspace_id,
      actor: null,
      accion: "contacto.creado",
      entidad: { tipo: "contacto", id: newContact.id, etiqueta: senderName },
      detalle: { plataforma: channel.platform ?? null, canal_id: channel.id },
    },
    supabase
  );

  return { contactId: newContact.id, existed: false };
}

/** El handle como lo trae el proveedor, sin la arroba. Vacío o ausente es nulo. */
export function handleDelProveedor(username: string | null | undefined): string | null {
  if (typeof username !== "string") return null;
  const limpio = username.trim().replace(/^@/, "");
  return limpio || null;
}

/**
 * Reemplaza el handle de un remitente en un canal (F25). Solo se llama con un
 * handle que trajo el proveedor; la ausencia nunca borra el que había.
 */
export async function actualizarHandle(
  supabase: SupabaseClient,
  channelId: string,
  senderId: string,
  handle: string
): Promise<void> {
  const { error } = await supabase
    .from("contact_channels")
    .update({ platform_username: handle })
    .eq("channel_id", channelId)
    .eq("platform_sender_id", senderId);
  if (error) console.error("[inbox-sync] no se pudo actualizar el handle:", error.message);
}

/**
 * Imports Zernio inbox conversations missing from the local `conversations`
 * table. Insert-only: conversations already known (by late_conversation_id)
 * are skipped, and a contact whose (channel_id, contact_id) row already exists
 * under a different late_conversation_id is left to the webhook, so the
 * webhook-maintained late_conversation_id / status / last_message_at /
 * unread_count are never clobbered. A failing channel is logged and skipped,
 * not fatal.
 */
export async function backfillInboxConversations({
  supabase,
  zernio,
  workspaceId,
  channels,
}: {
  supabase: SupabaseClient;
  zernio: Zernio;
  workspaceId: string;
  channels: BackfillChannel[];
}): Promise<{ imported: number }> {
  let imported = 0;

  for (const channel of channels) {
    try {
      imported += await backfillChannel({ supabase, zernio, workspaceId, channel });
    } catch (err) {
      console.error(
        `[inbox-sync] backfill failed for channel ${channel.id} (${channel.platform}):`,
        err
      );
    }
  }

  return { imported };
}

async function backfillChannel({
  supabase,
  zernio,
  workspaceId,
  channel,
}: {
  supabase: SupabaseClient;
  zernio: Zernio;
  workspaceId: string;
  channel: BackfillChannel;
}): Promise<number> {
  const { data: existingRows } = await supabase
    .from("conversations")
    .select("late_conversation_id")
    .eq("channel_id", channel.id);

  const known = new Set(
    (existingRows ?? [])
      .map((r: { late_conversation_id: string | null }) => r.late_conversation_id)
      .filter(Boolean)
  );

  let imported = 0;
  let cursor: string | undefined;
  const seenParticipants = new Set<string>();

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const res = await zernio.messages.listInboxConversations({
      query: {
        accountId: channel.late_account_id,
        limit: PAGE_SIZE,
        sortOrder: "desc",
        cursor,
      },
    });

    const conversations = (res.data?.data ?? []) as ZernioInboxConversation[];

    for (const conv of conversations) {
      if (!conv.id || !conv.participantId) continue;
      // A participant can have several Zernio conversations but the local
      // table is unique on (channel_id, contact_id). sortOrder desc means the
      // first conversation seen per participant is the most recent one; later
      // ones are dropped so they cannot overwrite it.
      if (seenParticipants.has(conv.participantId)) continue;
      seenParticipants.add(conv.participantId);
      if (known.has(conv.id)) {
        // La conversación ya está, pero el handle se refresca igual (F25): es
        // el único camino por el que los contactos importados antes del
        // 07/10/2026, que quedaron sin handle, lo reciben sin esperar un
        // mensaje nuevo.
        const handle = handleDelProveedor(conv.participantUsername);
        if (handle) await actualizarHandle(supabase, channel.id, conv.participantId, handle);
        continue;
      }
      if (await importConversation({ supabase, workspaceId, channel, conv })) {
        imported++;
      }
    }

    const pagination = res.data?.pagination;
    if (!pagination?.hasMore || !pagination.nextCursor) break;
    cursor = pagination.nextCursor;
  }

  return imported;
}

async function importConversation({
  supabase,
  workspaceId,
  channel,
  conv,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  channel: BackfillChannel;
  conv: ZernioInboxConversation;
}): Promise<boolean> {
  const interactionAt = conv.updatedTime ?? new Date().toISOString();
  const contact = await upsertContactForSender({
    supabase,
    channel: { id: channel.id, workspace_id: workspaceId, platform: channel.platform },
    senderId: conv.participantId!,
    senderName: conv.participantName || conv.participantId!,
    senderPicture: conv.participantPicture || null,
    senderUsername: conv.participantUsername,
    interactionAt,
    stampExisting: false,
  });

  if (!contact) {
    console.error(`[inbox-sync] failed to create contact for conversation ${conv.id}`);
    return false;
  }

  // ignoreDuplicates: an existing (channel_id, contact_id) row is owned by the
  // webhook (possibly under a different late_conversation_id) and must stay
  // untouched; the conflict then returns no rows, so it is not counted as
  // imported either.
  const { data: insertedRows, error } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: workspaceId,
        channel_id: channel.id,
        contact_id: contact.contactId,
        platform: channel.platform,
        late_conversation_id: conv.id,
        status: conv.status === "archived" ? "closed" : "open",
        last_message_at: conv.updatedTime ?? null,
        last_message_preview: messagePreview(conv.lastMessage),
        unread_count: conv.unreadCount ?? 0,
      },
      { onConflict: "channel_id,contact_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error(`[inbox-sync] failed to upsert conversation ${conv.id}:`, error);
    return false;
  }

  const inserted = (insertedRows ?? []).length > 0;

  // Stamp the existing contact only after the conversation row was actually
  // inserted; a webhook-owned duplicate is not a new interaction.
  if (inserted && contact.existed) {
    await supabase
      .from("contacts")
      .update({ last_interaction_at: interactionAt })
      .eq("id", contact.contactId);
  }

  return inserted;
}
