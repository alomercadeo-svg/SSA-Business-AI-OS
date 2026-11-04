import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * La vista de la bandeja con filtros (F35, tramo B). «Todavía no hay
 * conversaciones» es para un espacio sin ninguna: con filtros que no
 * coinciden, «Todas» da 0 y ese texto mentiría.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/dashboard/inbox", useSearchParams: () => new URLSearchParams() }));
const { InboxView } = await import("@/app/(dashboard)/dashboard/inbox/inbox-view");

const OPCIONES = { etiquetas: [], miembros: [], plataformas: ["instagram"] };
const vacia = { conversaciones: [], hayMas: false, cantidades: { abiertas: 0, cerradas: 0, todas: 0 } };
const dibujar = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(InboxView, { inicial: vacia, workspaceId: "ws-1", opcionesDeFiltros: OPCIONES, ...props } as never)).replace(/<!-- -->/g, "");

describe("la vista de la bandeja con filtros", () => {
  it("sin conversaciones y sin filtros: «Todavía no hay conversaciones» (control)", () => {
    expect(dibujar({})).toContain("Todavía no hay conversaciones");
  });

  it("con filtros que no coinciden: no dice «Todavía no hay conversaciones»", () => {
    const html = dibujar({ filtros: { etiquetas: [], asignacion: null, canal: ["instagram"], ultimo: null, telefonoSinResolver: false, seguimiento: "vencido" } });
    expect(html).not.toContain("Todavía no hay conversaciones");
    expect(html).toContain("Ninguna conversación con estos filtros");
  });
});
