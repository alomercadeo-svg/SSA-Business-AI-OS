import { describe, it, expect } from "vitest";
import { etiquetaDeMiembro } from "./etiqueta-miembro";

/**
 * El nombre de un setter o vendedor (F41), según la lista que tiene quien mira
 * (F43, pendiente de S8, D9 del chat de Marcos). A un Member le llega solo él
 * mismo (lib/miembros-bandeja.ts): otra persona no está en su lista, y decir
 * «Ya no está en el equipo» sería falso.
 */
const EQUIPO = [{ id: "yo", etiqueta: "Laura" }];

describe("etiquetaDeMiembro", () => {
  it("sin asignar", () => {
    expect(etiquetaDeMiembro(null, EQUIPO, true)).toBe("Sin asignar");
  });
  it("uno de la lista, con su nombre", () => {
    expect(etiquetaDeMiembro("yo", EQUIPO, false)).toBe("Laura");
  });
  it("con el equipo entero (Owner y Admin), uno que no está: «Ya no está en el equipo»", () => {
    expect(etiquetaDeMiembro("otro", EQUIPO, true)).toBe("Ya no está en el equipo");
  });
  it("con la lista del Member, uno que no está: «Otra persona del equipo»", () => {
    expect(etiquetaDeMiembro("otro", EQUIPO, false)).toBe("Otra persona del equipo");
  });
});
