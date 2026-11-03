import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * El hilo con más de 200 mensajes (F35, tramo A de S8). Hasta el 03/11/2026
 * solo avisaba «Hay mensajes anteriores que no se muestran acá», sin forma de
 * traerlos.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { MessageThread } = await import("./message-thread");

const conversacion = {
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-03T12:00:00Z", is_automation_paused: false, contacts: { id: "ct1", display_name: "Ana", avatar_url: null },
};
const mensaje = { id: "m1", conversation_id: "c1", direction: "inbound", text: "hola", attachments: null, sent_by_flow_id: null, status: "sent", created_at: "2026-11-03T12:00:00Z" };
const dibujar = (hayAnteriores: boolean) =>
  renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [mensaje as never], hayAnteriores }));

describe("los mensajes anteriores a los últimos 200", () => {
  it("con anteriores, el hilo ofrece «Ver mensajes anteriores»", () => {
    expect(dibujar(true)).toMatch(/<button[^>]*>.*Ver mensajes anteriores/);
  });

  it("sin anteriores, no lo ofrece", () => {
    expect(dibujar(false)).not.toContain("Ver mensajes anteriores");
  });
});
