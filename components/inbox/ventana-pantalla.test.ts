import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F40 en pantalla (S9, tramo A): la marca de la lista (el criterio reescrito
 * el 05/11/2026 y D12), el encabezado del hilo, el campo con la ventana
 * abierta, por vencer (D4) o cerrada, y el bloque de la ventana cerrada con
 * sus cuatro casos (el botón «Escribir por WhatsApp», el texto de F40, D7 y
 * el de §11). WhatsApp nunca muestra ventana.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/dashboard/inbox", useSearchParams: () => new URLSearchParams() }));
const { ConversationList } = await import("./conversation-list");
const { MessageThread } = await import("./message-thread");
const { VistaVentanaCerrada } = await import("./ventana-cerrada");

const H = 60 * 60 * 1000;
const AHORA = Date.parse("2026-11-05T20:00:00.000Z");
const limpio = (html: string) => html.replace(/<!-- -->/g, "");
const texto = (html: string) => limpio(html).replace(/<[^>]+>/g, "|");

const conv = (campos: Record<string, unknown> = {}) => ({
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-05T19:00:00Z", last_message_preview: "hola", unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  is_automation_paused: false, window_expires_at: null, window_source: null,
  contacts: { id: "ct1", display_name: "Ana", avatar_url: null, phone: null, phone_resolved: true },
  ...campos,
});
const vence = (ms: number) => new Date(AHORA + ms).toISOString();

const lista = (conversaciones: unknown[]) =>
  limpio(
    renderToStaticMarkup(
      createElement(ConversationList, {
        inicial: { conversaciones, hayMas: false, cantidades: { abiertas: conversaciones.length, cerradas: 0, todas: conversaciones.length } },
        workspaceId: "ws-1",
        selectedId: null,
        onSelect: () => {},
        ahora: AHORA,
      } as never),
    ),
  );
const hilo = (c: unknown) => limpio(renderToStaticMarkup(createElement(MessageThread, { conversation: c, messages: [], ahora: AHORA } as never)));

describe("la lista: solo lo que pide atención (criterio reescrito, D12)", () => {
  it("cerrada: «Ventana cerrada», en gris", () => {
    const h = lista([conv({ window_expires_at: vence(-H) })]);
    expect(h).toMatch(/<span[^>]*text-muted-foreground[^>]*>Ventana cerrada<\/span>/);
  });
  it("por vencer: «Vence en 1 h 20 min», en ámbar", () => {
    const h = lista([conv({ window_expires_at: vence(80 * 60000) })]);
    expect(h).toMatch(/<span[^>]*amber[^>]*>Vence en 1 h 20 min<\/span>/);
  });
  it("abierta con más de 2 horas: nada", () => {
    const h = lista([conv({ window_expires_at: vence(10 * H) })]);
    expect(h).not.toContain("Ventana");
    expect(h).not.toContain("Vence en");
  });
  it("WhatsApp: nada, aunque tenga la columna con valor", () => {
    const h = lista([conv({ platform: "whatsapp", window_expires_at: vence(-H) })]);
    expect(h).not.toContain("Ventana");
  });
});

describe("el encabezado del hilo: siempre el estado", () => {
  it("abierta: «Ventana abierta · quedan 10 h»", () => {
    expect(texto(hilo(conv({ window_expires_at: vence(10.5 * H) })))).toContain("|Ventana abierta · quedan 10 h|");
  });
  it("por vencer: «Vence en 45 min»", () => {
    expect(texto(hilo(conv({ window_expires_at: vence(45 * 60000) })))).toContain("|Vence en 45 min|");
  });
  it("cerrada: «Ventana cerrada»", () => {
    expect(texto(hilo(conv({ window_expires_at: vence(-H) })))).toContain("|Ventana cerrada|");
  });
  it("WhatsApp: sin ventana", () => {
    const h = hilo(conv({ platform: "whatsapp" }));
    expect(h).not.toContain("Ventana");
    expect(h).not.toContain("Vence en");
  });
});

describe("el campo de respuesta", () => {
  it("abierta: acepta texto libre", () => {
    expect(hilo(conv({ window_expires_at: vence(10 * H) }))).toMatch(/<textarea[^>]*placeholder="Escribí un mensaje… \(usá \/ para respuestas rápidas\)"/);
  });
  it("por vencer: el campo, con la línea de ayuda (D4)", () => {
    const h = hilo(conv({ window_expires_at: vence(80 * 60000) }));
    expect(h).toMatch(/<textarea/);
    expect(texto(h)).toContain("Vence en 1 h 20 min. Después, solo desde la app de Instagram.");
  });
  it("cerrada: sin campo, con el bloque de §11", () => {
    const h = hilo(conv({ window_expires_at: vence(-H) }));
    expect(h).not.toMatch(/<textarea/);
    const t = texto(h);
    expect(t).toContain("Pasaron 24 horas desde el último mensaje: escribile desde la app de Instagram.");
    expect(t).toContain("Instagram no deja que el sistema envíe después de 24 horas. Lo que escribas desde la app queda registrado igual en esta conversación.");
  });
  it("sin ningún mensaje del lead (ventana en null): cerrada", () => {
    expect(hilo(conv({ window_expires_at: null }))).not.toMatch(/<textarea/);
  });
  it("WhatsApp: el campo, sin ventana", () => {
    expect(hilo(conv({ platform: "whatsapp" }))).toMatch(/<textarea/);
  });
});

describe("el bloque de la ventana cerrada: los cuatro casos", () => {
  const vista = (p: Record<string, unknown>) =>
    limpio(renderToStaticMarkup(createElement(VistaVentanaCerrada, { volver: "/dashboard/inbox?estado=all", contactoId: "ct1", ...p } as never)));
  it("con conversación de WhatsApp: el botón «Escribir por WhatsApp», que la abre en la bandeja", () => {
    const h = vista({ conversacionWa: "11111111-2222-4333-8444-555555555555", telefono: "+50688887777", telefonoResuelto: true });
    expect(h).toMatch(/<a[^>]*href="\/dashboard\/inbox\?estado=all&amp;conversacion=11111111-2222-4333-8444-555555555555"[^>]*>(?:(?!<\/a>)[\s\S])*Escribir por WhatsApp<\/a>/);
    expect(h).not.toContain("Escribile primero");
  });
  it("control positivo: sin conversación de WhatsApp, el botón no aparece; con teléfono resuelto, el texto de F40", () => {
    const h = vista({ conversacionWa: null, telefono: "+50688887777", telefonoResuelto: true });
    expect(h).not.toContain("Escribir por WhatsApp");
    expect(texto(h)).toContain("Escribile primero desde WhatsApp Business en el teléfono. La conversación aparece acá en cuanto se guarde el mensaje.");
  });
  it("con teléfono sin resolver (D7): que lo cargue en la ficha, con el enlace", () => {
    const h = vista({ conversacionWa: null, telefono: "88887777", telefonoResuelto: false });
    expect(texto(h)).toContain("El teléfono está sin resolver: ");
    expect(h).toMatch(/<a[^>]*href="\/dashboard\/contacts\/ct1[^"]*"[^>]*>cargalo en la ficha<\/a>/);
    expect(h).not.toContain("Escribir por WhatsApp");
  });
  it("sin teléfono: el texto de §11", () => {
    const h = vista({ conversacionWa: null, telefono: null, telefonoResuelto: true });
    expect(texto(h)).toContain("No tiene teléfono cargado. Si te lo pasa, podés seguir por WhatsApp.");
    expect(h).not.toContain("Escribir por WhatsApp");
  });
  it("mientras se busca la conversación de WhatsApp, ninguno de los cuatro", () => {
    const h = vista({ conversacionWa: undefined, telefono: "+50688887777", telefonoResuelto: true });
    expect(h).not.toContain("Escribir por WhatsApp");
    expect(h).not.toContain("Escribile primero");
  });
});
