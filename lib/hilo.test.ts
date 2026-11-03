import { describe, it, expect } from "vitest";
import { refrescarHilo, sumarAnteriores } from "./hilo";

/**
 * El hilo con los mensajes anteriores a los últimos 200 (F35, tramo A de S8).
 * Hasta el 03/11/2026, el refresco de Realtime reemplazaba el hilo por los
 * últimos 200: con los anteriores ya cargados, los habría borrado de la
 * pantalla con cada mensaje nuevo.
 */

const m = (id: string, hora: string) => ({ id, created_at: hora });

describe("sumarAnteriores", () => {
  it("pone los anteriores arriba, sin repetir los que ya estaban", () => {
    const actuales = [m("c", "2026-10-03T10:00:00Z"), m("d", "2026-10-04T10:00:00Z")];
    const anteriores = [m("a", "2026-10-01T10:00:00Z"), m("b", "2026-10-02T10:00:00Z"), m("c", "2026-10-03T10:00:00Z")];
    expect(sumarAnteriores(actuales, anteriores).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("refrescarHilo", () => {
  it("conserva los anteriores ya cargados y los optimistas, y toma los frescos", () => {
    const actuales = [
      m("a", "2026-10-01T10:00:00Z"),
      m("b", "2026-10-02T10:00:00Z"),
      m("c", "2026-10-03T10:00:00Z"),
      m("optimistic-1", "2026-10-05T10:00:00Z"),
    ];
    const frescos = [m("c", "2026-10-03T10:00:00Z"), m("d", "2026-10-04T10:00:00Z")];
    expect(refrescarHilo(actuales, frescos).map((x) => x.id)).toEqual(["a", "b", "c", "d", "optimistic-1"]);
  });

  it("con la misma hora que el primero de los frescos, decide el id, como la base", () => {
    const actuales = [m("b1", "2026-10-03T10:00:00Z"), m("b2", "2026-10-03T10:00:00Z")];
    const frescos = [m("b2", "2026-10-03T10:00:00Z"), m("b3", "2026-10-03T10:00:00Z")];
    expect(refrescarHilo(actuales, frescos).map((x) => x.id)).toEqual(["b1", "b2", "b3"]);
  });
});
