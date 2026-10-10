import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble, TEXTO_ADJUNTO_FALLIDO, TEXTO_ADJUNTO_NO_DISPONIBLE } from "./message-thread";

/**
 * F28, 5g: la burbuja muestra el archivo bajado con la dirección firmada que da
 * `GET /api/v1/messages` (`archivo`). Datos de prueba, con la forma de esa
 * respuesta; las direcciones son inventadas.
 *
 * El reproductor se elige por `message_type`, no por `media_mime`: la nota de
 * voz de Instagram se detecta como `video/mp4` (prueba real del 09/10/2026,
 * `48a50018`), porque su cabecera no la distingue de un video.
 */
const base = {
  id: "m-1", conversation_id: "c-1", direction: "inbound", text: null,
  attachments: [{ type: "image" }], quick_reply_payload: null, postback_payload: null, callback_data: null,
  platform_message_id: "x", remote_jid: null, message_type: "imagen", quoted_message_id: null,
  media_status: "descargado", sent_by_flow_id: null, sent_by_node_id: null, sent_by_user_id: null,
  status: "sent", created_at: "2026-10-09T18:29:15Z", archivo: null,
};
const html = (m: Record<string, unknown>) => renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, ...m } as never }));
const URL = "https://storage.ejemplo.invalid/firmada/a?token=t";

describe("la burbuja de un adjunto (F28)", () => {
  it("una imagen bajada se ve con <img>, no como «Adjunto»", () => {
    const h = html({ archivo: { url: URL, mime: "image/jpeg" } });
    expect(h).toContain(`<img`);
    expect(h).toContain(`src="${URL.replace("&", "&amp;")}"`);
    expect(h).not.toContain("Adjunto");
  });

  it("un video bajado se ve con <video controls>", () => {
    const h = html({ message_type: "video", attachments: [{ type: "video" }], archivo: { url: URL, mime: "video/mp4" } });
    expect(h).toMatch(/<video[^>]*controls/);
  });

  it("una nota de voz detectada como video/mp4 se ve con <audio controls>, por message_type", () => {
    const h = html({ message_type: "audio", attachments: [{ type: "audio" }], archivo: { url: URL, mime: "video/mp4" } });
    expect(h).toMatch(/<audio[^>]*controls/);
    expect(h).not.toContain("<video");
  });

  it("fallido y no_disponible dicen su texto, sin afirmar causas", () => {
    expect(html({ media_status: "fallido" })).toContain(TEXTO_ADJUNTO_FALLIDO);
    expect(html({ media_status: "no_disponible" })).toContain(TEXTO_ADJUNTO_NO_DISPONIBLE);
    expect(TEXTO_ADJUNTO_FALLIDO).toBe("Todavía no pudimos traer este archivo. Se vuelve a intentar solo.");
    expect(TEXTO_ADJUNTO_NO_DISPONIBLE).toBe("Este archivo no está disponible.");
  });

  it("un histórico pendiente y un ephemeral se ven como hoy: «Adjunto»", () => {
    for (const m of [
      { media_status: "pendiente" },
      { media_status: "pendiente", message_type: "otro", attachments: [{ type: "ephemeral" }] },
    ]) {
      const h = html(m);
      expect(h).toContain("Adjunto");
      expect(h).not.toContain("<img");
      expect(h).not.toContain(TEXTO_ADJUNTO_FALLIDO);
    }
  });
});
