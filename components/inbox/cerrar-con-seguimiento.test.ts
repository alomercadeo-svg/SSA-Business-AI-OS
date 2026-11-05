import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Al cerrar con el seguimiento de hoy o vencido, se pide el próximo (F35,
 * tramo D de S8): debajo del encabezado, sin abrir ninguna ventana, el mismo
 * selector del tramo C con «Cancelar». En este bloque «Otra fecha» empieza
 * mañana (aprobado por Marcos el 04/11/2026): con hoy, la ruta volvería a pedir.
 * Y el ícono del calendario de «Otra fecha», visible en los dos temas.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/dashboard/inbox", useSearchParams: () => new URLSearchParams() }));
const { BloqueDePedido, minimoDelSelector, VistaDelSelector } = await import("./selector-seguimiento");

const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");

describe("el pedido del próximo seguimiento al cerrar", () => {
  it("dice qué hacer, trae el selector y «Cancelar», sin ventana", () => {
    const h = sinSeparadores(
      renderToStaticMarkup(createElement(BloqueDePedido, { contactoId: "ct1", fecha: "2026-11-04", zona: "America/Costa_Rica", onElegido: () => {}, onCancelar: () => {} })),
    );
    expect(h).toContain("Antes de cerrar, elegí el próximo seguimiento.");
    for (const t of ["En 3 días", "En 7 días", "En 14 días", "Otra fecha", "Quitar"]) expect(h).toContain(`>${t}<`);
    expect(h).toMatch(/<button[^>]*>Cancelar<\/button>/);
    expect(h).not.toMatch(/role="dialog"|<dialog/);
  });

  it("en el bloque de cerrar, «Otra fecha» empieza mañana en la zona del negocio; en el panel, hoy", () => {
    // 18:30 de Costa Rica del 04/11/2026: en UTC ya es el 05.
    const ahora = new Date("2026-11-05T00:30:00Z");
    expect(minimoDelSelector(ahora, "America/Costa_Rica", true)).toBe("2026-11-05");
    expect(minimoDelSelector(ahora, "America/Costa_Rica", false)).toBe("2026-11-04");
  });

  it("el hilo muestra el bloque cuando la ruta pide el seguimiento", () => {
    const fuente = readFileSync(join(process.cwd(), "components/inbox/message-thread.tsx"), "utf8");
    expect(fuente).toContain("<BloqueDePedido");
    const selector = readFileSync(join(process.cwd(), "components/inbox/selector-seguimiento.tsx"), "utf8");
    expect(selector).toMatch(/<SelectorDeSeguimiento[^>]*\bdesdeManana\b[^>]*\/>/);
  });
});

describe("el ícono del calendario de «Otra fecha»", () => {
  it("el campo declara su esquema de color: claro por defecto y oscuro con la clase dark", () => {
    const h = renderToStaticMarkup(createElement(VistaDelSelector, { fecha: null, otraAbierta: true, minimo: "2026-11-04" }));
    const input = h.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? "";
    expect(input).toContain("[color-scheme:light]");
    expect(input).toContain("[.dark_&amp;]:[color-scheme:dark]");
  });
});
