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
    expect(dibujar({ estado: "all" })).toContain("50 de 761");
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

describe("la búsqueda (c): corre en el servidor y vive en la dirección", () => {
  it("el buscador arranca con lo buscado que vino en la dirección (?q=)", () => {
    expect(dibujar({ busqueda: "ana" })).toMatch(/<input[^>]*value="ana"/);
  });

  it("el buscador dice por qué se busca", () => {
    expect(dibujar({})).toContain('placeholder="Buscar por nombre, usuario, correo o teléfono"');
  });

  it("lo que trajo el servidor no se vuelve a filtrar en el navegador: el servidor también busca por usuario y teléfono", () => {
    const html = dibujar({ busqueda: "8888-7777", estado: "all" });
    expect(html).toContain("Contacto 7");
    expect(html).toContain("50 de 761");
  });

  it("una búsqueda sin resultados lo dice", () => {
    const html = dibujar({ busqueda: "nadie", inicial: { conversaciones: [], hayMas: false, cantidades: { abiertas: 0, cerradas: 0, todas: 0 } } });
    expect(html).toContain("Ninguna conversación coincide con «nadie»");
  });
});

describe("las pestañas (e): «Abiertas», «Cerradas» y «Todas», con la cantidad del servidor", () => {
  it("las tres, con su cantidad", () => {
    const html = dibujar({ estado: "open" });
    expect(html).toMatch(/Abiertas[^<]*<span[^>]*>700</);
    expect(html).toMatch(/Cerradas[^<]*<span[^>]*>61</);
    expect(html).toMatch(/Todas[^<]*<span[^>]*>761</);
  });

  it("no hay pestaña de pospuestas", () => {
    const html = dibujar({ estado: "open" });
    expect(html).not.toMatch(/>snoozed</i);
    expect(html).not.toContain("Pospuestas");
  });

  it("arriba, las cargadas de la pestaña elegida", () => {
    expect(dibujar({ estado: "open" })).toContain("50 de 700");
    expect(dibujar({ estado: "closed" })).toContain("50 de 61");
  });
});
