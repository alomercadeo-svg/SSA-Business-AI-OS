import { describe, it, expect } from "vitest";
import { avisoDelHistorial } from "./historial-aviso";

describe("aviso del historial en el hilo (F27)", () => {
  it("completo: sin aviso (control positivo: no se avisa de más)", () => {
    expect(avisoDelHistorial({ estado: "completo", canalActivo: true })).toBeNull();
    expect(avisoDelHistorial(null)).toBeNull();
  });
  it("pendiente: dice que falta importar y cómo", () => {
    expect(avisoDelHistorial({ estado: "pendiente", canalActivo: true })).toContain("Sincronizar");
  });
  it("cuenta desconectada sin importar: lo dice, en vez del hilo vacío del 08/10", () => {
    expect(avisoDelHistorial({ estado: "pendiente", canalActivo: false })).toContain("desconectada");
  });
  it("incompleto y no disponible tienen su propio texto", () => {
    expect(avisoDelHistorial({ estado: "incompleto", canalActivo: true })).toContain("una parte");
    expect(avisoDelHistorial({ estado: "no_disponible", canalActivo: true })).toContain("ya no tiene");
  });
});
