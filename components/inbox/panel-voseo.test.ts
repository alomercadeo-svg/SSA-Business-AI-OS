import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { horaDelNegocio } from "@/lib/ficha";

/**
 * El panel del contacto de la bandeja en voseo (F35, tramo C de S8, decidido
 * por Marcos el 03/11/2026), con los mismos rótulos que la ficha cuando el dato
 * es el mismo. Y el nombre y la foto abren la ficha, con «Ver ficha completa»
 * debajo del nombre: al pie del panel, Marcos no lo había visto.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/dashboard/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
const { VistaDelPanel, PieDelPanel } = await import("./contact-panel");

const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");
const detalles = (campos: Record<string, unknown> = {}) => ({
  contact: {
    id: "ct-1", display_name: "Ana Pérez", email: "ana@example.com", avatar_url: null, is_subscribed: true,
    last_interaction_at: null, created_at: "2026-10-01T15:00:00Z", phone_resolved: true, next_followup_date: null, ...campos,
  },
  tags: [],
  customFields: [{ definition: { id: "d1", name: "Rubro" }, value: "Estética" }],
  channels: [
    { platform: "whatsapp", platform_username: null },
    { platform: "instagram", platform_username: "ana.perez" },
  ],
});
const panel = (campos?: Record<string, unknown>, cargado = true) =>
  sinSeparadores(
    renderToStaticMarkup(
      createElement(VistaDelPanel, { cargando: false, details: cargado ? (detalles(campos) as never) : null, onClose: () => {}, zona: "America/Costa_Rica" } as never),
    ),
  );

describe("el panel en voseo", () => {
  it("ningún texto del fork en inglés", () => {
    const html = panel() + panel({ is_subscribed: false, display_name: null }) + panel(undefined, false);
    for (const ingles of ["Contact Info", ">Platforms<", "Last Interaction", ">Created<", ">Tags<", "No tags", "Custom Fields", ">Subscribed<", ">Unsubscribed<", ">Never<", ">Unknown<", "Contact not found", ">Email<", "Whatsapp"]) {
      expect(html).not.toContain(ingles);
    }
  });

  it("los rótulos, como la ficha", () => {
    const html = panel();
    for (const rotulo of ["Datos del contacto", "Canales", "Correo", "Última interacción", "Creado", "Etiquetas", "Campos propios"]) expect(html).toContain(rotulo);
  });

  it("los valores: «WhatsApp», «Instagram», «Nunca», «Sin etiquetas», «Suscripto», y la fecha en hora de Costa Rica", () => {
    const html = panel();
    expect(html).toMatch(/>WhatsApp</);
    expect(html).toMatch(/>Instagram</);
    expect(html).toContain("Nunca");
    expect(html).toContain("Sin etiquetas");
    expect(html).toContain("Suscripto");
    expect(html).toContain(horaDelNegocio("2026-10-01T15:00:00Z"));
  });

  // Cambiado el 05/11/2026 (F43, D6 del chat de Marcos): sin nombre pero con
  // usuario (el canal de Instagram de este panel tiene «ana.perez») se ve
  // «@usuario»; «Sin nombre» queda para el que no tiene ni nombre ni usuario
  // (components/inbox/nombre-visible-bandeja.test.ts y lib/nombre-visible.test.ts).
  it("sin nombre, con usuario, y dado de baja", () => {
    const html = panel({ display_name: null, is_subscribed: false });
    expect(html).toContain(">@ana.perez<");
    expect(html).toContain("Dado de baja");
  });

  it("sin contacto: lo dice como la ficha", () => {
    expect(panel(undefined, false)).toContain("No podés ver este contacto");
  });
});

describe("el nombre y la foto abren la ficha", () => {
  const FICHA = 'href="/dashboard/contacts/ct-1"';

  it("el nombre y la foto son un enlace a la ficha", () => {
    const html = panel({ avatar_url: "https://ejemplo.test/a.jpg" });
    expect(html).toMatch(new RegExp(`<a[^>]*${FICHA}[^>]*>(?:(?!</a>)[\\s\\S])*<img[^>]*src="https://ejemplo.test/a.jpg"(?:(?!</a>)[\\s\\S])*Ana Pérez(?:(?!</a>)[\\s\\S])*</a>`));
  });

  it("«Ver ficha completa» va debajo del nombre, antes del próximo seguimiento", () => {
    const html = panel();
    const nombre = html.indexOf("Ana Pérez");
    const ver = html.search(new RegExp(`<a[^>]*${FICHA}[^>]*>Ver ficha completa</a>`));
    expect(ver).toBeGreaterThan(nombre);
    expect(ver).toBeLessThan(html.indexOf("Próximo seguimiento"));
  });

  it("al pie queda solo «Cargar teléfono en la ficha», con el teléfono sin resolver", () => {
    const pie = renderToStaticMarkup(createElement(PieDelPanel, { contactoId: "ct-1", telefonoResuelto: false }));
    expect(pie).toContain("Cargar teléfono en la ficha");
    expect(pie).not.toContain("Ver ficha completa");
  });
});
