import { describe, it, expect } from "vitest";
import { clasesDeLaLista, clasesDelHilo, clasesDelPanel } from "./columnas-bandeja";

/**
 * F35, criterio del teléfono (agregado el 05/11/2026): en el ancho de un
 * teléfono se ve una sola columna por vez; en la computadora, las tres.
 * `md` es 768 px en Tailwind 4. Estos tests miran las clases que reciben las
 * columnas, **no el dibujo**: en S8, tramo 8, tests así dieron verde con el
 * problema adentro. La prueba del diseño es la de Marcos en el celular.
 */
const c = (s: string) => s.split(/\s+/).filter(Boolean);

describe("las columnas de la bandeja en el teléfono (F35)", () => {
  it("sin conversación abierta, en el teléfono se ve la lista a todo el ancho y no el hilo", () => {
    expect(c(clasesDeLaLista(false))).toContain("w-full");
    expect(c(clasesDeLaLista(false))).not.toContain("hidden");
    expect(c(clasesDelHilo(false))).toContain("hidden");
  });

  it("con una conversación abierta, en el teléfono se ve el hilo y no la lista", () => {
    expect(c(clasesDeLaLista(true))).toContain("hidden");
    expect(c(clasesDelHilo(true))).not.toContain("hidden");
    expect(c(clasesDelHilo(true))).toContain("flex");
  });

  it("control: en la computadora siempre se ven la lista (80) y el hilo, abierto o no", () => {
    for (const hay of [true, false]) {
      expect(c(clasesDeLaLista(hay))).toEqual(expect.arrayContaining(["md:block", "md:w-80", "md:flex-shrink-0"]));
      expect(c(clasesDelHilo(hay))).toEqual(expect.arrayContaining(["md:flex", "min-w-0", "flex-1"]));
    }
  });

  it("el panel en el teléfono ocupa la pantalla entera, encima del hilo", () => {
    expect(c(clasesDelPanel({ enCompu: false, enTelefono: true }))).toEqual(expect.arrayContaining(["fixed", "inset-0", "z-40", "flex"]));
  });

  it("el panel cerrado en el teléfono no se ve; en la computadora, según su botón", () => {
    expect(c(clasesDelPanel({ enCompu: true, enTelefono: false }))).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
    expect(c(clasesDelPanel({ enCompu: false, enTelefono: false }))).toEqual(expect.arrayContaining(["hidden", "md:hidden"]));
  });
});
