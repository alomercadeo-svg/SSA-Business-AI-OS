import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { executeFlow } from "@/lib/flow-engine/engine";
import { matchTrigger } from "@/lib/flow-engine/trigger-matcher";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { processComment } from "@/lib/comment-processor";
import type { Database } from "@/lib/types/database";
import { messagePreview } from "@/lib/message-preview";
import { guardarMensajes } from "@/lib/mensajes-guardado";
import { contactoDelAviso, esSaliente, mensajeDelAviso, type AvisoDeMensajeZernio } from "@/lib/zernio-aviso";
import { rellenarPerfilSiFalta } from "@/lib/relleno-perfil";
import { claveDeImportacion } from "@/lib/importacion-historial";
import { almacenDeSupabase, descargarAdjunto, seDescarga } from "@/lib/adjuntos";

// ── Zernio API webhook payload ───────────────────────────────────────────────

interface WebhookPayload {
  id?: string;
  event: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments: Array<{ type: string; url: string; payload?: string }>;
    sender: {
      id: string;
      name: string;
      username: string | null;
      picture: string | null;
    };
    sentAt: string;
    isRead: boolean;
  };
  conversation: {
    id: string;
    platformConversationId: string | null;
    participantId: string;
    participantName: string;
    participantUsername: string | null;
    participantPicture: string | null;
    status: string;
  };
  account: {
    id: string;
    platform: string;
    username: string;
    displayName: string;
  };
  metadata?: {
    quickReplyPayload?: string;
    callbackData?: string;
    postbackPayload?: string;
    postbackTitle?: string;
  };
  timestamp: string;
}

interface CommentWebhookPayload {
  id?: string;
  event: string;
  comment: {
    id: string;
    /** Zernio post ID; null when the comment is on a post not published through Zernio. */
    postId: string | null;
    platformPostId: string;
    platform: string;
    text: string;
    author: { id: string; username?: string; name?: string; picture?: string };
    createdAt: string;
    isReply: boolean;
    parentCommentId: string | null;
  };
  post: { id: string; platformPostId: string };
  account: { id: string; platform: string; username: string };
  timestamp: string;
}

// ── Webhook handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request);
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Verifica la firma HMAC-SHA256 del evento entrante.
 *
 * **Sin secret configurado no se procesa nada.** Antes la condición era
 * `if (secret && !verifica(...))`: si no había secret, el webhook aceptaba el
 * evento sin verificar. Eso convierte a `/api/webhooks/late` en un endpoint
 * abierto durante toda la ventana entre conectar un canal y guardar el secret, y
 * cualquiera que conozca la URL y un `late_account_id` puede inyectar mensajes
 * entrantes falsos, que el motor de flujos procesa como reales.
 *
 * Fallar cerrado tiene una consecuencia operativa que hay que conocer: si se
 * conectan los canales antes de registrar el webhook con su secret, los mensajes
 * de prueba se descartan con 401 y se pierden. El orden correcto está en
 * `docs/checklist-verificacion-instagram.md`.
 *
 * El log lleva el canal y nunca el secret ni la firma: sirve para diagnosticar
 * "por qué no me llegan los mensajes" sin ser un canal de fuga.
 */
function verificarFirma(
  secret: string | null,
  body: string,
  signature: string | null,
  channel: { id: string; platform: string },
): boolean {
  if (!secret) {
    console.error(
      `[webhook] rechazado: el canal ${channel.id} (${channel.platform}) no tiene ` +
      `webhook secret configurado. Guardá la API key y registrá el webhook en Zernio ` +
      `antes de recibir eventos.`
    );
    return false;
  }
  return verifyWebhookSignature(secret, body, signature);
}

/**
 * Claim an event id for processing. Returns false when another delivery of the
 * same event already claimed it (Zernio retries with the same id), so retries
 * and redeliveries never re-run a flow. Events without an id are processed
 * unconditionally rather than dropped.
 */
async function claimWebhookEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  eventId: string | null | undefined
): Promise<boolean> {
  if (!eventId) return true;
  const { error } = await supabase
    .from("webhook_events")
    .insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Table missing / transient DB error: fail open so deliveries keep working.
  console.error("webhook_events claim failed:", error);
  return true;
}

async function handleWebhook(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-late-signature");
  const headerEventId = request.headers.get("x-late-event-id");

  let parsed: { event?: string; id?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = parsed.id || headerEventId;

  if (parsed.event === "comment.received") {
    return handleCommentWebhook(parsed as CommentWebhookPayload, body, signature, eventId);
  }

  // F27: se guardan los dos eventos de mensaje. `message.sent` es el echo de
  // lo que escribe el negocio, desde la bandeja o desde la app de Instagram;
  // hasta el 08/10/2026 se descartaba acá y, con la bandeja leyendo de la base,
  // esas respuestas dejarían de verse.
  if (parsed.event !== "message.received" && parsed.event !== "message.sent") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const payload = parsed as WebhookPayload;
  const { message: msg, account } = payload;

  // Lo que escribe el negocio. Se guarda como saliente y nunca dispara flujos,
  // que era lo que evitaba el filtro viejo de dirección: procesar en bucle los
  // propios envíos. Se compara contra `"outgoing"` y no contra `"incoming"`
  // (ver `esSaliente`): un literal desconocido queda del lado del lead.
  const saliente = esSaliente(payload);

  const supabase = await createServiceClient();

  // Look up channel by late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Dos cuentas conectadas del mismo espacio que se escriben (pasa en pruebas):
  // el mensaje es real y se guarda, pero no dispara flujos, que es el bucle que
  // este filtro existía para evitar. Antes se descartaba entero. Un saliente no
  // pasa por acá: su autor es siempre la propia cuenta.
  let entreCuentasPropias = false;
  if (!saliente && msg.sender.username) {
    const { data: senderChannel } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", channel.workspace_id)
      .eq("username", msg.sender.username)
      .eq("is_active", true)
      .maybeSingle();
    entreCuentasPropias = Boolean(senderChannel);
  }

  if (!verificarFirma(await resolveWebhookSecret(supabase, channel), body, signature, channel)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // ANTES del acuse: contacto, conversación y mensaje, solo escrituras en la
  // base (nada de esto llama a Zernio). Si falla, se libera el reclamo y se
  // responde 500 para que el proveedor reintente: un aviso reclamado y no
  // guardado se perdía en silencio (deuda de §15, 07/10/2026). Que Zernio
  // reintente ante un 500 no está verificado; su log de entregas tiene un
  // `attemptNumber` que "increments on retries" (SDK 0.2.519, index.d.ts:6712).
  let guardado: Guardado;
  try {
    guardado = await guardarAviso(supabase, payload, channel, saliente);
  } catch (err) {
    console.error("[webhooks/late] no se pudo guardar el mensaje:", err instanceof Error ? err.message : err);
    if (eventId) await supabase.from("webhook_events").delete().eq("event_id", eventId);
    return NextResponse.json({ error: "No se pudo guardar el mensaje" }, { status: 500 });
  }

  // F28: el archivo del adjunto se baja DESPUÉS del acuse, en su propio
  // `after()`, separado del de flujos (corre también entre cuentas propias).
  // Si un redespliegue lo corta, el mensaje ya está guardado con
  // `media_intentos` en 0 y lo toma el reintento de las tareas programadas.
  if (guardado.descargarAdjunto) {
    const { conversationId } = guardado;
    const platformMessageId = payload.message.platformMessageId;
    after(async () => {
      try {
        const { data } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("platform_message_id", platformMessageId)
          .eq("direction", "inbound")
          .maybeSingle();
        const id = (data as { id?: string } | null)?.id;
        if (id) await descargarAdjunto(id, { almacen: almacenDeSupabase(supabase) });
      } catch (err) {
        console.error("[webhooks/late] adjunto:", err instanceof Error ? err.message : "error");
      }
    });
  }

  // Después del acuse, lo que sí llama afuera: el relleno del perfil (Zernio)
  // y los flujos (que mandan mensajes). Zernio corta las entregas a los 5
  // segundos, según el comentario que trae el fork (`53cb513`); no verificado.
  if (!saliente && !entreCuentasPropias) {
    after(async () => {
      try {
        await rellenarPerfilSiFalta(supabase, {
          channel,
          senderId: guardado.senderId,
          conversacionDeZernio: payload.conversation.id,
        });
      } catch (err) {
        console.error("[webhooks/late] relleno de perfil:", err instanceof Error ? err.message : err);
      }
      try {
        await correrFlujos(supabase, payload, channel, guardado);
      } catch (err) {
        console.error("Webhook message processing error:", err);
      }
    });
  }

  return NextResponse.json({ ok: true, queued: true });
}

type Canal = Database["public"]["Tables"]["channels"]["Row"];

interface Guardado {
  contactId: string;
  contactExisted: boolean;
  conversationId: string;
  isAutomationPaused: boolean;
  /** El identificador del lead en el canal (`contact_channels.platform_sender_id`). */
  senderId: string;
  /** F28: un entrante con archivo, marcado para bajar. */
  descargarAdjunto: boolean;
}

/**
 * Contacto, conversación y mensaje. Tira si algo no se pudo escribir: el que
 * llama libera el reclamo y responde 500.
 */
async function guardarAviso(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: WebhookPayload,
  channel: Canal,
  saliente: boolean,
): Promise<Guardado> {
  const aviso = payload as unknown as AvisoDeMensajeZernio;
  const lead = contactoDelAviso(aviso);
  if (!lead) throw new Error("el aviso no trae a quién pertenece la conversación");

  const ahora = new Date().toISOString();
  const contact = await upsertContactForSender({
    supabase,
    channel,
    ...lead,
    interactionAt: ahora,
    stampExisting: !saliente,
  });
  if (!contact) throw new Error("no se pudo crear el contacto");

  const preview = messagePreview(payload.message.text);
  const { data: conversation } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: channel.workspace_id,
        channel_id: channel.id,
        contact_id: contact.contactId,
        platform: channel.platform,
        late_conversation_id: payload.conversation.id,
        status: "open",
        last_message_at: ahora,
        last_message_preview: preview,
        // Un saliente no deja nada sin leer.
        ...(saliente ? {} : { unread_count: 1 }),
      },
      { onConflict: "channel_id,contact_id" }
    )
    .select("id, is_automation_paused")
    .single();
  if (!conversation) throw new Error("no se pudo guardar la conversación");

  if (contact.existed && !saliente) {
    await supabase
      .rpc("increment_unread", { conv_id: conversation.id, preview })
      .then(() => {});
  }

  // Un lead que no conocíamos, DESPUÉS de una importación completa del
  // historial, es una conversación nueva: todo su historial es lo que entra
  // desde ahora. Se marca completa para que la bandeja no le muestre el aviso
  // de «historial sin importar». Antes de la primera importación queda
  // `pendiente`: puede ser una conversación vieja que la importación tiene que
  // traer entera.
  if (!contact.existed) {
    const { data: importacion } = await supabase
      .from("tareas_estado")
      .select("ultimo_ok_at")
      .eq("clave", claveDeImportacion(channel.workspace_id))
      .maybeSingle();
    if ((importacion as { ultimo_ok_at?: string | null } | null)?.ultimo_ok_at) {
      await supabase
        .from("conversations")
        .update({ historial_estado: "completo", historial_importado_at: ahora })
        .eq("id", conversation.id)
        .eq("historial_estado", "pendiente");
    }
  }

  const mensaje = mensajeDelAviso(aviso, conversation.id, lead.senderId);
  const { error } = await guardarMensajes(supabase, [mensaje], { marcarDescarga: true });
  if (error) throw new Error(`messages: ${error.message}`);

  if (!saliente) {
    await supabase.from("channels").update({ last_inbound_at: ahora }).eq("id", channel.id);
  }

  return {
    contactId: contact.contactId,
    contactExisted: contact.existed,
    conversationId: conversation.id,
    isAutomationPaused: Boolean(conversation.is_automation_paused),
    senderId: lead.senderId,
    descargarAdjunto: seDescarga(mensaje) && Boolean(mensaje.platformMessageId),
  };
}

async function correrFlujos(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: WebhookPayload,
  channel: Canal,
  guardado: Guardado,
) {
  const { message: msg, conversation: conv, account, metadata } = payload;
  const contactId = guardado.contactId;

  if (!guardado.isAutomationPaused) {
    const incomingMessage = {
      text: msg.text || undefined,
      postbackPayload: metadata?.postbackPayload || undefined,
      quickReplyPayload: metadata?.quickReplyPayload || undefined,
      callbackData: metadata?.callbackData || undefined,
      sender: {
        id: msg.sender.id,
        name: msg.sender.name,
        username: msg.sender.username || undefined,
      },
    };

    const handled = await handleGlobalKeywords(
      supabase,
      channel.workspace_id,
      contactId,
      msg.text || undefined
    );

    if (!handled) {
      const trigger = await matchTrigger(supabase, {
        channelId: channel.id,
        workspaceId: channel.workspace_id,
        conversationId: guardado.conversationId,
        message: incomingMessage,
        isFirstMessage: !guardado.contactExisted,
      });
      if (trigger) {
        try {
          await executeFlow(supabase, {
            triggerId: trigger.id,
            flowId: trigger.flow_id,
            channelId: channel.id,
            contactId,
            conversationId: guardado.conversationId,
            workspaceId: channel.workspace_id,
            incomingMessage,
            lateConversationId: conv.id,
            lateAccountId: account.id,
          });
        } catch (err) {
          console.error("Flow execution error:", err);
        }
      }
    }
  }
}

// ── Comment webhook ─────────────────────────────────────────────────────────

async function handleCommentWebhook(
  payload: CommentWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined
) {
  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", payload.account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Prevent loops: our own comments (e.g. the configured public reply) also
  // arrive as comment.received and must never re-trigger a flow.
  if (
    payload.comment.author?.username &&
    payload.comment.author.username === channel.username
  ) {
    return NextResponse.json({ ok: true, skipped: true, reason: "own_comment" });
  }

  if (!verificarFirma(await resolveWebhookSecret(supabase, channel), rawBody, signature, channel)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // Ack before processing (same 5s delivery budget as messages); processComment
  // additionally dedupes on (channel_id, platform_comment_id) so cross-event
  // redeliveries of the same comment stay one-shot.
  after(async () => {
    try {
      await processComment({
        supabase,
        channel,
        comment: {
          id: payload.comment.id,
          // Native posts (not published through Zernio) have a null postId; fall
          // back to the platform post id so flows still run. Zernio's private-reply
          // endpoint only needs the comment id, so the placeholder is harmless.
          postId: payload.comment.postId || payload.comment.platformPostId,
          text: payload.comment.text,
          author: payload.comment.author,
        },
      });
    } catch (err) {
      console.error("Webhook comment processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

// ── Global keywords ─────────────────────────────────────────────────────────

async function handleGlobalKeywords(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  contactId: string,
  text: string | undefined
): Promise<boolean> {
  if (!text) return false;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.global_keywords) return false;

  const keywords = workspace.global_keywords as Array<{
    keyword: string;
    action?: string;
    flowId?: string;
  }>;

  const normalizedText = text.toLowerCase().trim();

  for (const kw of keywords) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") {
        await supabase
          .from("contacts")
          .update({ is_subscribed: false })
          .eq("id", contactId);
        return true;
      }
      if (kw.action === "subscribe") {
        await supabase
          .from("contacts")
          .update({ is_subscribed: true })
          .eq("id", contactId);
        return true;
      }
      return false;
    }
  }

  return false;
}
