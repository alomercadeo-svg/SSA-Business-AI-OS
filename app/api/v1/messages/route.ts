import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/vault";
import { messagePreview } from "@/lib/message-preview";
import { registrarFalloDeZernio } from "@/lib/integraciones-estado";
import { guardarEnvioDeLaBandeja } from "@/lib/mensajes-guardado";

/** Cuántos mensajes trae el hilo de una vez: los más recientes. */
export const MENSAJES_POR_HILO = 200;

/**
 * GET /api/v1/messages?conversationId=...
 *
 * Lee los mensajes de la BASE (F27): desde el 08/10/2026 la base es la fuente
 * de verdad de la bandeja, y esta ruta no consulta más al proveedor. Lee con
 * el cliente del usuario, así que el scope de leads lo aplica la RLS.
 *
 * Devuelve además el estado del historial de la conversación: si no está
 * entero en la base (la importación no la terminó, o la cuenta está
 * desconectada), el hilo lo dice en vez de verse vacío o incompleto sin
 * explicación. El 08/10/2026 una cuenta desconectada mostraba un hilo vacío y
 * sin aviso, porque le pedía los mensajes a Zernio.
 *
 * Los adjuntos viajan SIN la dirección del proveedor: solo el tipo y su estado.
 * La URL de Meta vence y no tiene por qué llegar al navegador; el archivo se
 * muestra desde Storage cuando F28 lo baje.
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

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, historial_estado, channels(is_active)")
    .eq("id", conversationId)
    .maybeSingle();

  // Sin fila hay dos causas posibles y para el usuario son la misma: o la
  // conversación se borró, o dejó de estar en su scope porque le reasignaron el
  // lead. La RLS devuelve vacío en los dos casos, así que no se pueden
  // distinguir desde acá, y tampoco conviene: decir "existe pero no es tuya"
  // confirma la existencia de un lead ajeno.
  if (!conversation) {
    return NextResponse.json(
      {
        error: "Esta conversación ya no está disponible para vos",
        code: "fuera_de_scope",
      },
      { status: 403 }
    );
  }

  const { data: filas, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, direction, text, attachments, quick_reply_payload, postback_payload, callback_data, platform_message_id, remote_jid, message_type, quoted_message_id, media_path, media_status, sent_by_flow_id, sent_by_node_id, sent_by_user_id, status, created_at"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MENSAJES_POR_HILO + 1);

  if (error) {
    console.error("[messages] no se pudieron leer los mensajes:", error.message);
    return NextResponse.json({ error: "No se pudieron leer los mensajes" }, { status: 500 });
  }

  const recientes = (filas ?? []).slice(0, MENSAJES_POR_HILO).reverse();
  const canal = conversation.channels as { is_active?: boolean } | null;
  return NextResponse.json({
    messages: recientes.map((m) => ({ ...m, attachments: adjuntosSinDireccion(m.attachments) })),
    hayAnteriores: (filas ?? []).length > MENSAJES_POR_HILO,
    historial: {
      estado: conversation.historial_estado,
      canalActivo: canal?.is_active !== false,
    },
  });
}

/** Solo el tipo de cada adjunto: la dirección del proveedor no sale del servidor. */
function adjuntosSinDireccion(adjuntos: unknown): { type: string | null }[] | null {
  if (!Array.isArray(adjuntos) || adjuntos.length === 0) return null;
  return adjuntos.map((a) => ({ type: typeof a?.type === "string" ? a.type : null }));
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
