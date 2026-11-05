import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FiltrosBandeja } from "./filtros-bandeja";
import { SIN_FILTROS, type FiltrosDeBandeja } from "@/lib/filtros-bandeja";

/**
 * El botón «Filtros» y su panel (F35, tramo B de S8), con las decisiones de
 * pantalla del 03/11/2026: los grupos en orden, sin el de la ventana de
 * Instagram hasta S9, sin los atajos del prototipo que el plano no pide.
 */

const OPCIONES = {
  etiquetas: [
    { id: "t1", name: "Caliente" },
    { id: "t2", name: "Frío" },
  ],
  miembros: [
    { id: "u1", etiqueta: "Ale Owner" },
    { id: "u2", etiqueta: "Laura Member" },
  ],
  plataformas: ["instagram", "whatsapp"] as const,
};

const dibujar = (filtros: Partial<FiltrosDeBandeja> = {}, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(FiltrosBandeja, {
      filtros: { ...SIN_FILTROS, ...filtros },
      opciones: OPCIONES,
      onCambiar: () => {},
      abiertoAlInicio: true,
      ...extra,
    } as never),
  ).replace(/<!-- -->/g, "");

const textoPlano = (html: string) => html.replace(/<[^>]+>/g, "|");

describe("el botón «Filtros»", () => {
  it("sin filtros dice «Filtros»", () => {
    const html = dibujar({}, { abiertoAlInicio: false });
    expect(html).toMatch(/<button[^>]*>Filtros<\/button>/);
    expect(html).not.toContain("Filtros ·");
  });

  it("con dos grupos elegidos dice «Filtros · 2»", () => {
    expect(dibujar({ canal: ["whatsapp"], ultimo: "hoy" }, { abiertoAlInicio: false })).toContain("Filtros · 2");
  });

  it("cerrado no muestra el panel", () => {
    expect(dibujar({}, { abiertoAlInicio: false })).not.toContain("Vence esta semana");
  });
});

describe("el panel", () => {
  it("los grupos, en el orden decidido, y «Limpiar filtros» al final", () => {
    const t = textoPlano(dibujar());
    const orden = ["Seguimiento", "Canal", "Asignación", "Etiquetas", "Ventana de Instagram", "Fecha del último mensaje", "Teléfono sin resolver", "Limpiar filtros"].map((g) => t.indexOf(`|${g}|`));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("F40: el grupo «Ventana de Instagram» con «Abierta», «Vence en menos de 2 h» y «Cerrada» (prototipo-fase1.html:591), sin los atajos del prototipo", () => {
    const html = dibujar();
    const t = textoPlano(html);
    for (const o of ["Ventana de Instagram", "Abierta", "Vence en menos de 2 h", "Cerrada"]) expect(t).toContain(`|${o}|`);
    expect(html).not.toContain("Seguimiento hoy");
    expect(html).not.toContain("Vencidos");
  });

  it("las opciones de seguimiento y de la fecha del último mensaje", () => {
    const t = textoPlano(dibujar());
    for (const o of ["Vence hoy", "Vence esta semana", "Vencido", "Hoy", "Últimos 7 días", "Últimos 30 días"]) expect(t).toContain(`|${o}|`);
    expect(t.split("|Rango de fechas|").length - 1).toBe(2);
  });

  it("«Asignación»: «Todas», «Sin asignar» y los miembros que vinieron", () => {
    const t = textoPlano(dibujar());
    for (const o of ["Todas", "Sin asignar", "Ale Owner", "Laura Member"]) expect(t).toContain(`|${o}|`);
  });

  it("«Canal»: solo las plataformas con algún canal activo", () => {
    const t = textoPlano(dibujar({}, { opciones: { ...OPCIONES, plataformas: ["whatsapp"] } }));
    expect(t).toContain("|WhatsApp|");
    expect(t).not.toContain("|Instagram|");
  });

  it("«Etiquetas»: las del espacio; sin etiquetas, lo dice", () => {
    expect(textoPlano(dibujar())).toContain("|Frío|");
    expect(dibujar({}, { opciones: { ...OPCIONES, etiquetas: [] } })).toContain("Todavía no hay etiquetas.");
  });

  it("lo elegido se marca", () => {
    const html = dibujar({ seguimiento: "vencido", canal: ["whatsapp"], etiquetas: ["t2"], telefonoSinResolver: true });
    for (const o of ["Vencido", "WhatsApp", "Frío", "Teléfono sin resolver"]) expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${o}<`));
    expect(html).toMatch(/aria-pressed="false"[^>]*>Vence hoy</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Todas</);
  });

  it("un rango elegido muestra sus dos fechas", () => {
    const html = dibujar({ seguimiento: { tipo: "rango", desde: "2026-11-04", hasta: "2026-11-06" } });
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-04"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-06"/);
  });
});

describe("F40: el grupo de la ventana", () => {
  it("la elegida queda marcada; se elige una por vez", () => {
    const html = dibujar({ ventana: "por_vencer" });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Vence en menos de 2 h<\/button>/);
    expect(html).not.toMatch(/<button[^>]*aria-pressed="true"[^>]*>Abierta<\/button>/);
  });
  it("sin Instagram entre los canales del espacio, el grupo no aparece", () => {
    const html = renderToStaticMarkup(
      createElement(FiltrosBandeja, { filtros: SIN_FILTROS, opciones: { ...OPCIONES, plataformas: ["whatsapp"] }, onCambiar: () => {}, abiertoAlInicio: true } as never),
    );
    expect(html).not.toContain("Ventana de Instagram");
  });
});
