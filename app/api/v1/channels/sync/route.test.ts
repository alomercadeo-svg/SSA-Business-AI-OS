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
        insert: async (valores: Record<string, unknown>) => {
          h.escrituras.push({ tabla, tipo: "insert", valores });
          return { error: null };
        },
        then: (ok: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: tabla === "channels" && !escritura ? h.canales : null, error: null }).then(ok),
      };
      return cadena;
    },
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      h.rpcs.push({ nombre, args });
      return { data: null, error: null };
    },
  };
}

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
vi.mock("@/lib/inbox-sync", () => ({
  backfillInboxConversations: async () => ({ imported: 0 }),
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

  it("la cuenta que no excede no queda marcada", async () => {
    await POST();

    expect(
      h.escrituras.some((e) => e.id === "ch-a" && e.valores.excede_plan_zernio === true),
    ).toBe(false);
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
  });
});
