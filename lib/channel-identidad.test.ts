import { describe, it, expect } from "vitest";
import { decidirCanalDeCuenta, planDeSincronizacion, platformUserIdDe, type CanalParaIdentidad } from "./channel-rules";

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

/**
 * Hueco anotado el 08/10/2026 («Lo que F27 tiene que cerrar de F25 y F26»,
 * aparte): los candidatos se buscaban solo por ranura (`late_account_id`). Si
 * una cuenta vuelve con otro `_id` y el mismo `platformUserId`, se creaba otra
 * fila de la misma cuenta y el historial quedaba colgando de la vieja.
 * Escritos en rojo contra `lib/channel-rules.ts` de `8e21367`.
 */
describe("decidirCanalDeCuenta: la misma cuenta con otra ranura", () => {
  const RANURA_NUEVA = "7bbb00000000000000000001";

  it("vuelve con otro _id y el platformUserId de una fila INACTIVA → esa fila, con la ranura nueva, sin crear otra", () => {
    const vieja = canal({ id: "vieja", platform_account_id: "222", is_active: false });
    expect(decidirCanalDeCuenta({ _id: RANURA_NUEVA, platformUserId: "222" }, [vieja])).toEqual({
      tipo: "existente",
      canal: vieja,
      completarIdentidad: null,
      actualizarRanura: RANURA_NUEVA,
    });
  });

  it("lo mismo con la fila ACTIVA (Zernio cambió la ranura sin desconectar) → la misma fila", () => {
    const activa = canal({ id: "activa", platform_account_id: "222" });
    expect(decidirCanalDeCuenta({ _id: RANURA_NUEVA, platformUserId: "222" }, [activa])).toEqual({
      tipo: "existente",
      canal: activa,
      completarIdentidad: null,
      actualizarRanura: RANURA_NUEVA,
    });
  });

  it("con una activa y una inactiva de la misma cuenta, toma la activa", () => {
    const inactiva = canal({ id: "inactiva", late_account_id: "otra", platform_account_id: "222", is_active: false });
    const activa = canal({ id: "activa", platform_account_id: "222" });
    expect(decidirCanalDeCuenta({ _id: RANURA_NUEVA, platformUserId: "222" }, [inactiva, activa])).toMatchObject({
      tipo: "existente",
      canal: { id: "activa" },
    });
  });

  it("no cruza plataformas: el mismo identificador en otra plataforma no es la misma cuenta", () => {
    const fb = { ...canal({ id: "fb", platform_account_id: "222", is_active: false }), platform: "facebook" };
    expect(
      decidirCanalDeCuenta({ _id: RANURA_NUEVA, platformUserId: "222", platform: "instagram" }, [fb]),
    ).toEqual({ tipo: "crear", identidad: "222" });
  });

  it("control positivo: otra cuenta con ranura nueva se sigue creando", () => {
    const vieja = canal({ id: "vieja", platform_account_id: "222", is_active: false });
    expect(decidirCanalDeCuenta({ _id: RANURA_NUEVA, platformUserId: "333" }, [vieja])).toEqual({ tipo: "crear", identidad: "333" });
  });

  it("la sincronización no desactiva la fila activa cuya cuenta volvió con otra ranura", () => {
    const canales = [
      { id: "activa", provider: "zernio", late_account_id: RANURA, platform_account_id: "222", is_active: true },
      { id: "otra", provider: "zernio", late_account_id: "ranura-x", platform_account_id: "999", is_active: true },
    ];
    const plan = planDeSincronizacion({
      cuentas: [{ _id: RANURA_NUEVA, platformUserId: "222" }],
      perfiles: [],
      canales,
    });
    // La cuenta 222 vino (con otra ranura): su fila no se apaga. La 999 no vino:
    // esa sí, que es el control positivo de la limpieza.
    expect(plan).toMatchObject({ error: null, aDesactivar: ["otra"] });
  });
});

