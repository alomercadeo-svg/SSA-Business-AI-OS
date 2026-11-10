import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pegadoTrasDesplazar, VENTANA_DEL_GESTO_MS } from "@/lib/pantalla-telefono";
import { FotoDelHilo } from "./visor-foto";

/**
 * A y B del 09/11/2026 (`scripts/verify-hilo-telefono.mjs`, en rojo antes del
 * arreglo). Estos tests miran la lógica y la fuente; **no prueban el diseño en
 * el teléfono** (en S8, tramo 8, dieron verde con el problema adentro): eso lo
 * prueban la prueba del iPhone emulado y Marcos en el iPhone.
 */
const fuente = (ruta: string) => readFileSync(resolve(__dirname, "../..", ruta), "utf8");

describe("A: «pegado al final» cambia solo por un desplazamiento de la persona", () => {
  it("sin gesto reciente, un desplazamiento lejos del final no despega el hilo", () => {
    const r = pegadoTrasDesplazar({ pegado: true, alFinal: false, msDesdeElGesto: Infinity });
    expect(r).toEqual({ pegado: true, deLaPersona: false });
  });

  it("sin gesto reciente, tampoco lo pega", () => {
    expect(pegadoTrasDesplazar({ pegado: false, alFinal: true, msDesdeElGesto: Infinity }).pegado).toBe(false);
  });

  it("con un gesto reciente, la persona lo despega y lo vuelve a pegar (control)", () => {
    expect(pegadoTrasDesplazar({ pegado: true, alFinal: false, msDesdeElGesto: 10 })).toEqual({ pegado: false, deLaPersona: true });
    expect(pegadoTrasDesplazar({ pegado: false, alFinal: true, msDesdeElGesto: VENTANA_DEL_GESTO_MS })).toEqual({ pegado: true, deLaPersona: true });
  });

  it("el hilo usa esa regla y registra los gestos de la persona", () => {
    const hilo = fuente("components/inbox/message-thread.tsx");
    expect(hilo).not.toContain("pegadoAlFinal.current = estaAlFinal(e.currentTarget)");
    expect(hilo).toContain("pegadoTrasDesplazar(");
    for (const gesto of ["onTouchStart", "onTouchMove", "onWheel", "onPointerDown", "onKeyDown"]) expect(hilo, gesto).toContain(`${gesto}={marcarGesto}`);
  });

  it("la foto del hilo reserva su alto antes de cargar", () => {
    const html = renderToStaticMarkup(createElement(FotoDelHilo, { url: "https://x.test/a.png" }));
    const clases = html.match(/<img[^>]*class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    expect(clases).toContain("h-80");
    expect(clases).toContain("object-contain");
    expect(clases).not.toContain("max-h-80");
  });
});

describe("B: la lista vuelve a pedir sus datos sin depender solo de Realtime", () => {
  const bandeja = fuente("app/(dashboard)/dashboard/inbox/inbox-view.tsx");

  it("al volver del chat en el teléfono", () => {
    const volver = bandeja.slice(bandeja.indexOf("conectarHiloEnTelefono(window, () => {"), bandeja.indexOf("hiloEnTelefono.current = h;"));
    expect(volver).toContain("setListaDesactualizada((n) => n + 1)");
  });

  it("cuando la página vuelve al frente", () => {
    // El manejador va antes de `addEventListener` (el orden de la primera
    // versión del test era al revés y no coincidía con un código válido).
    expect(bandeja).toMatch(/visibilityState === "visible"\) setListaDesactualizada\(\(n\) => n \+ 1\)[\s\S]{0,120}addEventListener\("visibilitychange", alVolver\)/);
  });

  it("cuando Realtime se reconecta, por el mismo «un pedido a la vez»", () => {
    const lista = fuente("components/inbox/conversation-list.tsx");
    expect(lista).toMatch(/\.subscribe\(\s*crearAvisoDeReconexion\(\(\) =>[\s\S]{0,200}pedidos\.volverAPedir\(/);
  });
});
