import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Las acciones de servidor de la pantalla de integraciones (F24), con Zernio,
 * Vault y la base simulados. **Ninguna llamada real**: desconectar una cuenta
 * en Zernio corta el canal vivo del negocio, y eso se prueba solo así.
 *
 * Se vieron en rojo antes de escribir `lib/actions/integraciones.ts`.
 */

const h = vi.hoisted(() => ({
  rol: "owner" as string,
  canal: null as null | { id: string; username: string; late_account_id: string; platform: string; provider: string },
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
  deletes: [] as string[],
  deleteAccount: vi.fn(),
  setSecret: vi.fn(async () => ({ error: null })),
  zernioKey: "zk-simulada" as string | null,
}));

function supabaseFalso() {
  return {
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        maybeSingle: async () => ({ data: tabla === "channels" ? h.canal : null, error: null }),
        update: (valores: Record<string, unknown>) => {
          h.updates.push({ tabla, valores });
          return cadena;
        },
        delete: () => {
          h.deletes.push(tabla);
          return cadena;
        },
        then: (ok: (r: { data: null; error: null }) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return cadena;
    },
  };
}

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({ workspace: { id: "ws-1" }, role: h.rol, user: { id: "u-1" }, supabase: supabaseFalso() }),
}));

vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  getZernioApiKey: async () => h.zernioKey,
  setWorkspaceSecret: h.setSecret,
  deleteWorkspaceSecret: vi.fn(async () => ({ error: null })),
  getWorkspaceSecret: vi.fn(async () => null),
}));

vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { deleteAccount: h.deleteAccount } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { desconectarCuentaInstagram, guardarClave } = await import("./integraciones");

beforeEach(() => {
  h.rol = "owner";
  h.canal = { id: "ch-1", username: "alomercadeo", late_account_id: "acc-1", platform: "instagram", provider: "zernio" };
  h.updates.length = 0;
  h.deletes.length = 0;
  h.deleteAccount.mockReset();
  h.deleteAccount.mockResolvedValue({ data: {} });
  h.setSecret.mockClear();
  h.zernioKey = "zk-simulada";
});

describe("desconectar una cuenta de Instagram", () => {
  it("sin la confirmación que nombra la cuenta, no llama a Zernio", async () => {
    const r = await desconectarCuentaInstagram("ch-1", "otra-cuenta");
    expect(r.ok).toBe(false);
    expect(h.deleteAccount).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("una confirmación vacía tampoco alcanza", async () => {
    const r = await desconectarCuentaInstagram("ch-1", "");
    expect(r.ok).toBe(false);
    expect(h.deleteAccount).not.toHaveBeenCalled();
  });

  /** La contraparte afirmativa: sin ella, "no llama" pasaría también con todo roto. */
  it("con la confirmación correcta, desconecta en Zernio y marca el canal inactivo", async () => {
    const r = await desconectarCuentaInstagram("ch-1", "@alomercadeo");
    expect(r.ok).toBe(true);
    expect(h.deleteAccount).toHaveBeenCalledTimes(1);
    expect(h.deleteAccount).toHaveBeenCalledWith({ path: { accountId: "acc-1" } });
    expect(h.updates).toContainEqual({ tabla: "channels", valores: expect.objectContaining({ is_active: false }) });
  });

  it("nunca borra la fila del canal: el historial de conversaciones se conserva", async () => {
    await desconectarCuentaInstagram("ch-1", "alomercadeo");
    expect(h.deletes).toEqual([]);
  });

  it("si Zernio responde 404, la cuenta ya no estaba: se da por desconectada", async () => {
    h.deleteAccount.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    const r = await desconectarCuentaInstagram("ch-1", "alomercadeo");
    expect(r.ok).toBe(true);
    expect(h.updates).toContainEqual({ tabla: "channels", valores: expect.objectContaining({ is_active: false }) });
  });

  it("si Zernio falla por otra cosa, el canal sigue activo y se informa", async () => {
    h.deleteAccount.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const r = await desconectarCuentaInstagram("ch-1", "alomercadeo");
    expect(r.ok).toBe(false);
    expect(h.updates.filter((u) => u.tabla === "channels")).toEqual([]);
  });

  it("un Member no puede, aunque mande la confirmación correcta", async () => {
    h.rol = "member";
    const r = await desconectarCuentaInstagram("ch-1", "alomercadeo");
    expect(r.ok).toBe(false);
    expect(h.deleteAccount).not.toHaveBeenCalled();
  });
});

describe("guardar una clave", () => {
  it("rechaza un formato inválido sin tocar Vault", async () => {
    const r = await guardarClave("resend", "sin-prefijo-pero-larguisima-1234");
    expect(r.ok).toBe(false);
    expect(h.setSecret).not.toHaveBeenCalled();
  });

  it("guarda en Vault y devuelve a lo sumo largo y últimos cuatro, nunca la clave", async () => {
    const valor = "re_ESTOESUNSECRETOQUENOSEVE9876";
    const r = await guardarClave("resend", valor);
    expect(r.ok).toBe(true);
    expect(h.setSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", "resend_api_key", valor);
    expect(JSON.stringify(r)).not.toContain("SECRETO");
    expect(r.ok && r.mascara).toEqual({ largo: valor.length, ultimos4: "9876" });
  });

  it("la clave global de Evolution no se carga desde la pantalla", async () => {
    const r = await guardarClave("evolution", "x".repeat(40));
    expect(r.ok).toBe(false);
    expect(h.setSecret).not.toHaveBeenCalled();
  });

  it("un Member no puede guardar claves", async () => {
    h.rol = "member";
    const r = await guardarClave("openai", "x".repeat(40));
    expect(r.ok).toBe(false);
    expect(h.setSecret).not.toHaveBeenCalled();
  });
});
