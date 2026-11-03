import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Lo que las pestañas de F35 (tramo A de S8) cambian fuera de la lista: el
 * hilo ya no ofrece posponer (no hay pestaña donde se vería), y el estado
 * vacío con «sincronizar» depende de que no haya ninguna conversación, no de
 * que la pestaña elegida esté vacía.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));

const { MessageThread } = await import("./message-thread");
const { InboxView } = await import("@/app/(dashboard)/dashboard/inbox/inbox-view");

const conversacion = {
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-03T12:00:00Z", last_message_preview: "hola", unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  is_automation_paused: false, contacts: { id: "ct1", display_name: "Ana", avatar_url: null },
};

describe("el hilo sin posponer", () => {
  it("no tiene el botón de posponer", () => {
    const html = renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [] }));
    expect(html).not.toContain("Snooze conversation");
  });
});

describe("el estado vacío de la bandeja", () => {
  const vista = (cantidades: { abiertas: number; cerradas: number; todas: number }, estado: string) =>
    renderToStaticMarkup(
      createElement(InboxView, {
        inicial: { conversaciones: [], hayMas: false, cantidades },
        estado,
        workspaceId: "ws-1",
      } as never),
    );

  it("con «Cerradas» vacía pero conversaciones en el espacio, no ofrece sincronizar", () => {
    expect(vista({ abiertas: 3, cerradas: 0, todas: 3 }, "closed")).not.toContain("Sincronizar conversaciones");
  });

  it("control: sin ninguna conversación en el espacio, sí lo ofrece", () => {
    expect(vista({ abiertas: 0, cerradas: 0, todas: 0 }, "open")).toContain("Sincronizar conversaciones");
  });
});
