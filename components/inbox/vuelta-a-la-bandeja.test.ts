import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Los cuatro enlaces de la bandeja a la ficha llevan la dirección de la
 * bandeja (`?volver=`), para que la flecha de la ficha vuelva a ella como
 * estaba (F35, tramo C de S8): el nombre y la foto del panel, «Ver ficha
 * completa», «Cargar teléfono en la ficha» y el nombre del encabezado del hilo.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/dashboard/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
const { VistaDelPanel, PieDelPanel } = await import("./contact-panel");
const { MessageThread } = await import("./message-thread");

const VOLVER = "/dashboard/inbox?q=ana&estado=all";
const CON_VUELTA = `href="/dashboard/contacts/ct-1?volver=${encodeURIComponent(VOLVER)}"`;
const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");

describe("los enlaces de la bandeja a la ficha llevan la vuelta", () => {
  const panel = sinSeparadores(
    renderToStaticMarkup(
      createElement(VistaDelPanel, {
        cargando: false,
        onClose: () => {},
        volver: VOLVER,
        details: {
          contact: { id: "ct-1", display_name: "Ana Pérez", email: null, avatar_url: null, is_subscribed: true, last_interaction_at: null, created_at: null, phone_resolved: false, next_followup_date: null },
          tags: [],
          customFields: [],
          channels: [],
        },
      } as never),
    ),
  );

  it("el nombre y la foto del panel", () => {
    expect(panel).toMatch(new RegExp(`<a[^>]*${CON_VUELTA.replace(/[?]/g, "\\?")}[^>]*>(?:(?!</a>)[\\s\\S])*Ana Pérez`));
  });

  it("«Ver ficha completa»", () => {
    expect(panel).toMatch(new RegExp(`<a[^>]*${CON_VUELTA.replace(/[?]/g, "\\?")}[^>]*>Ver ficha completa</a>`));
  });

  it("«Cargar teléfono en la ficha»", () => {
    const pie = renderToStaticMarkup(createElement(PieDelPanel, { contactoId: "ct-1", telefonoResuelto: false, volver: VOLVER } as never));
    expect(pie).toMatch(new RegExp(`<a[^>]*${CON_VUELTA.replace(/[?]/g, "\\?")}[^>]*>Cargar teléfono en la ficha</a>`));
  });

  it("el nombre del encabezado del hilo", () => {
    const conversacion = {
      id: "c1", workspace_id: "ws-1", contact_id: "ct-1", channel_id: "ch-1", platform: "whatsapp", status: "open",
      last_message_at: "2026-11-03T12:00:00Z", is_automation_paused: false, contacts: { id: "ct-1", display_name: "Ana Pérez", avatar_url: null },
    };
    const html = renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [], volverALaBandeja: VOLVER } as never));
    expect(html).toMatch(new RegExp(`<a[^>]*${CON_VUELTA.replace(/[?]/g, "\\?")}[^>]*>Ana Pérez</a>`));
  });

  it("sin vuelta, el enlace es el de siempre (control)", () => {
    const pie = renderToStaticMarkup(createElement(PieDelPanel, { contactoId: "ct-1", telefonoResuelto: false }));
    expect(pie).toContain('href="/dashboard/contacts/ct-1"');
  });
});
