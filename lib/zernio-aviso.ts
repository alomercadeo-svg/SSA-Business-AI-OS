/**
 * El adaptador del aviso de mensaje de Zernio (F27): de `message.received` y
 * `message.sent` a lo que guarda `lib/mensajes-guardado.ts`.
 *
 * La forma está tomada de dos entregas reales del log de Zernio, guardadas con
 * los datos reemplazados en `lib/fixtures/zernio-webhook-message-received.json`
 * y `lib/fixtures/zernio-webhook-message-sent.json` (08/10/2026, cuenta de
 * prueba @poderosascomunidad). Lo que dicen:
 *
 * - **En un saliente, el autor es la propia cuenta del negocio**: en la
 *   entrega real `sender.username` es igual a `account.username` y
 *   `sender.name` a `account.displayName`, y `sender.id` es distinto de
 *   `conversation.participantId`. El lead es el participante de la
 *   conversación. Por eso el contacto de un saliente sale de la conversación y
 *   nunca del autor. Ojo: ese `sender.id` NO es el `platform_account_id` que
 *   guarda `channels` (el `platformUserId` de Zernio): son dos familias de
 *   identificador distintas, comparado contra la base el 08/10/2026.
 * - En un entrante, `sender.id`, `sender.username` y `sender.name` son iguales
 *   a los del participante. Trae `instagramProfile` y no trae `picture`.
 * - Los dos fixtures son de la cuenta de prueba, y el saliente tiene
 *   `sentVia: "api"` (lo mandó nuestro servidor).
 * - **El echo de lo escrito desde la app de Instagram, observado el
 *   08/10/2026** (control 2, entrega de las 17:15:33 de Costa Rica, HTTP 200):
 *   llega como `message.sent` con `sentVia` NULO y `sender.username` igual a
 *   `account.username`, igual que el de la API. Así que el contacto sale de la
 *   conversación también ahí. `sentVia` es lo único que distingue los dos
 *   orígenes (`"api"` frente a nulo); hoy no se guarda.
 * - `message.platformMessageId` es el identificador que devuelve el listado de
 *   mensajes (`id`), medido el 21/09/2026: es lo que hace que el aviso y la
 *   importación no dupliquen.
 * - `sentAt` es la fecha del proveedor, en ISO.
 * - No trae referencia a un mensaje citado. Si Zernio la manda en algún caso,
 *   no está verificado: `quotedMessageId` queda nulo.
 */
import { tipoPorAdjuntos, type AdjuntoCrudo, type MensajeParaGuardar } from "./mensajes-guardado";

export interface AvisoDeMensajeZernio {
  id?: string;
  event: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments?: AdjuntoCrudo[] | null;
    sender: { id: string; name?: string | null; username?: string | null; picture?: string | null };
    sentAt?: string | null;
  };
  conversation: {
    id: string;
    platformConversationId?: string | null;
    participantId?: string | null;
    participantName?: string | null;
    participantUsername?: string | null;
    participantPicture?: string | null;
  };
  account: { id: string; platform?: string; username?: string };
  metadata?: {
    quickReplyPayload?: string;
    callbackData?: string;
    postbackPayload?: string;
  };
}

/** Los eventos de mensaje que se guardan. */
export const EVENTOS_DE_MENSAJE = ["message.received", "message.sent"] as const;

/**
 * ¿Es del negocio? `message.sent` siempre; `message.received` cuando viene con
 * dirección `outgoing`. Se compara contra `"outgoing"` y nada más: un literal
 * desconocido queda del lado del lead, igual que `traducirDireccion` en
 * `lib/zernio-message-map.ts`, para no atribuirle al negocio algo que escribió
 * un lead.
 */
export function esSaliente(aviso: Pick<AvisoDeMensajeZernio, "event" | "message">): boolean {
  return aviso.event === "message.sent" || aviso.message.direction === "outgoing";
}

/** El lead de la conversación: el autor si es entrante, el participante si es saliente. */
export function contactoDelAviso(aviso: AvisoDeMensajeZernio): {
  senderId: string;
  senderName: string;
  senderUsername: string | null;
  senderPicture: string | null;
} | null {
  const { message: msg, conversation: conv } = aviso;
  if (esSaliente(aviso)) {
    const id = conv.participantId || conv.platformConversationId;
    if (!id) return null;
    return {
      senderId: id,
      senderName: conv.participantName || conv.participantUsername || id,
      senderUsername: conv.participantUsername || null,
      senderPicture: conv.participantPicture || null,
    };
  }
  if (!msg.sender?.id) return null;
  return {
    senderId: msg.sender.id,
    senderName: msg.sender.name || msg.sender.username || msg.sender.id,
    senderUsername: msg.sender.username || null,
    senderPicture: msg.sender.picture || null,
  };
}

export function mensajeDelAviso(
  aviso: AvisoDeMensajeZernio,
  conversacionLocal: string,
  remoteJid: string,
): MensajeParaGuardar {
  const adjuntos = aviso.message.attachments?.length ? aviso.message.attachments : null;
  const texto = aviso.message.text?.trim() ? aviso.message.text : null;
  return {
    conversationId: conversacionLocal,
    direction: esSaliente(aviso) ? "outbound" : "inbound",
    platformMessageId: aviso.message.platformMessageId || null,
    text: texto,
    attachments: adjuntos,
    messageType: tipoPorAdjuntos(adjuntos),
    quotedMessageId: null,
    remoteJid,
    createdAt: aviso.message.sentAt || new Date().toISOString(),
  };
}
