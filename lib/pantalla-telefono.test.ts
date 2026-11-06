import { describe, it, expect } from "vitest";
import { ajusteAlTeclado, estaAlFinal } from "./pantalla-telefono";

/**
 * Retrabajo del ítem 4 (06/11/2026), puntos b y c: el hilo abre en el último
 * mensaje y se queda ahí mientras cargan las fotos; el encabezado y la barra
 * del teléfono siguen a la vista con el teclado abierto y después de cerrarlo.
 */
describe("ajusteAlTeclado: el marco de la app sigue a la parte visible", () => {
  it("con el teclado abierto, el marco toma el alto visible y baja lo que el navegador corrió", () => {
    expect(ajusteAlTeclado({ height: 420.5, offsetTop: 260, scale: 1 })).toEqual({ alto: 420.5, arriba: 260 });
  });
  it("sin teclado, el alto entero y sin corrimiento", () => {
    expect(ajusteAlTeclado({ height: 760, offsetTop: 0, scale: 1 })).toEqual({ alto: 760, arriba: 0 });
  });
  it("con la página agrandada a mano (accesibilidad), no se toca nada: el agrandado es de la persona", () => {
    expect(ajusteAlTeclado({ height: 380, offsetTop: 120, scale: 2 })).toBeNull();
  });
  it("sin visualViewport (navegador viejo), no se toca nada", () => {
    expect(ajusteAlTeclado(null)).toBeNull();
    expect(ajusteAlTeclado(undefined)).toBeNull();
  });
  it("un alto inválido no se aplica", () => {
    expect(ajusteAlTeclado({ height: 0, offsetTop: 0, scale: 1 })).toBeNull();
  });
});

describe("estaAlFinal: si el hilo sigue pegado al último mensaje", () => {
  it("al final exacto, sí", () => {
    expect(estaAlFinal({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });
  it("a menos del margen del final, sí (una foto que termina de cargar no lo despega)", () => {
    expect(estaAlFinal({ scrollTop: 550, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });
  it("leyendo más arriba, no: no se lo baja de golpe", () => {
    expect(estaAlFinal({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });
  it("un hilo más corto que la pantalla está al final", () => {
    expect(estaAlFinal({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });
});
