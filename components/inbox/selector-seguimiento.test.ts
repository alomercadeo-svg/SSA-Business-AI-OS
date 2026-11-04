import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * El selector de próximo seguimiento del panel del contacto de la bandeja
 * (F35, tramo C de S8): «En 3 días», «En 7 días», «En 14 días», «Otra fecha»
 * y «Quitar», sin abrir la ficha ni ninguna ventana. Los textos son los del
 * prototipo aprobado (contactPanel y los avisos de seguimiento).
 *
 * El reloj queda fijo a las 18:30 del miércoles 04/11/2026 de Costa Rica (00:30
 * del 05 en UTC), con el proceso en UTC: «Otra fecha» no ofrece fechas
 * anteriores a hoy en la zona del negocio (cambio 5 de Marcos al plan).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/dashboard/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
const { VistaDelPanel } = await import("./contact-panel");
const { VistaDelSelector } = await import("./selector-seguimiento");
const { guardarSeguimiento, avisoDeSeguimiento, AVISO_DE_FALLA, hoyEnZona } = await import("@/lib/seguimiento");

const zonaOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T00:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  process.env.TZ = zonaOriginal;
});

const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");
const detalles = (campos: Record<string, unknown> = {}) => ({
  contact: {
    id: "ct-1", display_name: "Ana Pérez", email: null, avatar_url: null, is_subscribed: true,
    last_interaction_at: null, created_at: "2026-10-01T15:00:00Z", phone_resolved: true, next_followup_date: null, ...campos,
  },
  tags: [],
  customFields: [],
  channels: [],
});
const panel = (campos?: Record<string, unknown>) =>
  sinSeparadores(renderToStaticMarkup(createElement(VistaDelPanel, { cargando: false, details: detalles(campos) as never, onClose: () => {}, zona: "America/Costa_Rica" } as never)));
const boton = (texto: string) => new RegExp(`<button[^>]*>${texto}</button>`);

describe("la sección «Próximo seguimiento» del panel", () => {
  it("sin fecha: «Sin fecha», los tres plazos y «Otra fecha», sin «Quitar»", () => {
    const html = panel();
    expect(html).toContain("Próximo seguimiento");
    expect(html).toContain("Sin fecha");
    for (const t of ["En 3 días", "En 7 días", "En 14 días", "Otra fecha"]) expect(html).toMatch(boton(t));
    expect(html).not.toMatch(boton("Quitar"));
  });

  it("con fecha: la fecha, sin correrla de día, y «Quitar»", () => {
    const html = panel({ next_followup_date: "2026-11-07" });
    expect(html).toMatch(/7 nov(\.)? 2026/);
    expect(html).toMatch(boton("Quitar"));
  });

  it("no abre ninguna ventana: ni diálogo ni enlace a la ficha en el selector", () => {
    const html = sinSeparadores(renderToStaticMarkup(createElement(VistaDelSelector, { fecha: null, otraAbierta: true, minimo: "2026-11-04" } as never)));
    expect(html).not.toMatch(/role="dialog"|<dialog/);
    expect(html).not.toContain("/dashboard/contacts");
  });
});

describe("«Otra fecha»", () => {
  it("muestra en el mismo panel un campo de fecha que empieza hoy en la zona del negocio, y «Guardar»", () => {
    const minimo = hoyEnZona(new Date(), "America/Costa_Rica");
    expect(minimo).toBe("2026-11-04");
    const html = sinSeparadores(renderToStaticMarkup(createElement(VistaDelSelector, { fecha: null, otraAbierta: true, minimo } as never)));
    expect(html).toMatch(/<input[^>]*type="date"[^>]*min="2026-11-04"/);
    expect(html).toMatch(boton("Guardar"));
  });
});

describe("guardar", () => {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  let respuesta: { status: number; cuerpo: unknown } = { status: 200, cuerpo: {} };
  beforeEach(() => {
    llamadas.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify(respuesta.cuerpo), { status: respuesta.status });
    });
  });

  it("«En 3 días» manda el número, no una fecha, y devuelve la que eligió el servidor", async () => {
    respuesta = { status: 200, cuerpo: { guardado: ["next_followup_date"], next_followup_date: "2026-11-07" } };
    expect(await guardarSeguimiento("ct-1", { dias: 3 })).toEqual({ ok: true, fecha: "2026-11-07" });
    expect(llamadas[0].url).toBe("/api/v1/contacts/ct-1");
    expect(llamadas[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ seguimiento_en_dias: 3 });
  });

  it("«Otra fecha» y «Quitar» mandan la fecha, o vacío", async () => {
    respuesta = { status: 200, cuerpo: { next_followup_date: "2026-11-20" } };
    expect(await guardarSeguimiento("ct-1", { fecha: "2026-11-20" })).toEqual({ ok: true, fecha: "2026-11-20" });
    respuesta = { status: 200, cuerpo: { next_followup_date: null } };
    expect(await guardarSeguimiento("ct-1", { fecha: null })).toEqual({ ok: true, fecha: null });
    expect(llamadas.map((l) => JSON.parse(String(l.init.body)))).toEqual([{ next_followup_date: "2026-11-20" }, { next_followup_date: null }]);
  });

  it("si la ruta falla o no trae la fecha, no es un guardado", async () => {
    respuesta = { status: 404, cuerpo: { error: "No encontramos ese contacto" } };
    expect(await guardarSeguimiento("ct-1", { dias: 7 })).toEqual({ ok: false });
    respuesta = { status: 200, cuerpo: { guardado: [] } };
    expect(await guardarSeguimiento("ct-1", { dias: 7 })).toEqual({ ok: false });
  });

  it("los avisos, del prototipo", () => {
    expect(avisoDeSeguimiento("2026-11-07")).toMatch(/^Próximo seguimiento: 7 nov(\.)? 2026$/);
    expect(avisoDeSeguimiento(null)).toBe("Seguimiento quitado");
    expect(AVISO_DE_FALLA).toBe("No se pudo guardar el próximo seguimiento.");
  });
});
