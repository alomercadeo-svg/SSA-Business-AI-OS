import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `POST /api/v1/channels/test-key` no le manda al navegador las cuentas de
 * Zernio tal como vienen (07/10/2026).
 *
 * La respuesta de `GET /v1/accounts` trae por cuenta campos del proveedor que
 * la pantalla no usa, entre ellos `byokCredentials` y `tokenExpiresAt` (vistos
 * por nombre en un GET real de ese día). La ruta devolvía `{ accounts }` entero
 * y las dos pantallas que la llaman solo usaban la cantidad. Ahora devuelve
 * `{ accountCount }`.
 *
 * Zernio, Vault, el registro del webhook, la importación y la base van
 * simulados: este test no llama a nada real, y «Probar y guardar» no se aprieta
 * en producción para verificarlo, porque llama a Zernio y dispara la
 * sincronización.
 *
 * Se vio en rojo contra la ruta de antes: la respuesta traía las cuentas.
 */

const h = vi.hoisted(() => ({
  cuentas: [] as Record<string, unknown>[],
}));

function supabaseFalso() {
  return {
    from() {
      const c = {
        select: () => c,
        eq: () => c,
        insert: () => c,
        single: async () => ({ data: { id: "canal-nuevo" }, error: null }),
        then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return c;
    },
  };
}

vi.mock("@/lib/workspace", () => ({
  requireManager: async () => ({
    contexto: { workspace: { id: "ws-1" }, role: "owner", user: { id: "u-1", email: "a@ssa-test.local", user_metadata: {} }, supabase: supabaseFalso() },
    error: null,
  }),
}));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { listAccounts: async () => ({ data: { accounts: h.cuentas } }) } }),
}));
vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  setWorkspaceSecret: async () => ({ error: null }),
}));
vi.mock("@/lib/zernio-webhook", () => ({
  ensureWebhookRegistered: async () => {},
  getOrCreateWorkspaceWebhookSecret: async () => "secreto",
  WEBHOOK_EVENTS: ["message.received"],
}));
const backfill = vi.hoisted(() => vi.fn(async (_opciones: Record<string, unknown>) => ({ imported: 0 })));
vi.mock("@/lib/inbox-sync", () => ({
  backfillInboxConversations: backfill,
  canalesConCuentaDeZernio: (c: unknown[]) => c,
}));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async () => true,
}));

const { POST } = await import("./route");

const cuenta = (id: string, platform: string) => ({
  _id: id,
  platform,
  username: `user-${id}`,
  displayName: `Cuenta ${id}`,
  platformUserId: `pu-${id}`,
  byokCredentials: { token: "secreto-falso-del-proveedor" },
  tokenExpiresAt: "2026-12-01T00:00:00Z",
  permissions: ["instagram_manage_messages"],
  metadata: { instagramScopedId: "isid-1" },
});

const llamar = async () => {
  const res = await POST(
    new Request("http://localhost/api/v1/channels/test-key", {
      method: "POST",
      body: JSON.stringify({ apiKey: "zk-simulada" }),
    }) as never
  );
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  h.cuentas = [cuenta("a", "instagram"), cuenta("b", "whatsapp")];
});

describe("la respuesta de test-key", () => {
  it("no trae ningún dato de las cuentas de Zernio", async () => {
    const { status, cuerpo } = await llamar();
    expect(status).toBe(200);
    const texto = JSON.stringify(cuerpo);
    for (const prohibido of ["byokCredentials", "secreto-falso-del-proveedor", "tokenExpiresAt", "platformUserId", "permissions", "instagramScopedId", "user-a"]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
    expect(cuerpo).not.toHaveProperty("accounts");
  });

  /** Control positivo: sin esto, una respuesta vacía pasaría el test de arriba. */
  it("trae la cantidad de cuentas, que es lo único que usan las pantallas", async () => {
    const { cuerpo } = await llamar();
    expect(cuerpo).toEqual({ accountCount: 2 });
  });

  it("con cero cuentas, la cantidad es 0 y no un valor fijo", async () => {
    h.cuentas = [];
    const { cuerpo } = await llamar();
    expect(cuerpo).toEqual({ accountCount: 0 });
  });
});

/**
 * F31: la importación audita «contacto creado» a nombre de quien la disparó.
 * Se vio en rojo el 08/10/2026: la ruta no le pasaba ningún actor.
 */
describe("la importación recibe el actor de quien la disparó", () => {
  it("le pasa a la importación el usuario de la sesión", async () => {
    backfill.mockClear();
    await llamar();
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill.mock.calls[0][0]).toMatchObject({ actor: { id: "u-1", etiqueta: "a@ssa-test.local" } });
  });
});
