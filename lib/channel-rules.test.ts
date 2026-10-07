import { describe, it, expect } from "vitest";
import { debeDesactivarseCanal, planDeSincronizacion, ERROR_FORMA_INESPERADA } from "./channel-rules";
import { canalesConCuentaDeZernio } from "./inbox-sync";

/**
 * La regla de desactivación tiene dos mitades y las dos se rompen en silencio.
 *
 * Este archivo existe porque la 00022 sacó el `NOT NULL` de
 * `channels.late_account_id`, y eso destapó un error latente: el bucle de
 * `/api/v1/channels/sync` comparaba el identificador contra un Set de cuentas
 * vigentes, y con el valor en nulo esa comparación da negativa SIEMPRE.
 *
 * Los dos modos de falla son invisibles, y por eso hacen falta las dos
 * direcciones del test:
 *
 *   * Si la guarda falta, el canal de WhatsApp se desactiva cada vez que
 *     alguien apreta "Sincronizar", y el receptor —que exige `is_active`—
 *     empieza a rechazar todos los mensajes. Nadie ve un error: la bandeja
 *     deja de recibir y parece un día tranquilo.
 *   * Si la guarda queda demasiado amplia, la sincronización deja de limpiar y
 *     los canales muertos se quedan marcados como activos para siempre.
 *     Tampoco hay error.
 */
describe("debeDesactivarseCanal", () => {
  const vigentes = new Set<string | undefined>(["acct-viva"]);

  const canal = (extra: Partial<Parameters<typeof debeDesactivarseCanal>[0]> = {}) => ({
    provider: "zernio",
    late_account_id: "acct-viva",
    is_active: true,
    ...extra,
  });

  // ── La mitad afirmativa. Este es el test importante del arreglo: si la
  // guarda por proveedor quedara mal escrita, la sincronización dejaría de
  // limpiar y nadie se enteraría.
  it("desactiva un canal de Zernio cuya cuenta ya no existe", () => {
    expect(debeDesactivarseCanal(canal({ late_account_id: "acct-muerta" }), vigentes)).toBe(true);
  });

  it("no toca un canal de Zernio cuya cuenta sigue viva", () => {
    expect(debeDesactivarseCanal(canal(), vigentes)).toBe(false);
  });

  it("no vuelve a desactivar uno que ya está inactivo", () => {
    expect(
      debeDesactivarseCanal(canal({ late_account_id: "acct-muerta", is_active: false }), vigentes),
    ).toBe(false);
  });

  // ── La mitad negativa: el bug que la 00022 destapó.
  it("NO desactiva un canal de Evolution, que no tiene cuenta de Zernio", () => {
    expect(
      debeDesactivarseCanal(canal({ provider: "evolution", late_account_id: null }), vigentes),
    ).toBe(false);
  });

  it("no desactiva un canal de Evolution ni cuando la lista de cuentas viene vacía", () => {
    // El caso real: una sincronización cualquiera, donde ninguna cuenta de
    // Zernio coincide con un identificador que no existe.
    expect(
      debeDesactivarseCanal(
        canal({ provider: "evolution", late_account_id: null }),
        new Set<string | undefined>(),
      ),
    ).toBe(false);
  });

  it("un canal de Zernio con el identificador en nulo tampoco sobrevive por accidente", () => {
    // No debería existir, pero si existiera es un canal roto, no uno de otro
    // proveedor: desactivarlo es lo correcto.
    expect(debeDesactivarseCanal(canal({ late_account_id: null }), vigentes)).toBe(true);
  });
});

/**
 * El backfill trae conversaciones por la API de Zernio, así que un canal sin
 * cuenta de Zernio no tiene por dónde consultarse.
 */
describe("canalesConCuentaDeZernio", () => {
  it("deja pasar los canales con cuenta", () => {
    const canales = [{ id: "ch-1", late_account_id: "acct-1", platform: "instagram" }];
    expect(canalesConCuentaDeZernio(canales)).toHaveLength(1);
  });

  it("filtra los que no la tienen, en vez de dejarlos fallar adentro", () => {
    const canales = [
      { id: "ch-1", late_account_id: "acct-1", platform: "instagram" },
      { id: "ch-evo", late_account_id: null, platform: "whatsapp" },
    ];
    expect(canalesConCuentaDeZernio(canales).map((c) => c.id)).toEqual(["ch-1"]);
  });
});

/**
 * `planDeSincronizacion`: la decisión de la sincronización con Zernio, antes de
 * escribir nada. Deuda de §15, resuelta el 06/10/2026. La ruta tiene sus
 * propios tests con las escrituras simuladas (`app/api/v1/channels/sync/`);
 * estos cubren las formas de la respuesta que allá no vale la pena repetir.
 */
describe("planDeSincronizacion", () => {
  const canales = [
    { id: "ch-a", provider: "zernio", late_account_id: "acc-a", is_active: true },
    { id: "ch-b", provider: "zernio", late_account_id: "acc-b", is_active: true },
    { id: "ch-e", provider: "evolution", late_account_id: null, is_active: true },
  ];

  it("una respuesta sin lista de cuentas o de perfiles es un error, no una lista vacía", () => {
    for (const cuentas of [undefined, null, {}, "x", 3]) {
      expect(planDeSincronizacion({ cuentas, perfiles: [], canales })).toEqual({ error: ERROR_FORMA_INESPERADA });
    }
    expect(planDeSincronizacion({ cuentas: [], perfiles: undefined, canales })).toEqual({
      error: ERROR_FORMA_INESPERADA,
    });
  });

  it("cero cuentas con canales de Zernio activos no desactiva nada", () => {
    const plan = planDeSincronizacion({ cuentas: [], perfiles: [], canales });
    expect(plan).toMatchObject({ error: null, aDesactivar: [], ceroCuentas: true });
  });

  it("cero cuentas sin canales de Zernio activos no es un aviso", () => {
    const plan = planDeSincronizacion({
      cuentas: [],
      perfiles: [],
      canales: [canales[2], { ...canales[0], is_active: false }],
    });
    expect(plan).toMatchObject({ error: null, aDesactivar: [], ceroCuentas: false });
  });

  it("la marca de exceso sale del perfil, con profileId como texto o como objeto", () => {
    const plan = planDeSincronizacion({
      cuentas: [
        { _id: "acc-a", profileId: "p1" },
        { _id: "acc-b", profileId: "p2" },
        { _id: "acc-c", profileId: { _id: "p3", isOverLimit: true } },
        { _id: "acc-d", profileId: { _id: "p2" } },
      ],
      perfiles: [{ _id: "p1" }, { _id: "p2", isOverLimit: true }],
      canales,
    });
    if (plan.error !== null) throw new Error(plan.error);
    expect([...plan.excedidas].sort()).toEqual(["acc-b", "acc-c", "acc-d"]);
    expect(plan.aDesactivar).toEqual([]);
  });

  // ── El control positivo. Si este falla, los anteriores no prueban nada: una
  // función que nunca desactiva los pasaría a todos.
  it("con una lista que trae unas cuentas y no otra, la que falta SÍ se desactiva", () => {
    const plan = planDeSincronizacion({ cuentas: [{ _id: "acc-a", profileId: "p1" }], perfiles: [], canales });
    expect(plan).toMatchObject({ error: null, aDesactivar: ["ch-b"], ceroCuentas: false });
  });
});
