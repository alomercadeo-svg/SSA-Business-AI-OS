import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cambiaDeDia, horaDeLaLista, separadorDeDia } from "./fechas-bandeja";

/**
 * Las fechas de la lista y del hilo de la bandeja (tramo A de S8). Hasta el
 * 03/11/2026 contaban bloques de 24 horas, no días del calendario, y usaban la
 * zona del navegador: un mensaje de ayer a las 23:00, visto hoy a las 09:00,
 * decía «Today» (10 horas son «0 días»). Ahora es el día del calendario en la
 * zona del negocio, America/Costa_Rica (UTC-6, sin horario de verano).
 *
 * El reloj queda fijo el martes 03/11/2026 a las 09:00 de Costa Rica, y el
 * proceso en UTC, como un navegador en otra zona: así se ve que no depende
 * de la zona de quien mira.
 */

const zonaOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z")); // 09:00 en Costa Rica
});
afterAll(() => {
  vi.useRealTimers();
  process.env.TZ = zonaOriginal;
});

describe("separadorDeDia, en el hilo", () => {
  it("un mensaje de ayer a las 23:00, visto hoy a las 09:00, dice «Ayer»", () => {
    expect(separadorDeDia("2026-11-03T05:00:00Z")).toBe("Ayer");
  });

  it("uno de hoy a las 08:00 dice «Hoy»", () => {
    expect(separadorDeDia("2026-11-03T14:00:00Z")).toBe("Hoy");
  });

  it("uno de hoy a la medianoche y un minuto dice «Hoy», aunque en UTC sea de ayer", () => {
    expect(separadorDeDia("2026-11-03T06:01:00Z")).toBe("Hoy");
  });

  it("dentro de la semana, el día: el jueves 29 de octubre dice «jueves»", () => {
    expect(separadorDeDia("2026-10-29T18:00:00Z")).toBe("jueves");
  });

  it("antes, la fecha", () => {
    expect(separadorDeDia("2026-10-15T18:00:00Z")).toBe("15 oct 2026");
  });
});

describe("horaDeLaLista", () => {
  it("de hoy, la hora de Costa Rica", () => {
    expect(horaDeLaLista("2026-11-03T14:05:00Z")).toBe("08:05");
  });

  it("de ayer a las 23:00, visto hoy a las 09:00, «Ayer»", () => {
    expect(horaDeLaLista("2026-11-03T05:00:00Z")).toBe("Ayer");
  });

  it("dentro de la semana, el día abreviado", () => {
    expect(horaDeLaLista("2026-10-29T18:00:00Z")).toBe("jue");
  });

  it("antes, el día y el mes; de otro año, también el año", () => {
    expect(horaDeLaLista("2026-10-15T18:00:00Z")).toBe("15 oct");
    expect(horaDeLaLista("2025-12-20T18:00:00Z")).toBe("20 dic 2025");
  });

  it("sin fecha, nada", () => {
    expect(horaDeLaLista(null)).toBe("");
  });
});

describe("cambiaDeDia, el corte entre separadores", () => {
  it("las 23:30 y las 00:30 de Costa Rica son días distintos, aunque en UTC sean el mismo", () => {
    expect(cambiaDeDia("2026-11-03T06:30:00Z", "2026-11-03T05:30:00Z")).toBe(true);
  });

  it("las 17:30 y las 18:30 de Costa Rica son el mismo día, aunque en UTC crucen la medianoche", () => {
    expect(cambiaDeDia("2026-11-03T00:30:00Z", "2026-11-02T23:30:00Z")).toBe(false);
  });

  it("el primer mensaje siempre lleva separador", () => {
    expect(cambiaDeDia("2026-11-03T00:30:00Z", undefined)).toBe(true);
  });
});
