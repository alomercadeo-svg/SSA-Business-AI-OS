import { describe, it, expect } from "vitest";
import { ultimaInteraccion } from "./fechas-contactos";

/**
 * La columna «Última interacción» de Contactos (F43, tramo B de S9): «Hoy»,
 * «Ayer», «Hace N días» y «Nunca», por día del calendario en la zona del
 * negocio, no en bloques de 24 horas ni en UTC. El reloj viene de afuera
 * (el del pedido), para que el servidor y el navegador dibujen lo mismo.
 */
const AHORA = new Date("2026-11-05T15:00:00Z"); // 09:00 del 05/11 en Costa Rica

describe("ultimaInteraccion", () => {
  it("sin fecha: «Nunca»", () => {
    expect(ultimaInteraccion(null, AHORA)).toBe("Nunca");
  });
  it("hoy, aunque en UTC ya sea mañana", () => {
    expect(ultimaInteraccion("2026-11-05T13:00:00Z", AHORA)).toBe("Hoy");
    expect(ultimaInteraccion("2026-11-06T05:30:00Z", new Date("2026-11-06T05:45:00Z"))).toBe("Hoy");
  });
  it("ayer a las 23:00 de Costa Rica, visto hoy a las 09:00: «Ayer»", () => {
    expect(ultimaInteraccion("2026-11-05T05:00:00Z", AHORA)).toBe("Ayer");
  });
  it("más atrás: «Hace N días»", () => {
    expect(ultimaInteraccion("2026-11-02T15:00:00Z", AHORA)).toBe("Hace 3 días");
    expect(ultimaInteraccion("2026-08-01T15:00:00Z", AHORA)).toBe("Hace 96 días");
  });
});
