import { describe, it, expect } from "vitest";
import { mapearMensajesDeZernio } from "./zernio-message-map";

/**
 * Fija la forma REAL de la respuesta de
 * `zernio.messages.getInboxConversationMessages`.
 *
 * DE DÓNDE SALE ESTE FIXTURE
 * De una llamada real a la API de Zernio contra la cuenta de Instagram del
 * negocio, el 16 de septiembre de 2026: 5 conversaciones, 24 mensajes. Los
 * nombres de campo, los literales de `direction`, el formato de las fechas, el
 * formato de los identificadores y la forma de los adjuntos son los observados.
 * Lo único sintético es el contenido: el texto y los nombres de las personas se
 * reemplazaron, porque son conversaciones con clientes reales y no van a un
 * repositorio.
 *
 * NO SALE DE LOS TIPOS GENERADOS DEL SDK, y la diferencia importa: los tipos de
 * `@zernio/node` 0.2.519 declaran para los adjuntos
 * `{ id, type, url, filename, previewUrl }`, y lo que llega de verdad es
 * `{ url, type, refreshUrl }`. Ni `id`, ni `filename`, ni `previewUrl` existen,
 * y `refreshUrl` no está declarado en ningún lado. Los tipos son una guía, no
 * la verdad.
 *
 * POR QUÉ ESTE TEST EXISTE
 * Un nombre de campo equivocado no rompe nada de forma visible: devuelve
 * `undefined`, el mapeo lo convierte en `null`, y la bandeja dibuja una burbuja
 * vacía con la fecha correcta. El bug estuvo a la vista sin que nada fallara.
 * Lo único que lo detecta es fijar la forma de la respuesta contra un ejemplo
 * real.
 */

/**
 * Mensaje entrante con texto. En la respuesta real `direction` es `"incoming"`,
 * no `"inbound"`.
 */
const ENTRANTE_CON_TEXTO = {
  id: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDY2NTkxNjMyMDgzOjM0MDI4MjM2Njg0MTcxMDMwMTI0",
  conversationId: "2587551905030303",
  accountId: "6aab34cb8d284ffb210b9700",
  platform: "instagram",
  message: "Hola! Me interesa saber el precio",
  senderId: "2587551905030303",
  senderName: "Nombre De Prueba",
  direction: "incoming",
  createdAt: "2026-09-15T12:38:37.000Z",
  attachments: [],
  isStoryMention: false,
  isEdited: false,
  editCount: 0,
  editHistory: [],
  isDeleted: false,
  deliveryStatus: null,
  sentAt: "2026-09-15T12:38:37.000Z",
  sentVia: null,
};

/**
 * Mensaje saliente. El literal real es `"outgoing"`, no `"outbound"`: por eso
 * la condición vieja nunca daba verdadero y TODO el hilo se alineaba como
 * entrante.
 */
const SALIENTE_CON_TEXTO = {
  id: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDY2NTkxNjMyMDgzOjM0MDI4MjM2Njg0MTcxMDMwMTI1",
  conversationId: "2587551905030303",
  accountId: "6aab34cb8d284ffb210b9700",
  platform: "instagram",
  message: "Hola! Te paso la info por privado",
  senderId: "17841466591632083",
  senderName: "El Negocio",
  direction: "outgoing",
  createdAt: "2026-09-08T00:18:42.000Z",
  attachments: [],
  isStoryMention: false,
  isEdited: false,
  editCount: 0,
  editHistory: [],
  isDeleted: false,
  deliveryStatus: null,
  sentAt: "2026-09-08T00:18:42.000Z",
  sentVia: null,
};

/**
 * Mensaje solo con imagen. El `message` real viene como cadena VACÍA, no null y
 * no ausente: hay que distinguir "sin texto" de "no lo encontré".
 *
 * La forma del adjunto es la observada: `url` firmada de `lookaside.fbsbx.com`,
 * `type`, y una `refreshUrl` de Zernio para volver a firmarla cuando venza.
 */
const ENTRANTE_SOLO_IMAGEN = {
  id: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDY2NTkxNjMyMDgzOjM0MDI4MjM2Njg0MTcxMDMwMTI2",
  conversationId: "1898352451125489",
  accountId: "6aab34cb8d284ffb210b9700",
  platform: "instagram",
  message: "",
  senderId: "1898352451125489",
  senderName: "Nombre De Prueba",
  direction: "incoming",
  createdAt: "2026-09-15T13:10:03.000Z",
  attachments: [
    {
      url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1581335140391629&signature=Ab2m-0JR6FTox86",
      type: "image",
      refreshUrl:
        "https://zernio.com/api/v1/inbox/conversations/1898352451125489/messages/aWdfZAG1faXRlbTox/attachments/0?accountId=6aab34cb8d284ffb210b9700",
    },
  ],
  isStoryMention: false,
  isEdited: false,
  editCount: 0,
  editHistory: [],
  isDeleted: false,
  deliveryStatus: null,
  sentAt: "2026-09-15T13:10:03.000Z",
  sentVia: null,
};

const CONV = "c888423f-572f-4e4e-a9c4-91a0ea863a29";

describe("mapeo de los mensajes de Zernio", () => {
  // ── El texto ──────────────────────────────────────────────────────────────
  //
  // El campo se llama `message`. No existe ningún `text` en la respuesta.
  //
  // PERO EL TEXTO NO ESTABA ROTO, y conviene dejarlo escrito para no
  // atribuirle al mapeo un bug que no tenía: la versión vieja hacía
  // `m.text ?? m.message ?? null`, así que el segundo término ya leía el campo
  // correcto. Este test pasaba TAMBIÉN contra el código sin arreglar.
  //
  // Se conserva igual porque fija el nombre del campo: si mañana alguien
  // "limpia" el mapeo y deja solo `m.text`, esto falla.

  it("saca el texto del campo message", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    expect(m.text).toBe("Hola! Me interesa saber el precio");
  });

  it("no inventa texto donde no hay: un mensaje solo con imagen queda en null", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_SOLO_IMAGEN], CONV);
    // La cadena vacía se normaliza a null para que la burbuja no reserve lugar
    // para un párrafo que no tiene nada adentro.
    expect(m.text).toBeNull();
  });

  // ── La dirección ──────────────────────────────────────────────────────────
  //
  // Los literales son "incoming" y "outgoing". La condición vieja comparaba
  // contra "outbound", que no existe, así que TODO caía en "inbound".

  it("traduce incoming a inbound", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    expect(m.direction).toBe("inbound");
  });

  it("traduce outgoing a outbound", () => {
    const [m] = mapearMensajesDeZernio([SALIENTE_CON_TEXTO], CONV);
    expect(m.direction).toBe("outbound");
  });

  it("no alinea todo del mismo lado cuando el hilo tiene de los dos", () => {
    // La forma en que se ve el bug: un hilo con mensajes de ida y vuelta que se
    // dibuja entero como si lo hubiera escrito el contacto.
    const hilo = mapearMensajesDeZernio(
      [ENTRANTE_CON_TEXTO, SALIENTE_CON_TEXTO, ENTRANTE_SOLO_IMAGEN],
      CONV,
    );
    expect(hilo.map((m) => m.direction)).toEqual(["inbound", "outbound", "inbound"]);
  });

  // ── El identificador de plataforma ────────────────────────────────────────

  it("usa id como identificador de plataforma, que es el único que viene", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    // No existe ningún `platformMessageId` en esta respuesta, pese a que la
    // documentación del SDK dice que sí. `id` ES el id de la plataforma: es el
    // mismo valor que aparece en la ruta de la `refreshUrl` de los adjuntos.
    expect(m.platform_message_id).toBe(ENTRANTE_CON_TEXTO.id);
  });

  // ── La fecha ──────────────────────────────────────────────────────────────

  it("toma la fecha de createdAt", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    expect(m.created_at).toBe("2026-09-15T12:38:37.000Z");
  });

  it("no cae a la fecha de hoy cuando el mensaje trae la suya", () => {
    // El fallback `new Date().toISOString()` es el que hacía que un mapeo roto
    // igual mostrara una fecha creíble. Con un campo mal nombrado, todos los
    // mensajes aparecerían fechados ahora.
    const sinSentAt = { ...ENTRANTE_CON_TEXTO, sentAt: null };
    const [m] = mapearMensajesDeZernio([sinSentAt], CONV);
    expect(m.created_at).toBe("2026-09-15T12:38:37.000Z");
  });

  // ── Los adjuntos ──────────────────────────────────────────────────────────

  it("pasa los adjuntos con su forma real", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_SOLO_IMAGEN], CONV);
    expect(m.attachments).toHaveLength(1);
    const [a] = m.attachments as Array<Record<string, unknown>>;
    expect(a.type).toBe("image");
    expect(a.url).toContain("lookaside.fbsbx.com");
    // `refreshUrl` no está declarada en los tipos del SDK pero llega, y es lo
    // único que permite volver a firmar la URL cuando venza.
    expect(a.refreshUrl).toContain("zernio.com");
  });

  it("deja attachments en null cuando el array viene vacío", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    expect(m.attachments).toBeNull();
  });

  // ── Contrato con la bandeja ───────────────────────────────────────────────

  it("devuelve el conversationId local, no el de Zernio", () => {
    const [m] = mapearMensajesDeZernio([ENTRANTE_CON_TEXTO], CONV);
    // La bandeja indexa por el id de nuestra tabla; el de Zernio no le sirve.
    expect(m.conversation_id).toBe(CONV);
    expect(m.conversation_id).not.toBe(ENTRANTE_CON_TEXTO.conversationId);
  });

  it("no revienta con una lista vacía", () => {
    expect(mapearMensajesDeZernio([], CONV)).toEqual([]);
  });
});
