/**
 * Traducción de los mensajes que devuelve Zernio a la forma que espera la bandeja.
 *
 * Vive acá y no dentro de la ruta porque es la única parte de
 * `/api/v1/messages` que puede equivocarse en silencio: un nombre de campo que
 * no existe no tira error, devuelve `undefined`, y la interfaz dibuja una
 * burbuja con la fecha correcta y nada adentro. Separado, tiene test con un
 * fixture de la respuesta real.
 *
 * ── LA FORMA REAL, OBSERVADA ─────────────────────────────────────────────────
 *
 * Verificada el 16 de septiembre de 2026 contra la API de Zernio, sobre la
 * cuenta de Instagram del negocio: 33 conversaciones. No sale de los tipos
 * generados del SDK, que en esta parte están desactualizados.
 *
 *     {
 *       id: "aWdfZAG1faXRlbToxOklHTWVzc2FnZ...",   // el id de la plataforma
 *       conversationId, accountId, platform,
 *       message: "el texto",                        // "" cuando no hay texto
 *       senderId, senderName,
 *       direction: "incoming" | "outgoing",
 *       createdAt: "2026-09-15T12:38:37.000Z",
 *       sentAt: "2026-09-15T12:38:37.000Z",
 *       attachments: [{ url, type, refreshUrl }],
 *       isStoryMention, isEdited, editCount, editHistory,
 *       isDeleted, deliveryStatus, sentVia
 *     }
 *
 * DÓNDE LOS TIPOS DEL SDK MIENTEN, y por qué este módulo no se apoya en ellos:
 *
 *   * Los adjuntos están declarados como
 *     `{ id, type, url, filename, previewUrl }`. Lo que llega es
 *     `{ url, type, refreshUrl }`: no existen `id`, `filename` ni `previewUrl`,
 *     y `refreshUrl` no está declarada en ningún lado pese a ser lo único que
 *     permite volver a firmar la URL cuando venza.
 *   * La documentación del SDK afirma que `platformMessageId` está disponible
 *     "from webhooks or the list-messages endpoint". En este endpoint NO viene.
 *     El id de la plataforma es `id`: es el mismo valor que aparece en la ruta
 *     de la `refreshUrl` de los adjuntos.
 *   * El campo `sentVia` llega y no está declarado.
 */

/** Forma de la bandeja. Es la de la tabla `messages` del fork. */
export interface MensajeDeBandeja {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: AdjuntoDeZernio[] | null;
  quick_reply_payload: string | null;
  postback_payload: string | null;
  callback_data: string | null;
  platform_message_id: string | null;
  sent_by_flow_id: string | null;
  sent_by_node_id: string | null;
  sent_by_user_id: string | null;
  status: string;
  created_at: string;
}

/** Adjunto tal como llega, no como lo declara el SDK. */
export interface AdjuntoDeZernio {
  url?: string;
  type?: string;
  /** URL de Zernio para volver a firmar `url` cuando la firma de Meta venza. */
  refreshUrl?: string;
}

/** Los campos que este módulo lee. Todo lo demás del mensaje se ignora. */
interface MensajeDeZernio {
  id?: string;
  message?: string | null;
  direction?: string;
  createdAt?: string | null;
  sentAt?: string | null;
  attachments?: AdjuntoDeZernio[] | null;
}

/**
 * Traduce la dirección.
 *
 * ACÁ ESTABA EL BUG. Los literales de Zernio son `"incoming"` y `"outgoing"`;
 * el código comparaba contra `"outbound"`, que no existe en ninguna respuesta.
 * Esa comparación nunca daba verdadero, así que TODOS los mensajes caían en el
 * `else` y el hilo entero se dibujaba alineado como entrante, incluidos los que
 * había escrito el propio negocio.
 *
 * Se compara contra `"outgoing"` y no contra `"incoming"` a propósito: si algún
 * día aparece un literal nuevo, que caiga del lado del contacto. Atribuirle al
 * negocio un mensaje que no escribió es peor que lo contrario.
 */
function traducirDireccion(direction: string | undefined): "inbound" | "outbound" {
  return direction === "outgoing" ? "outbound" : "inbound";
}

/**
 * Normaliza el texto.
 *
 * El campo se llama `message`. **No existe ningún `text`** en esta respuesta.
 *
 * Aclaración que importa para no atribuirle a este módulo un bug que no tenía:
 * el mapeo viejo hacía `m.text ?? m.message ?? null`, así que el `?? m.message`
 * ya leía el campo correcto y el texto SÍ llegaba. Se saca el `m.text` porque
 * es código muerto que sugiere un campo inexistente, no porque estuviera
 * rompiendo nada.
 *
 * Lo que sí se agrega es normalizar la cadena vacía a `null`. Zernio devuelve
 * `message: ""` para los mensajes sin texto, y la burbuja renderiza
 * `{message.text && <p>}`: con `""` el `&&` ya cortaba, pero dejar `""` hace que
 * "no hay texto" y "no encontré el campo" se vean igual desde el servidor, que
 * es justo la confusión que hizo difícil diagnosticar esto.
 */
function normalizarTexto(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  return message.length > 0 ? message : null;
}

/**
 * Elige la fecha.
 *
 * `createdAt` es la canónica y viene siempre. `sentAt` también llega, y en todo
 * lo observado con el mismo valor, pero según el SDK es "original send time for
 * outgoing messages" y puede ser null. El mapeo viejo prefería `sentAt`, lo cual
 * funcionaba por casualidad.
 *
 * El último recurso es la fecha de ahora, y conviene saber que es un parche
 * feo: si algún día el campo cambiara de nombre, esto haría que todos los
 * mensajes aparezcan fechados en este instante en vez de romperse de forma
 * visible. Se conserva porque una fecha inventada es preferible a una burbuja
 * que tira excepción al formatear, pero es la razón por la que el test fija la
 * fecha contra el fixture.
 */
function elegirFecha(m: MensajeDeZernio): string {
  return m.createdAt ?? m.sentAt ?? new Date().toISOString();
}

/**
 * Cuántos mensajes se piden.
 *
 * El endpoint topea en 100: pedir 200 devuelve 100 igual, comprobado. Así que
 * este número no es una preferencia, es el techo de la API.
 */
export const TAMANO_DE_PAGINA = 100;

export interface MensajesDeConversacion {
  messages: MensajeDeBandeja[];
  /** true cuando la conversación tiene mensajes más viejos que los devueltos. */
  hayAnteriores: boolean;
}

/** Lo mínimo del cliente de Zernio que esta función necesita. */
export interface ClienteDeMensajes {
  messages: {
    getInboxConversationMessages(opts: {
      path: { conversationId: string };
      query: { accountId: string; limit?: number; sortOrder?: "asc" | "desc"; cursor?: string };
    }): Promise<{
      data?: {
        messages?: unknown[];
        pagination?: { hasMore?: boolean; nextCursor?: string | null };
      };
    }>;
  };
}

/**
 * Trae la última página de una conversación, en orden cronológico.
 *
 * ── EL BUG QUE ESTO ARREGLA ─────────────────────────────────────────────────
 *
 * Se pedía sin `sortOrder` ni `limit`. El default del endpoint es 100 mensajes
 * en orden ASCENDENTE, así que lo que llegaba era la página de los 100 MÁS
 * VIEJOS, y nadie pedía la siguiente. Medido contra la API real el 16/09/2026,
 * sobre la conversación `1331828025829865`:
 *
 *     pagina 1: 100 mensajes  2024-06-27 -> 2026-08-25  hasMore=true
 *     pagina 2:  11 mensajes  2026-08-29 -> 2026-09-17  hasMore=false
 *
 * El hilo terminaba el 25 de agosto porque ahí terminaba la página uno.
 *
 * ── POR QUÉ `desc` Y NO PAGINAR HACIA ADELANTE ──────────────────────────────
 *
 * Paginar en ascendente con un tope de páginas reintroduce exactamente el mismo
 * bug, solo que más lejos: con tope de 5 páginas, una conversación de 600
 * mensajes vuelve a cortar lo reciente, y el síntoma sería idéntico y aún más
 * difícil de encontrar. El tope no se puede sacar, porque entonces el costo de
 * abrir un hilo crece con el largo del historial.
 *
 * Pedir `desc` invierte cuál es la mitad que se sacrifica, y esa es la elección
 * correcta para un chat: **una sola llamada, sin importar el largo, y lo
 * reciente nunca se corta**. Lo que queda afuera es el historial viejo, que es
 * lo que uno va a buscar a propósito, no lo que espera ver al abrir.
 *
 * Lo que NO se puede hacer es callarse el corte. Cambiar "faltan los nuevos sin
 * avisar" por "faltan los viejos sin avisar" no sería una mejora: por eso se
 * devuelve `hayAnteriores` y la pantalla lo muestra.
 *
 * La API entrega los recientes primero, y la pantalla los necesita al revés, así
 * que se revierte acá.
 */
export async function traerMensajesDeConversacion(
  zernio: ClienteDeMensajes,
  opts: {
    conversationIdDeZernio: string;
    accountId: string;
    conversationIdLocal: string;
  }
): Promise<MensajesDeConversacion> {
  const res = await zernio.messages.getInboxConversationMessages({
    path: { conversationId: opts.conversationIdDeZernio },
    query: {
      accountId: opts.accountId,
      sortOrder: "desc",
      limit: TAMANO_DE_PAGINA,
    },
  });

  const crudos = res.data?.messages ?? [];

  // `hasMore` sobre una consulta descendente significa "hay más VIEJOS", que es
  // justo lo que el indicador tiene que anunciar.
  const hayAnteriores = res.data?.pagination?.hasMore === true;

  return {
    messages: mapearMensajesDeZernio(crudos, opts.conversationIdLocal).reverse(),
    hayAnteriores,
  };
}

export function mapearMensajesDeZernio(
  crudos: unknown[],
  conversationId: string
): MensajeDeBandeja[] {
  return (crudos as MensajeDeZernio[]).map((m) => ({
    id: m.id ?? "",
    conversation_id: conversationId,
    direction: traducirDireccion(m.direction),
    text: normalizarTexto(m.message),
    attachments: m.attachments?.length ? m.attachments : null,
    quick_reply_payload: null,
    postback_payload: null,
    callback_data: null,
    // `id` ES el id de la plataforma. No existe `platformMessageId` acá.
    platform_message_id: m.id ?? null,
    sent_by_flow_id: null,
    sent_by_node_id: null,
    sent_by_user_id: null,
    status: "sent",
    created_at: elegirFecha(m),
  }));
}
