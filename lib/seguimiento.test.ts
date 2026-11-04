import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { fechaEnDias, hoyEnZona } from "./seguimiento";

/**
 * «En 3 días», «En 7 días» y «En 14 días» del selector de próximo seguimiento
 * (F35, tramo C de S8): los días se cuentan desde hoy en la zona del negocio
 * (`workspaces.zona_horaria`, la misma que usan los filtros desde la 00044),
 * no en UTC ni en la zona del navegador.
 *
 * El reloj queda fijo a las 18:30 del miércoles 04/11/2026 de Costa Rica, que
 * en UTC ya son las 00:30 del jueves 05, y el proceso en UTC.
 */

const zonaOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T00:30:00Z")); // 18:30 del 04/11 en Costa Rica
});
afterAll(() => {
  vi.useRealTimers();
  process.env.TZ = zonaOriginal;
});

describe("hoy y hoy más N días, en la zona del negocio", () => {
  it("a las 18:30 de Costa Rica, hoy es el 04/11, no el 05 de UTC", () => {
    expect(hoyEnZona(new Date(), "America/Costa_Rica")).toBe("2026-11-04");
  });

  it("«En 3 días» da el 07/11, no el 08", () => {
    expect(fechaEnDias(new Date(), "America/Costa_Rica", 3)).toBe("2026-11-07");
  });

  it("«En 7 días» y «En 14 días»", () => {
    expect(fechaEnDias(new Date(), "America/Costa_Rica", 7)).toBe("2026-11-11");
    expect(fechaEnDias(new Date(), "America/Costa_Rica", 14)).toBe("2026-11-18");
  });

  it("con la zona del espacio en UTC, la misma hora ya es el 05: «En 3 días» da el 08 (control de la zona)", () => {
    expect(fechaEnDias(new Date(), "UTC", 3)).toBe("2026-11-08");
  });

  it("con Pacific/Kiritimati, 20 horas adelante de Costa Rica: hoy es el 05", () => {
    expect(hoyEnZona(new Date("2026-11-04T22:00:00Z"), "Pacific/Kiritimati")).toBe("2026-11-05");
    expect(hoyEnZona(new Date("2026-11-04T22:00:00Z"), "America/Costa_Rica")).toBe("2026-11-04");
  });

  it("cruza el mes: el 30/11 a las 18:30 de Costa Rica más 3 da el 03/12", () => {
    expect(fechaEnDias(new Date("2026-12-01T00:30:00Z"), "America/Costa_Rica", 3)).toBe("2026-12-03");
  });
});
