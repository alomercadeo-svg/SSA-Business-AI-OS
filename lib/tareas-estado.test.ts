import { describe, it, expect } from "vitest";
import { marcaVisible, marcaVencida, MINUTOS_PARA_VENCER, haceCuanto } from "./tareas-estado";

/**
 * La «Última revisión» de Vigilancia de canales (F39) y la regla de los 30
 * minutos en rojo salen de `ultimo_ok_at`, NO de `ultima_ejecucion_at`.
 * `reservar_tarea` (00032) escribe `ultima_ejecucion_at` al TOMAR la tarea,
 * antes de hacer nada: si la marca visible saliera de ahí, una vigilancia que
 * falla siempre se vería viva. Pedido de Marcos el 08/10/2026, escrito en rojo
 * antes de que existiera el módulo.
 */
const AHORA = new Date("2026-10-08T21:00:00Z");

describe("marca visible de una tarea", () => {
  it("una corrida que falla no mueve la marca visible", () => {
    const fila = { ultima_ejecucion_at: "2026-10-08T20:59:00Z", ultimo_ok_at: "2026-10-08T19:00:00Z" };
    expect(marcaVisible(fila)).toBe("2026-10-08T19:00:00Z");
    expect(marcaVencida(fila, AHORA)).toBe(true);
  });

  it("control positivo: una corrida buena reciente no está vencida", () => {
    const fila = { ultima_ejecucion_at: "2026-10-08T20:55:00Z", ultimo_ok_at: "2026-10-08T20:55:00Z" };
    expect(marcaVisible(fila)).toBe("2026-10-08T20:55:00Z");
    expect(marcaVencida(fila, AHORA)).toBe(false);
  });

  it("sin ninguna corrida buena, no hay marca y está vencida", () => {
    expect(marcaVisible({ ultima_ejecucion_at: "2026-10-08T20:59:00Z", ultimo_ok_at: null })).toBeNull();
    expect(marcaVencida({ ultima_ejecucion_at: "2026-10-08T20:59:00Z", ultimo_ok_at: null }, AHORA)).toBe(true);
    expect(marcaVencida(null, AHORA)).toBe(true);
  });

  it("vence a los 30 minutos justos", () => {
    expect(MINUTOS_PARA_VENCER).toBe(30);
    const limite = new Date(AHORA.getTime() - 30 * 60_000).toISOString();
    expect(marcaVencida({ ultimo_ok_at: limite }, AHORA)).toBe(false);
    expect(marcaVencida({ ultimo_ok_at: new Date(AHORA.getTime() - 30 * 60_000 - 1).toISOString() }, AHORA)).toBe(true);
  });
});

describe("hace cuánto (F39, para la pantalla)", () => {
  const ahora = new Date("2026-10-09T19:00:00.000Z");
  it("en minutos, en horas y en días", () => {
    expect(haceCuanto("2026-10-09T18:59:40.000Z", ahora)).toBe("hace menos de 1 min");
    expect(haceCuanto("2026-10-09T18:48:00.000Z", ahora)).toBe("hace 12 min");
    expect(haceCuanto("2026-10-09T16:00:00.000Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-10-06T19:00:00.000Z", ahora)).toBe("hace 3 días");
  });
  it("una marca en el futuro no dice «hace» un número negativo", () => {
    expect(haceCuanto("2026-10-09T19:05:00.000Z", ahora)).toBe("hace menos de 1 min");
  });
});
