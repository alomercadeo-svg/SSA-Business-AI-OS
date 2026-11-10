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
    // Cambiado el 10/11/2026 (retrabajo de Contactos, a): los encabezados que ordenan llevan ↕, o ↓ el activo.
    for (const t of [">Nombre ↕<", ">Correo ↕<", ">Última interacción ↓<", ">Etiquetas<", ">Suscripto<", ">Setter ↕<", "Sin correo", "Sin etiquetas", "Nunca", 'placeholder="Buscar por nombre, teléfono o correo…"']) expect(h).toContain(t);
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

/**
 * Ítem 5 del plan maestro (06/11/2026). El buscador, que Marcos vio angosto y
 * cortando el texto el 05/11: ocupa el ancho que sobra, y los filtros pasan
 * abajo cuando no entran. Y el filtro nuevo de F43, «Solo los que
 * escribieron», que arranca apagado. Las clases no prueban el dibujo: lo mira
 * Marcos, en la computadora y en el teléfono.
 */
const clasesDe = (html: string, patron: RegExp) => (html.match(patron)?.[1] ?? "").split(/\s+/);

describe("el buscador y el filtro de los que escribieron (ítem 5)", () => {
  it("el buscador ya no tiene tope de ancho y crece con el lugar que sobra", () => {
    const caja = clasesDe(vista(), /<div class="([^"]*)"><svg[^>]*lucide-search/);
    expect(caja).not.toContain("sm:max-w-sm");
    expect(caja.some((c) => /^sm:flex-\[/.test(c) || c === "sm:grow" || c === "sm:flex-1")).toBe(true);
    expect(caja.some((c) => /^sm:min-w-/.test(c))).toBe(true);
  });

  // Cambiado el 10/11/2026 (retrabajo de Contactos, b): antes, en el teléfono, los
  // filtros iban debajo en dos columnas; ahora van detrás de «Filtros», cerrados,
  // y en la computadora se ven como antes (md:flex).
  it("en el teléfono el buscador va a todo el ancho y los filtros, cerrados, detrás de «Filtros»", () => {
    const h = vista();
    expect(clasesDe(h, /<div class="([^"]*)"><svg[^>]*lucide-search/)).toContain("w-full");
    const filtros = clasesDe(h, /<div class="([^"]*)"><select[^>]*aria-label="Seguimiento"/);
    expect(filtros).toEqual(expect.arrayContaining(["hidden", "grid-cols-1", "md:flex", "md:flex-wrap"]));
    expect(h).toMatch(/<button type="button" aria-expanded="false"[^>]*>Filtros<\/button>/);
  });

  it("el filtro «Mostrar»: «Mostrar: todos» y «Solo los que escribieron», apagado de entrada", () => {
    const h = vista();
    expect(h).toMatch(/<select[^>]*aria-label="Mostrar"/);
    expect(h).toContain(">Mostrar: todos<");
    expect(h).toContain(">Solo los que escribieron<");
    expect(h).toMatch(/<option value="" selected="">Mostrar: todos<\/option>/);
  });

  it("con el filtro puesto, la opción elegida es «Solo los que escribieron»", () => {
    expect(vista({ filtros: { escribieron: true } })).toMatch(/<option value="si" selected="">Solo los que escribieron<\/option>/);
  });
});

describe("Contactos en el teléfono: tarjetas, sin tabla (retrabajo del ítem 4, punto g, 06/11/2026)", () => {
  const con = contacto("t1", { display_name: "Ana Tarjeta", next_followup_date: "2026-11-10", pipeline_stage: "3. Respondió" });
  const tarjetas = (h: string) => h.match(/<ul[^>]*aria-label="Contactos"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? "";

  it("cada contacto es una tarjeta que abre su ficha, con nombre, última interacción, próximo seguimiento y etapa", () => {
    const h = vista({ contactos: [con] });
    const t = tarjetas(h);
    expect(t, "falta la lista de tarjetas").not.toBe("");
    expect(t).toMatch(/href="\/dashboard\/contacts\/t1"/);
    expect(t).toContain("Ana Tarjeta");
    expect(t).toContain("Próximo seguimiento");
    expect(t).toContain("10 nov 2026");
    expect(t).toContain("3. Respondió");
    expect(t).toContain("Última interacción");
  });

  it("sin seguimiento ni etapa, lo dice", () => {
    const t = tarjetas(vista({ contactos: [contacto("t2", { next_followup_date: null, pipeline_stage: null })] }));
    expect(t).toContain("Sin fecha");
    expect(t).toContain("Sin etapa");
  });

  it("las tarjetas solo en el teléfono, y la tabla solo desde md", () => {
    const h = vista({ contactos: [con] });
    expect(h).toMatch(/<ul[^>]*class="[^"]*\bmd:hidden\b[^"]*"[^>]*aria-label="Contactos"|<ul[^>]*aria-label="Contactos"[^>]*class="[^"]*\bmd:hidden\b/);
    expect(h).toMatch(/<div class="hidden overflow-x-auto md:block"><table/);
  });
});
