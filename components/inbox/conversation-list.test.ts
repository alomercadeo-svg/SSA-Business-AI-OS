import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationList } from "./conversation-list";

/**
 * La lista de la bandeja (F35, tramo A de S8), dibujada en el servidor con los
 * datos de la primera página. Hasta el 03/11/2026 el contador de arriba
 * contaba las cargadas (medido el 22/09/2026: decía 50 con 200) y no había
 * forma de traer más.
 */

const conversacion = (i: number) => ({
  id: `c${i}`, workspace_id: "ws-1", contact_id: `ct${i}`, channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-03T12:00:00Z", last_message_preview: `hola ${i}`, unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  contacts: { id: `ct${i}`, display_name: `Contacto ${i}`, avatar_url: null },
});

const dibujar = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ConversationList, {
      inicial: { conversaciones: Array.from({ length: 50 }, (_, i) => conversacion(i)), hayMas: true, cantidades: { abiertas: 700, cerradas: 61, todas: 761 } },
      workspaceId: "ws-1",
      selectedId: null,
      onSelect: () => {},
      ...props,
    } as never),
  ).replace(/<!-- -->/g, "");

describe("la lista de la bandeja", () => {
  it("arriba dice cuántas hay cargadas de cuántas hay en el servidor", () => {
    expect(dibujar({})).toContain("50 de 761");
  });

  it("con más en el servidor, al pie está «Cargar más conversaciones»", () => {
    expect(dibujar({})).toContain("Cargar más conversaciones");
  });

  it("sin más, el botón no está", () => {
    const html = dibujar({ inicial: { conversaciones: [conversacion(1)], hayMas: false, cantidades: { abiertas: 1, cerradas: 0, todas: 1 } } });
    expect(html).not.toContain("Cargar más conversaciones");
    expect(html).toContain("1 de 1");
  });
});
