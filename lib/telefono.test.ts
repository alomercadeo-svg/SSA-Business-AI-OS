import { describe, it, expect } from "vitest";
import { motivoTelefonoInvalido, normalizarTelefono } from "./telefono";

/**
 * E.164 según §14, la única definición del plano: +, código de país y número,
 * solo dígitos, hasta 15 en total. Sin mínimo. La base exige lo mismo (00029):
 * `scripts/verify-contacto-extendido.mjs` lo prueba contra la base real.
 */
describe("normalizarTelefono", () => {
  it("saca los separadores y deja el E.164", () => {
    expect(normalizarTelefono("+506 7034-9182")).toBe("+50670349182");
    expect(normalizarTelefono(" +1 (415) 555.0100 ")).toBe("+14155550100");
  });

  it("no adivina el código de país: sin + no se normaliza", () => {
    expect(normalizarTelefono("70349182")).toBeNull();
    expect(normalizarTelefono("50670349182")).toBeNull();
    expect(normalizarTelefono("8856-12")).toBeNull();
  });

  it("hasta 15 dígitos, y el 16 se rechaza", () => {
    expect(normalizarTelefono("+123456789012345")).toBe("+123456789012345");
    expect(normalizarTelefono("+1234567890123456")).toBeNull();
  });

  it("sin mínimo, porque §14 no lo fija", () => {
    expect(normalizarTelefono("+1")).toBe("+1");
  });

  it("rechaza un código de país que empieza con 0, letras y vacíos", () => {
    expect(normalizarTelefono("+0506")).toBeNull();
    expect(normalizarTelefono("+506 ABC")).toBeNull();
    expect(normalizarTelefono("")).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
  });

  it("explica el motivo en lenguaje claro", () => {
    expect(motivoTelefonoInvalido("70349182")).toMatch(/código de país/);
    expect(motivoTelefonoInvalido("+1234567890123456")).toMatch(/15 dígitos/);
  });
});
