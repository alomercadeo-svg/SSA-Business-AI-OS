import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `POST /api/v1/channels/sync`, con Zernio y la base simulados. **Ninguna
 * llamada real**: la sincronización de verdad puede apagar el único canal vivo
 * del negocio, y por eso durante el arreglo no se apretó "Sincronizar" en
 * producción. Ver §15 del plano, deuda anotada el 05/10/2026.
 *
 * QUÉ SE MIRA, Y POR QUÉ NO ALCANZA CON LA RESPUESTA
 * El modo de falla es silencioso: la ruta respondía 200 y apagaba todos los
 * canales. Así que los tests no miran solo el JSON: miran las escrituras sobre
 * `channels` que registra el Supabase falso. "No se tocó ningún canal" es
 * literalmente "no hubo ningún update ni insert".
 *
 * EL CONTROL POSITIVO
 * Los tres primeros casos prueban que la ruta NO desactiva. Sin el cuarto, una
 * ruta que no desactiva nunca nada los pasaría a todos. El cuarto está en verde
 * antes y después del arreglo, y esa es su función: si el arreglo lo pusiera en
 * rojo, habría roto la limpieza de canales muertos.
 *
 * Los casos 1, 2, 3 y 5 se vieron en rojo contra la ruta anterior al arreglo.
 */

type Fila = Record<string, unknown> & { id: string };
type Escritura = { tabla: string; tipo: "update" | "insert"; valores: Record<string, unknown>; id?: unknown };

const h = vi.hoisted(() => ({
  canales: [] as Fila[],
  escrituras: [] as Escritura[],
  rpcs: [] as { nombre: string; args: Record<string, unknown> }[],
  listAccounts: vi.fn(),
  listProfiles: vi.fn(),
  ensureWebhookRegistered: vi.fn(async () => {}),
  pendientes: [] as Array<() => unknown | Promise<unknown>>,
  notificarAlerta: vi.fn(async () => null),
}));

function supabaseFalso() {
  return {
    from(tabla: string) {
      let escritura: Escritura | null = null;
      const cadena = {
        select: () => cadena,
        order: () => cadena,
        eq: (col: string, valor: unknown) => {
          if (escritura && col === "id") escritura.id = valor;
          return cadena;
        },
        update: (valores: Record<string, unknown>) => {
          escritura = { tabla, tipo: "update", valores };
          h.escrituras.push(escritura);
          return cadena;
        },
        insert: (valores: Record<string, unknown>) => {
          h.escrituras.push({ tabla, tipo: "insert", valores });
          const id = `nuevo-${h.escrituras.length}`;
          const resultado = { error: null };
          return {
            select: () => ({ single: async () => ({ data: { id }, error: null }) }),
            then: (ok: (r: { error: null }) => unknown) => Promise.resolve(resultado).then(ok),
          };
        },
        then: (ok: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: tabla === "channels" && !escritura ? h.canales : null, error: null }).then(ok),
      };
      return cadena;
    },
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      h.rpcs.push({ nombre, args });
      // `record_webhook_alert` devuelve el id de la condición abierta (00023).
      return { data: nombre === "record_webhook_alert" ? "alerta-1" : null, error: null };
    },
  };
}

vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void h.pendientes.push(fn) };
});
vi.mock("@/lib/correo", () => ({ notificarAlerta: h.notificarAlerta }));
vi.mock("@/lib/workspace", () => ({
  requireManager: async () => ({
    contexto: { workspace: { id: "ws-1" }, role: "owner", user: { id: "u-1" }, supabase: supabaseFalso() },
    error: null,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => supabaseFalso() }));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => "zk-simulada" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({
    accounts: { listAccounts: h.listAccounts },
    profiles: { listProfiles: h.listProfiles },
  }),
}));
vi.mock("@/lib/zernio-webhook", () => ({
  ensureWebhookRegistered: h.ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret: async () => "secreto",
  WEBHOOK_EVENTS: ["message.received"],
}));
const backfill = vi.hoisted(() => vi.fn(async (_opciones: Record<string, unknown>) => ({ imported: 0 })));
vi.mock("@/lib/inbox-sync", () => ({
  backfillInboxConversations: backfill,
  canalesConCuentaDeZernio: (c: unknown[]) => c,
}));

const { POST } = await import("./route");

const canal = (id: string, extra: Record<string, unknown>): Fila => ({
  id,
  workspace_id: "ws-1",
  platform: "instagram",
  provider: "zernio",
  is_active: true,
  excede_plan_zernio: false,
  profile_picture: null,
  ...extra,
});

const cuenta = (id: string, perfil: unknown) => ({
  _id: id,
  platform: "instagram",
  username: id,
  displayName: id,
  profileId: perfil,
  isActive: true,
});

const desactivados = () =>
  h.escrituras
    .filter((e) => e.tabla === "channels" && e.tipo === "update" && e.valores.is_active === false)
    .map((e) => e.id);

const escriturasEnCanales = () => h.escrituras.filter((e) => e.tabla === "channels");

beforeEach(() => {
  h.canales = [
    canal("ch-a", { late_account_id: "acc-a", username: "acc-a", display_name: "acc-a" }),
    canal("ch-b", { late_account_id: "acc-b", username: "acc-b", display_name: "acc-b" }),
    canal("ch-e", { provider: "evolution", platform: "whatsapp", late_account_id: null, instance_name: "alo" }),
  ];
  h.escrituras.length = 0;
  h.rpcs.length = 0;
  h.listAccounts.mockReset();
  h.listProfiles.mockReset();
  h.listProfiles.mockResolvedValue({ data: { profiles: [{ _id: "p1" }] } });
  h.ensureWebhookRegistered.mockClear();
  h.pendientes.length = 0;
  h.notificarAlerta.mockClear();
});

describe("1. Zernio responde sin una lista de cuentas", () => {
  for (const [nombre, data] of [
    ["sin el campo", {}],
    ["accounts en nulo", { accounts: null }],
    ["accounts que no es una lista", { accounts: "x" }],
    ["sin data", undefined],
  ] as const) {
    it(`${nombre}: falla con un error claro y no toca ningún canal`, async () => {
      h.listAccounts.mockResolvedValue({ data });
      const res = await POST();
      const cuerpo = await res.json();

      expect(res.status).toBe(502);
      expect(cuerpo.error).toContain("no tocó ningún canal");
      expect(escriturasEnCanales()).toEqual([]);
      expect(h.ensureWebhookRegistered).not.toHaveBeenCalled();
    });
  }
});

describe("2. Zernio devuelve cero cuentas con canales de Zernio activos", () => {
  it("no desactiva nada, lo dice y abre una alerta", async () => {
    h.listAccounts.mockResolvedValue({ data: { accounts: [] } });
    const res = await POST();
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(desactivados()).toEqual([]);
    expect(cuerpo.synced.aviso).toBe("Zernio devolvió cero cuentas: no se desactivó ningún canal");
    expect(cuerpo.synced.deactivated).toBe(0);
    expect(h.rpcs).toContainEqual({
      nombre: "record_webhook_alert",
      args: expect.objectContaining({
        p_source: "zernio",
        p_condition: "zernio_sync_cero_cuentas",
        p_workspace_id: "ws-1",
      }),
    });
  });

  // F23: abrir la alerta avisa por correo, después de responder.
  it("avisa por correo la alerta que abrió, en segundo plano", async () => {
    h.listAccounts.mockResolvedValue({ data: { accounts: [] } });
    await POST();

    expect(h.notificarAlerta).not.toHaveBeenCalled();
    for (const fn of h.pendientes.splice(0)) await fn();
    expect(h.notificarAlerta).toHaveBeenCalledWith("alerta-1");
  });
});

describe("3. Una cuenta de un perfil que excede el límite del plan", () => {
  beforeEach(() => {
    // Sin `includeOverLimit`, Zernio no trae las cuentas de perfiles excedidos
    // (`ListAccountsData`, dist/index.d.ts:11211). La marca está en el perfil
    // (`Profile.isOverLimit`, dist/index.d.ts:5191), no en la cuenta.
    h.listAccounts.mockImplementation(async (opts?: { query?: { includeOverLimit?: boolean } }) => ({
      data: {
        accounts: opts?.query?.includeOverLimit
          ? [cuenta("acc-a", "p1"), cuenta("acc-b", "p2")]
          : [cuenta("acc-a", "p1")],
      },
    }));
    h.listProfiles.mockImplementation(async (opts?: { query?: { includeOverLimit?: boolean } }) => ({
      data: {
        profiles: opts?.query?.includeOverLimit
          ? [{ _id: "p1" }, { _id: "p2", isOverLimit: true }]
          : [{ _id: "p1" }],
      },
    }));
  });

  it("no se desactiva y queda marcada como excedida", async () => {
    await POST();

    expect(desactivados()).not.toContain("ch-b");
    expect(h.escrituras).toContainEqual(
      expect.objectContaining({ tabla: "channels", tipo: "update", id: "ch-b", valores: { excede_plan_zernio: true } }),
    );
  });

  // "A no quedó marcada" es una comprobación por ausencia: contra una ruta que
  // no marca nunca nada se cumple sola. Por eso exige primero la presencia, que
  // B sí quedó marcada en la misma corrida. Corregido el 06/10/2026: la primera
  // versión de este test solo miraba la ausencia y daba verde contra la ruta
  // vieja, que no escribía la marca para ninguna cuenta.
  it("la cuenta que no excede no queda marcada, en la misma corrida que marca a la que sí", async () => {
    await POST();

    const marcadas = h.escrituras
      .filter((e) => e.tabla === "channels" && e.valores.excede_plan_zernio === true)
      .map((e) => e.id);
    expect(marcadas).toEqual(["ch-b"]);
  });
});

describe("4. Control positivo: la cuenta que falta SÍ se desactiva", () => {
  it("con Zernio trayendo A y no B, se desactiva B, y ni A ni el canal de Evolution", async () => {
    h.listAccounts.mockResolvedValue({ data: { accounts: [cuenta("acc-a", "p1")] } });
    const res = await POST();
    const cuerpo = await res.json();

    expect(desactivados()).toEqual(["ch-b"]);
    expect(cuerpo.synced.deactivated).toBe(1);
    expect(cuerpo.synced.aviso ?? null).toBeNull();
  });
});

describe("5. La alerta de cero cuentas se cierra sola", () => {
  it("una sincronización con cuentas cierra la condición abierta", async () => {
    h.listAccounts.mockResolvedValue({ data: { accounts: [cuenta("acc-a", "p1"), cuenta("acc-b", "p1")] } });
    await POST();

    expect(h.rpcs).toContainEqual({
      nombre: "resolve_webhook_alert",
      args: expect.objectContaining({
        p_source: "zernio",
        p_condition: "zernio_sync_cero_cuentas",
        p_workspace_id: "ws-1",
      }),
    });
    expect(desactivados()).toEqual([]);
    // Cerrar no avisa: el correo es solo para la condición que se abre.
    for (const fn of h.pendientes.splice(0)) await fn();
    expect(h.notificarAlerta).not.toHaveBeenCalled();
  });
});

/**
 * F26, criterio del 22/09/2026: la identidad del canal es la cuenta
 * (`platformUserId`), no la ranura de Zernio (`_id`). Con respuestas
 * simuladas: el caso real (Zernio dándole a `@alomercadeo` la ranura de
 * `@theconsultour`) no se volvió a provocar.
 */
describe("6. La misma ranura de Zernio con otra cuenta", () => {
  it("no renombra la fila: la desactiva, crea un canal nuevo y lo registra en el historial", async () => {
    h.canales = [canal("ch-vieja", { late_account_id: "acc-a", platform_account_id: "111", username: "theconsultour", display_name: "theconsultour" })];
    h.listAccounts.mockResolvedValue({ data: { accounts: [{ ...cuenta("acc-a", "p1"), username: "alomercadeo", platformUserId: "222" }] } });
    await POST();

    const enCanales = escriturasEnCanales();
    // Ningún update cambia el nombre de la fila vieja.
    expect(enCanales.some((e) => e.tipo === "update" && e.id === "ch-vieja" && "username" in e.valores)).toBe(false);
    expect(enCanales).toContainEqual({ tabla: "channels", tipo: "update", valores: { is_active: false }, id: "ch-vieja" });
    const insert = enCanales.find((e) => e.tipo === "insert");
    expect(insert?.valores).toMatchObject({ late_account_id: "acc-a", platform_account_id: "222", username: "alomercadeo", is_active: true });
    // La desactivación va antes que la inserción: solo un canal activo por ranura.
    expect(enCanales.indexOf(insert!)).toBeGreaterThan(enCanales.findIndex((e) => e.id === "ch-vieja"));

    const auditoria = h.escrituras.filter((e) => e.tabla === "audit_log");
    expect(auditoria).toHaveLength(1);
    expect((auditoria[0].valores as unknown as Record<string, unknown>[])[0]).toMatchObject({
      action: "canal.reemplazado",
      detail: { canal_viejo_id: "ch-vieja", cuenta_vieja: "111", cuenta_nueva: "222" },
    });
  });

  it("control positivo: la misma cuenta con otro handle sí actualiza la fila, sin reemplazar", async () => {
    h.canales = [canal("ch-a", { late_account_id: "acc-a", platform_account_id: "222", username: "viejo", display_name: "viejo" })];
    h.listAccounts.mockResolvedValue({ data: { accounts: [{ ...cuenta("acc-a", "p1"), platformUserId: "222" }] } });
    await POST();
    const enCanales = escriturasEnCanales();
    expect(enCanales.some((e) => e.tipo === "insert")).toBe(false);
    expect(enCanales).toContainEqual(expect.objectContaining({ tipo: "update", id: "ch-a", valores: expect.objectContaining({ username: "acc-a" }) }));
  });

  it("primera observación: completa la identidad de la fila sin tocar nada más", async () => {
    h.canales = [canal("ch-a", { late_account_id: "acc-a", platform_account_id: null, username: "acc-a", display_name: "acc-a" })];
    h.listAccounts.mockResolvedValue({ data: { accounts: [{ ...cuenta("acc-a", "p1"), platformUserId: "222" }] } });
    await POST();
    expect(escriturasEnCanales()).toEqual([{ tabla: "channels", tipo: "update", valores: { platform_account_id: "222" }, id: "ch-a" }]);
  });

  it("si la cuenta no trae platformUserId, no se reemplaza nada", async () => {
    h.canales = [canal("ch-a", { late_account_id: "acc-a", platform_account_id: "111", username: "acc-a", display_name: "acc-a" })];
    h.listAccounts.mockResolvedValue({ data: { accounts: [cuenta("acc-a", "p1")] } });
    await POST();
    expect(escriturasEnCanales()).toEqual([]);
  });
});

/**
 * F31: la importación audita «contacto creado» a nombre de quien la disparó.
 * Se vio en rojo el 08/10/2026: la ruta no le pasaba ningún actor.
 */
describe("la importación recibe el actor de quien la disparó", () => {
  it("le pasa a la importación el usuario de la sesión", async () => {
    backfill.mockClear();
    h.listAccounts.mockResolvedValue({ data: { accounts: [cuenta("acc-a", "p1"), cuenta("acc-b", "p1")] } });
    await POST();
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill.mock.calls[0][0]).toMatchObject({ actor: { id: "u-1", etiqueta: "u-1" } });
  });
});
