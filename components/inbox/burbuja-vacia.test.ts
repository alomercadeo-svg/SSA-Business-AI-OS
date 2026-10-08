import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble, TEXTO_SIN_CONTENIDO } from "./message-thread";

/**
 * Un mensaje importado sin texto ni adjunto: el listado de mensajes de Zernio
 * devuelve `message: ""` para buena parte del historial viejo de Instagram
 * (nota de F27), y la importación del 08/10/2026 trajo 825 así. Datos de
 * prueba, con la forma de la fila que devuelve `GET /api/v1/messages`.
 */
const vacio = {
  id: "m-vacio", conversation_id: "c-1", direction: "inbound", text: null, attachments: null,
  quick_reply_payload: null, postback_payload: null, callback_data: null, platform_message_id: "x",
  remote_jid: null, message_type: "texto", quoted_message_id: null, media_path: null, media_status: null,
  sent_by_flow_id: null, sent_by_node_id: null, sent_by_user_id: null, status: "sent", created_at: "2026-09-02T17:59:59Z",
} as const;

describe("burbuja de un mensaje sin texto ni adjunto", () => {
  it("no se ve como una burbuja vacía: dice que el contenido no está disponible", () => {
    expect(TEXTO_SIN_CONTENIDO).toBe("El contenido de este mensaje no está disponible.");
    const html = renderToStaticMarkup(createElement(MessageBubble, { message: vacio as never }));
    expect(html).toContain(TEXTO_SIN_CONTENIDO);
  });

  it("control positivo: un mensaje con texto muestra su texto y no el aviso", () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, { message: { ...vacio, text: "hola" } as never }));
    expect(html).toContain("hola");
    expect(html).not.toContain(TEXTO_SIN_CONTENIDO);
  });
});
