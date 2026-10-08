import { describe, it, expect } from "vitest";
import { decidirCanalDeCuenta, platformUserIdDe, type CanalParaIdentidad } from "./channel-rules";

/**
 * La identidad de un canal es la cuenta, no la ranura del proveedor (criterio
 * de F26 del 22/09/2026). **Con respuestas simuladas**, incluida la del día del
 * hallazgo: Zernio le dio a `@alomercadeo` el `_id` que tenía `@theconsultour`.
 * Que `platformUserId` llega en la raíz de cada cuenta se verificó el
 * 07/10/2026 con un GET real de solo lectura; un reemplazo real no se provocó.
 */

const canal = (o: Partial<CanalParaIdentidad> & { id: string }): CanalParaIdentidad => ({
  late_account_id: "6aab34cb8d284ffb210b9700",
  platform_account_id: null,
  is_active: true,
  ...o,
});

const RANURA = "6aab34cb8d284ffb210b9700";

describe("platformUserIdDe", () => {
  it("lo lee de la raíz de la cuenta, como texto", () => {
    expect(platformUserIdDe({ platformUserId: "28670425919307767" })).toBe("28670425919307767");
    expect(platformUserIdDe({ platformUserId: 42 })).toBe("42");
  });
  it("ausente o vacío es nulo: nunca 'otra cuenta'", () => {
    expect(platformUserIdDe({})).toBeNull();
    expect(platformUserIdDe({ platformUserId: "  " })).toBeNull();
    expect(platformUserIdDe(null)).toBeNull();
  });
});

describe("decidirCanalDeCuenta", () => {
  it("el caso del 22/09: misma ranura, otra cuenta → no renombra, reemplaza", () => {
    const viejo = canal({ id: "theconsultour", platform_account_id: "111-theconsultour" });
    const d = decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222-alomercadeo" }, [viejo]);
    expect(d).toEqual({ tipo: "reemplazar", viejo, identidad: "222-alomercadeo" });
  });

  it("misma ranura y misma cuenta → es el mismo canal (puede haber cambiado el handle)", () => {
    const c = canal({ id: "a", platform_account_id: "222" });
    expect(decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222" }, [c])).toEqual({ tipo: "existente", canal: c, completarIdentidad: null });
  });

  it("la fila activa sin identidad registrada: primera observación, se completa", () => {
    const c = canal({ id: "a" });
    expect(decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222" }, [c])).toEqual({ tipo: "existente", canal: c, completarIdentidad: "222" });
  });

  it("la cuenta no trae platformUserId → se sigue como antes, nunca reemplaza", () => {
    const c = canal({ id: "a", platform_account_id: "111" });
    expect(decidirCanalDeCuenta({ _id: RANURA }, [c])).toEqual({ tipo: "existente", canal: c, completarIdentidad: null });
  });

  it("ranura nueva → se crea con su identidad", () => {
    expect(decidirCanalDeCuenta({ _id: "otra-ranura", platformUserId: "333" }, [canal({ id: "a" })])).toEqual({ tipo: "crear", identidad: "333" });
  });

  it("después del reemplazo, la siguiente sincronización reconoce el canal nuevo y deja quieto el viejo", () => {
    const viejo = canal({ id: "viejo", platform_account_id: "111", is_active: false });
    const nuevo = canal({ id: "nuevo", platform_account_id: "222" });
    expect(decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222" }, [viejo, nuevo])).toMatchObject({ tipo: "existente", canal: { id: "nuevo" } });
  });

  it("solo filas inactivas de otra cuenta en la ranura → se crea una nueva", () => {
    const viejo = canal({ id: "viejo", platform_account_id: "111", is_active: false });
    expect(decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222" }, [viejo])).toEqual({ tipo: "crear", identidad: "222" });
  });

  it("una fila inactiva de la misma cuenta se toma sin reactivarla (reactivar es a mano)", () => {
    const inactivo = canal({ id: "x", platform_account_id: "222", is_active: false });
    expect(decidirCanalDeCuenta({ _id: RANURA, platformUserId: "222" }, [inactivo])).toEqual({ tipo: "existente", canal: inactivo, completarIdentidad: null });
  });
});
