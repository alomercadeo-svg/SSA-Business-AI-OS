import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F35, criterio 31 (agregado el 03/11/2026): desde la bandeja se abre la ficha
 * del contacto. Con el número real vinculado no había forma de hacerlo.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/dashboard/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
const { PieDelPanel, VistaDelPanel } = await import("./contact-panel");
const { MessageThread } = await import("./message-thread");

const FICHA = 'href="/dashboard/contacts/ct-1"';

describe("abrir la ficha desde la bandeja", () => {
  // Cambiado en el tramo C de S8: «Ver ficha completa» subió del pie a quedar
  // debajo del nombre (decidido por Marcos el 03/11/2026). Lo que se comprueba
  // es lo mismo: el panel lo tiene y abre la ficha de ese contacto.
  const panel = (telefonoResuelto: boolean) =>
    renderToStaticMarkup(
      createElement(VistaDelPanel, {
        cargando: false,
        onClose: () => {},
        details: {
          contact: { id: "ct-1", display_name: "Ana Pérez", email: null, avatar_url: null, is_subscribed: true, last_interaction_at: null, created_at: null, phone_resolved: telefonoResuelto, next_followup_date: null },
          tags: [],
          customFields: [],
          channels: [],
        } as never,
      }),
    );

  it("el panel tiene «Ver ficha completa», que abre la ficha de ese contacto", () => {
    const html = panel(true);
    expect(html).toMatch(new RegExp(`<a[^>]*${FICHA}[^>]*>Ver ficha completa</a>`));
    expect(html).not.toContain("Cargar teléfono en la ficha");
  });

  it("con el teléfono sin resolver, también «Cargar teléfono en la ficha», que abre la ficha", () => {
    const pie = renderToStaticMarkup(createElement(PieDelPanel, { contactoId: "ct-1", telefonoResuelto: false }));
    expect(pie).toMatch(new RegExp(`<a[^>]*${FICHA}[^>]*>Cargar teléfono en la ficha</a>`));
    expect(panel(false)).toContain("Ver ficha completa");
  });

  it("el nombre del contacto en el encabezado del hilo abre la ficha", () => {
    const conversacion = {
      id: "c1", workspace_id: "ws-1", contact_id: "ct-1", channel_id: "ch-1", platform: "whatsapp", status: "open",
      last_message_at: "2026-11-03T12:00:00Z", is_automation_paused: false, contacts: { id: "ct-1", display_name: "Ana Pérez", avatar_url: null },
    };
    const html = renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [] }));
    expect(html).toMatch(new RegExp(`<a[^>]*${FICHA}[^>]*>Ana Pérez</a>`));
  });
});
