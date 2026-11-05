import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F43, criterio 5, en la bandeja: el contacto cuyo nombre es su identificador
 * de remitente se ve «Sin nombre» (o «@usuario» si tiene) en la lista y en el
 * encabezado del hilo. La regla está en lib/nombre-visible.ts; el panel la
 * usa con los canales que lee él mismo.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/dashboard/inbox", useSearchParams: () => new URLSearchParams() }));
const { ConversationList } = await import("./conversation-list");
const { MessageThread } = await import("./message-thread");

const limpio = (html: string) => html.replace(/<!-- -->/g, "");
const conv = (id: string, contacto: Record<string, unknown>) => ({
  id, workspace_id: "ws-1", contact_id: `ct-${id}`, channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-03T12:00:00Z", last_message_preview: "hola", unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  is_automation_paused: false, window_expires_at: "2099-01-01T00:00:00Z",
  contacts: { id: `ct-${id}`, avatar_url: null, ...contacto },
});
const SIN = conv("a", { display_name: "17841400000001", contact_channels: [{ platform_sender_id: "17841400000001", platform_username: null }] });
const ALIAS = conv("b", { display_name: "17841400000002", contact_channels: [{ platform_sender_id: "17841400000002", platform_username: "tania_roblesc" }] });
const NOMBRE = conv("c", { display_name: "Tania Robles", contact_channels: [{ platform_sender_id: "17841400000003", platform_username: null }] });

const lista = () =>
  limpio(renderToStaticMarkup(createElement(ConversationList, {
    inicial: { conversaciones: [SIN, ALIAS, NOMBRE], hayMas: false, cantidades: { abiertas: 3, cerradas: 0, todas: 3 } },
    workspaceId: "ws-1", selectedId: null, onSelect: () => {},
  } as never)));

describe("la lista de la bandeja", () => {
  it("el nombre de verdad se ve (control)", () => {
    expect(lista()).toContain(">Tania Robles<");
  });
  it("el identificador como nombre: «Sin nombre», no el número", () => {
    expect(lista()).toContain(">Sin nombre<");
    expect(lista()).not.toContain(">17841400000001<");
  });
  it("con usuario: «@usuario»", () => {
    expect(lista()).toContain(">@tania_roblesc<");
    expect(lista()).not.toContain(">17841400000002<");
  });
});

describe("el encabezado del hilo", () => {
  it("«Sin nombre», no el número", () => {
    const h = limpio(renderToStaticMarkup(createElement(MessageThread, { conversation: SIN as never, messages: [] })));
    expect(h).toContain(">Sin nombre<");
    expect(h).not.toContain(">17841400000001<");
  });
});
