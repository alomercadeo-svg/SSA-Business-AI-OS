import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * La hora de cada mensaje del hilo (F35, tramo B, pedido de Marcos el
 * 03/11/2026): «20:51» en la hora de Costa Rica, no «08:51 PM».
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { MessageThread } = await import("./message-thread");

const conversacion = {
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-04T02:51:00Z", is_automation_paused: false, contacts: { id: "ct1", display_name: "Ana", avatar_url: null },
};
const mensaje = { id: "m1", conversation_id: "c1", direction: "inbound", text: "hola", attachments: null, sent_by_flow_id: null, status: "sent", created_at: "2026-11-04T02:51:00Z" };

describe("la hora de cada mensaje del hilo", () => {
  it("en 24 horas y en la hora de Costa Rica", () => {
    const zona = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const html = renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [mensaje as never], hayAnteriores: false }));
      expect(html).toContain(">20:51<");
      expect(html).not.toMatch(/\d{2}:\d{2}\s?(AM|PM)/);
    } finally {
      process.env.TZ = zona;
    }
  });
});
