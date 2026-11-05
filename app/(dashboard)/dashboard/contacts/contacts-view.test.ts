import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * La lista de Contactos (F43, tramo B de S9): los textos en voseo, el total
 * del alcance, «Página N de M», «Sin nombre», la lista del equipo según el
 * rol y los estados vacíos. Lo que trae el servidor lo prueba
 * scripts/verify-contactos.mjs contra la base real.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/dashboard/contacts", useSearchParams: () => new URLSearchParams() }));
const { ContactsView } = await import("./contacts-view");
const { SIN_FILTROS_DE_CONTACTOS } = await import("@/lib/contactos");

const limpio = (html: string) => html.replace(/<!-- -->/g, "");
const contacto = (id: string, extra: Record<string, unknown> = {}) => ({
  id, workspace_id: "ws-1", display_name: `Contacto ${id}`, email: null, avatar_url: null, is_subscribed: true,
  last_interaction_at: "2026-11-05T13:00:00Z", setter_id: null, vendedor_id: null, phone_resolved: true,
  contact_tags: [], contact_channels: [], ...extra,
});
const MIEMBROS = [{ id: "yo", etiqueta: "Laura Mora" }];

function vista(o: { contactos?: unknown[]; cantidad?: number; total?: number; pagina?: number; paginas?: number; filtros?: object; equipoCompleto?: boolean } = {}) {
  const contactos = o.contactos ?? [contacto("a")];
  const props = {
    inicial: { contactos, cantidad: o.cantidad ?? 130, total: o.total ?? 130, pagina: o.pagina ?? 1, paginas: o.paginas ?? 3 },
    filtros: { ...SIN_FILTROS_DE_CONTACTOS, ...(o.filtros ?? {}) },
    tags: [],
    miembros: MIEMBROS,
    equipoCompleto: o.equipoCompleto ?? true,
    ahora: "2026-11-05T15:00:00Z",
    // Las props de la vista de antes, para poder verla en rojo por los textos.
    contacts: contactos, total: o.total ?? 130, workspaceId: "ws-1", filtroSetter: "todos", filtroVendedor: "todos",
  };
  return limpio(renderToStaticMarkup(createElement(ContactsView, props as never)));
}

describe("la lista de Contactos", () => {
  it("el título y el total del alcance", () => {
    const h = vista();
    expect(h).toContain(">Contactos</h1>");
    expect(h).toContain(">130 contactos<");
  });

  it("con búsqueda o filtros: «N de M contactos»", () => {
    expect(vista({ cantidad: 12, total: 743, filtros: { q: "ana" } })).toContain(">12 de 743 contactos<");
  });

  it("«Página N de M» y los números", () => {
    const h = vista({ pagina: 2, paginas: 3 });
    expect(h).toContain(">Página 2 de 3<");
    expect(h).toMatch(/href="\/dashboard\/contacts\?pagina=3"/);
    expect(h).toContain("Anterior");
    expect(h).toContain("Siguiente");
  });

  it("las columnas y los textos, en voseo", () => {
    const h = vista({ contactos: [contacto("a", { email: null, is_subscribed: false, last_interaction_at: null })] });
    for (const t of [">Nombre<", ">Correo<", ">Última interacción<", ">Etiquetas<", ">Suscripto<", ">Setter<", "Sin correo", "Sin etiquetas", "Nunca", 'placeholder="Buscar por nombre, teléfono o correo…"']) expect(h).toContain(t);
    for (const viejo of [">Name<", ">Email<", "Last Interaction", "Subscribed", "No email", "No tags", "Never", "Unknown", "Search by name", ">Segment<", ">Contacts<", "No contacts found"]) expect(h).not.toContain(viejo);
  });

  it("los cinco filtros de la fila", () => {
    const h = vista();
    for (const t of ["Seguimiento: todos", "Vence hoy", "Vence esta semana", "Vencido", "Etapa: todas", "3. Respondió", "Setter: todos", "Vendedor: todos", "Etiqueta: todas"]) expect(h).toContain(t);
  });

  it("el identificador como nombre: «Sin nombre»", () => {
    const h = vista({ contactos: [contacto("a", { display_name: "1784", contact_channels: [{ platform_sender_id: "1784", platform_username: null }] })] });
    expect(h).toContain(">Sin nombre<");
    expect(h).not.toContain(">1784<");
  });

  it("para un Member, el setter que no está en su lista es «Otra persona del equipo»", () => {
    const h = vista({ equipoCompleto: false, contactos: [contacto("a", { setter_id: "otro" })] });
    expect(h).toContain("Otra persona del equipo");
    expect(h).not.toContain("Ya no está en el equipo");
  });

  it("sin contactos: «Todavía no hay contactos» y el botón a la bandeja", () => {
    const h = vista({ contactos: [], cantidad: 0, total: 0, paginas: 1 });
    expect(h).toContain("Todavía no hay contactos");
    expect(h).toContain("Los contactos se crean solos cuando alguien escribe por Instagram o WhatsApp.");
    expect(h).toMatch(/href="\/dashboard\/inbox"[^>]*>Ir a la bandeja</);
  });

  it("sin coincidencias: lo dice, con «Limpiar filtros»", () => {
    expect(vista({ contactos: [], cantidad: 0, total: 130, paginas: 1, filtros: { q: "zqxw" } })).toContain("Ningún contacto coincide con «zqxw»");
    const f = vista({ contactos: [], cantidad: 0, total: 130, paginas: 1, filtros: { etapa: "3. Respondió" } });
    expect(f).toContain("Ningún contacto con estos filtros");
    expect(f).toContain("Limpiar filtros");
  });
});
