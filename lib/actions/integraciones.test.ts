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

const verificarTodas = vi.hoisted(() => vi.fn(async () => {}));
const consultarProveedor = vi.hoisted(() =>
  vi.fn(async (): Promise<{ estado: string; error: string | null; detalle?: string | null }> => ({
    estado: "conectado",
    error: null,
  }))
);
vi.mock("@/lib/integraciones-estado", () => ({ verificarTodas, consultarProveedor }));

const { desconectarCuentaInstagram, guardarClave, verificarIntegraciones, probarYGuardarResend, guardarRemitenteResend } =
  await import("./integraciones");

beforeEach(() => {
  h.rol = "owner";
  h.canal = { id: "ch-1", username: "alomercadeo", late_account_id: "acc-1", platform: "instagram", provider: "zernio" };
  h.updates.length = 0;
  h.deletes.length = 0;
  h.deleteAccount.mockReset();
  h.deleteAccount.mockResolvedValue({ data: {} });
  h.setSecret.mockClear();
  h.zernioKey = "zk-simulada";
  consultarProveedor.mockClear();
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
    // Con Anthropic y no con Resend: desde F23 la de Resend se guarda con
    // "Probar y guardar", y su propio test de abajo exige lo mismo.
    const valor = "sk-ant-ESTOESUNSECRETOQUENOSEVE9876";
    const r = await guardarClave("anthropic", valor);
    expect(r.ok).toBe(true);
    expect(h.setSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", "anthropic_api_key", valor);
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

describe("verificar las integraciones al abrir la pantalla", () => {
  it("un manager dispara la verificación de su workspace", async () => {
    verificarTodas.mockClear();
    const r = await verificarIntegraciones();
    expect(r.ok).toBe(true);
    expect(verificarTodas).toHaveBeenCalledWith(expect.anything(), "ws-1");
  });

  it("un Member no la dispara", async () => {
    verificarTodas.mockClear();
    h.rol = "member";
    const r = await verificarIntegraciones();
    expect(r.ok).toBe(false);
    expect(verificarTodas).not.toHaveBeenCalled();
  });
});

// ── Resend (F23) ────────────────────────────────────────────────────────────

const CLAVE_RESEND = "re_clave_simulada_0123456789";
const REMITENTE = "ALO Mercadeo <avisos@notificaciones.alomercadeo.com>";

describe("Probar y guardar de Resend", () => {
  it("con una clave que Resend acepta, la guarda junto con el remitente (control positivo)", async () => {
    consultarProveedor.mockResolvedValueOnce({
      estado: "conectado",
      error: null,
      detalle: "Clave de solo envío: el estado del dominio no se puede consultar con esta clave.",
    });
    const r = await probarYGuardarResend(CLAVE_RESEND, REMITENTE);

    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("simulada");
    expect(consultarProveedor).toHaveBeenCalledWith("resend", CLAVE_RESEND);
    expect(h.setSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", "resend_api_key", CLAVE_RESEND);
    const update = h.updates.find((u) => u.tabla === "integration_configs");
    expect(update?.valores).toMatchObject({ estado: "conectado", config: expect.objectContaining({ remitente: REMITENTE }) });
  });

  it("con una clave que Resend rechaza, no guarda nada y lo dice como el prototipo", async () => {
    consultarProveedor.mockResolvedValueOnce({ estado: "desconectado", error: "Resend dice que la clave es inválida." });
    const r = await probarYGuardarResend(CLAVE_RESEND, REMITENTE);

    expect(r).toEqual({
      ok: false,
      error: "No pudimos conectar con Resend: la clave no es válida. Revisá que la copiaste completa.",
    });
    expect(h.setSecret).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("si no se pudo preguntar, guarda igual y queda sin verificar", async () => {
    consultarProveedor.mockResolvedValueOnce({ estado: "sin_verificar", error: "Resend no respondió a tiempo." });
    const r = await probarYGuardarResend(CLAVE_RESEND, REMITENTE);
    expect(r.ok).toBe(true);
    expect(h.updates[0].valores).toMatchObject({ estado: "sin_verificar" });
  });

  it("con un remitente mal escrito no le pregunta a Resend", async () => {
    const r = await probarYGuardarResend(CLAVE_RESEND, "ALO Mercadeo");
    expect(r.ok).toBe(false);
    expect(consultarProveedor).not.toHaveBeenCalled();
    expect(h.setSecret).not.toHaveBeenCalled();
  });

  it("un Member no puede", async () => {
    h.rol = "member";
    const r = await probarYGuardarResend(CLAVE_RESEND, REMITENTE);
    expect(r.ok).toBe(false);
    expect(consultarProveedor).not.toHaveBeenCalled();
  });

  it("la clave de Resend ya no se guarda sin probar", async () => {
    const r = await guardarClave("resend", CLAVE_RESEND);
    expect(r.ok).toBe(false);
    expect(h.setSecret).not.toHaveBeenCalled();
  });

  it("el remitente se puede cambiar sin tocar la clave", async () => {
    const r = await guardarRemitenteResend(REMITENTE);
    expect(r.ok).toBe(true);
    expect(h.setSecret).not.toHaveBeenCalled();
    expect(h.updates[0].valores).toMatchObject({ config: { remitente: REMITENTE } });
  });
});
