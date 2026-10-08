import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/vault";
import { messagePreview } from "@/lib/message-preview";
import { traerMensajesDeConversacion } from "@/lib/zernio-message-map";
import { registrarFalloDeZernio } from "@/lib/integraciones-estado";
import { guardarEnvioDeLaBandeja } from "@/lib/mensajes-guardado";

/**
 * GET /api/v1/messages?conversationId=...
 *
 * Fetches messages from the Zernio API (source of truth) instead of a local mirror.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  // Look up the Zernio conversation ID and workspace API key
  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id, workspace_id, channels(late_account_id)")
    .eq("id", conversationId)
    .maybeSingle();

  // Sin fila hay dos causas posibles y para el usuario son la misma: o la
  // conversación se borró, o dejó de estar en su scope porque le reasignaron el
  // lead. La RLS devuelve vacío en los dos casos, así que no se pueden
  // distinguir desde acá, y tampoco conviene: decir "existe pero no es tuya"
  // confirma la existencia de un lead ajeno.
  //
  // El código va aparte del mensaje para que el cliente pueda mostrar algo
  // claro. Antes esto era un 404 genérico que la bandeja interpretaba como
  // "conversación sin mensajes" y renderizaba un hilo vacío, sin explicación.
  if (!conversation) {
    return NextResponse.json(
      {
        error: "Esta conversación ya no está disponible para vos",
        code: "fuera_de_scope",
      },
      { status: 403 }
    );
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json({ error: "Conversation not found or missing Zernio ID" }, { status: 404 });
  }

  // La conversación ya se leyó con el cliente del usuario, así que la RLS (y el
  // scope de leads) autorizó el acceso. La clave se lee con el cliente de
  // servicio porque un Member no tiene permiso sobre Vault y sí tiene que poder
  // responder sus propias conversaciones: la clave nunca sale del servidor.
  const apiKey = await getZernioApiKey(await createServiceClient(), conversation.workspace_id);

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Fetch messages from Zernio API
  try {
    const zernio = createZernioClient(apiKey);

    // La traída y la traducción viven en lib/zernio-message-map.ts, donde
    // tienen test con fixtures de la respuesta real: son las partes que pueden
    // equivocarse sin que nada falle, porque un campo mal nombrado devuelve
    // undefined en vez de error, y una página faltante devuelve menos mensajes
    // en vez de un error.
    //
    // La respuesta trae `hayAnteriores` además de los mensajes: se pide la
    // última página, así que en una conversación larga queda historial afuera y
    // la pantalla tiene que decirlo.
    return NextResponse.json(
      await traerMensajesDeConversacion(zernio, {
        conversationIdDeZernio: conversation.late_conversation_id,
        accountId: channel.late_account_id,
        conversationIdLocal: conversationId,
      })
    );
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/messages
 *
 * Sends a message via Zernio API and stores it in `messages` (F27): the base is
 * the inbox's source of truth. The provider's echo (`message.sent`) carries the
 * same id and hits the unique constraint, so the message is stored once.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { conversationId, text } = body;

  if (!conversationId || !text) {
    return NextResponse.json(
      { error: "conversationId and text required" },
      { status: 400 }
    );
  }

  // Get conversation with channel info
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, channels(late_account_id)")
    .eq("id", conversationId)
    .maybeSingle();

  // Mismo caso que en el GET: la conversación se borró o salió de su scope, y
  // la RLS devuelve vacío en los dos. Intentar responder un lead que le acaban
  // de quitar tiene que decir eso, no "Conversation not found".
  if (!conversation) {
    return NextResponse.json(
      {
        error: "Esta conversación ya no está disponible para vos",
        code: "fuera_de_scope",
      },
      { status: 403 }
    );
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json(
      { error: "No Zernio conversation ID linked to this conversation" },
      { status: 400 }
    );
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "Channel not found or missing Zernio account ID" }, { status: 404 });
  }

  // La conversación ya se leyó con el cliente del usuario, así que la RLS (y el
  // scope de leads) autorizó el acceso. La clave se lee con el cliente de
  // servicio porque un Member no tiene permiso sobre Vault y sí tiene que poder
  // responder sus propias conversaciones: la clave nunca sale del servidor.
  const apiKey = await getZernioApiKey(await createServiceClient(), conversation.workspace_id);

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  // Send via Zernio SDK, then store it (F27)
  try {
    const zernio = createZernioClient(apiKey);
    const res = await zernio.messages.sendInboxMessage({
      path: { conversationId: conversation.late_conversation_id },
      body: { accountId: channel.late_account_id, message: text },
    });

    const messageId = (res.data as any)?.data?.messageId ?? null;
    const enviadoAt = new Date().toISOString();

    // F27: se guarda con el cliente de servicio, después de que la RLS del
    // usuario autorizó la conversación (arriba). Hace falta el de servicio
    // porque, si el echo llegó primero, esto es un UPDATE de `sent_by_user_id`,
    // y `messages` no tiene política de UPDATE. `remote_jid` es el del lead en
    // el canal, el mismo que escribe el echo: el trigger de la 00031 no deja
    // cambiarlo una vez escrito.
    const servicio = await createServiceClient();
    const { data: delLead } = await servicio
      .from("contact_channels")
      .select("platform_sender_id")
      .eq("channel_id", conversation.channel_id)
      .eq("contact_id", conversation.contact_id)
      .maybeSingle();
    const guardado = await guardarEnvioDeLaBandeja(servicio, {
      conversationId,
      direction: "outbound",
      platformMessageId: messageId,
      text,
      attachments: null,
      messageType: "texto",
      quotedMessageId: null,
      remoteJid: (delLead as { platform_sender_id?: string } | null)?.platform_sender_id ?? null,
      createdAt: enviadoAt,
      sentByUserId: user.id,
    });
    if (guardado.error) {
      // El mensaje ya salió: no se responde error, porque reintentar lo
      // mandaría dos veces. El echo lo va a guardar igual, sin autor.
      console.error("[messages] enviado y no guardado:", guardado.error.message);
    }

    // Update conversation's last message info (ZernFlow-specific metadata)
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: messagePreview(text),
      })
      .eq("id", conversationId);

    // Return a message-shaped response for the UI's optimistic update
    return NextResponse.json(
      {
        id: guardado.id ?? messageId ?? `sent-${Date.now()}`,
        conversation_id: conversationId,
        direction: "outbound",
        text,
        attachments: null,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: messageId,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        created_at: enviadoAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to send message via Zernio API:", error);
    // F24: si fue por credenciales o conexión, la pantalla de integraciones se
    // entera. Con el cliente de servicio, porque el que responde puede ser un
    // Member, que no puede escribir en integration_configs.
    await registrarFalloDeZernio(await createServiceClient(), conversation.workspace_id, error);
    return NextResponse.json(
      { error: `Failed to send message: ${error}` },
      { status: 500 }
    );
  }
}
