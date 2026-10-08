import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * «Desconectar» de F24, desde el diálogo hasta la acción real del servidor, con
 * Zernio y la base simulados. **Ninguna llamada real.**
 *
 * Lo que prueban, con los criterios del plano:
 *   - si lo escrito no coincide con el nombre de la cuenta, no desconecta;
 *   - si coincide, desconecta (control positivo: sin él, "no desconecta"
 *     pasaría también con el botón roto);
 *   - el historial queda: ningún borrado y ningún acceso a conversaciones,
 *     mensajes ni contactos del canal.
 *
 * Se vieron en rojo el 08/10/2026, antes de escribir el diálogo: no existía.
 */

const h = vi.hoisted(() => ({
  canal: { id: "ch-p", username: "poderosascomunidad", late_account_id: "acc-p", platform: "instagram", provider: "zernio" },
  tablas: [] as string[],
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
  deletes: [] as string[],
  deleteAccount: vi.fn(),
}));

function supabaseFalso() {
  return {
    from(tabla: string) {
      h.tablas.push(tabla);
      let esUpdate = false;
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        maybeSingle: async () => ({ data: tabla === "channels" ? h.canal : null, error: null }),
        update: (valores: Record<string, unknown>) => {
          h.updates.push({ tabla, valores });
          esUpdate = true;
          return cadena;
        },
        delete: () => {
          h.deletes.push(tabla);
          return cadena;
        },
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve(esUpdate ? { data: [{ id: h.canal.id }], error: null } : { data: null, error: null }).then(ok),
      };
      return cadena;
    },
  };
}

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({ workspace: { id: "ws-1" }, role: "owner", user: { id: "u-1" }, supabase: supabaseFalso() }),
}));
vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  getZernioApiKey: async () => "zk-simulada",
}));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { deleteAccount: h.deleteAccount } }),
}));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async () => true,
}));
vi.mock("@/lib/integraciones-estado", () => ({ verificarTodas: vi.fn(), consultarProveedor: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ConfirmarDesconexion, intentarDesconexion } = await import("./confirmar-desconexion");

const CUENTA = { id: "ch-p", username: "poderosascomunidad" };

beforeEach(() => {
  h.tablas.length = 0;
  h.updates.length = 0;
  h.deletes.length = 0;
  h.deleteAccount.mockReset();
  h.deleteAccount.mockResolvedValue({ data: {} });
});

describe("el camino del botón hasta Zernio", () => {
  it("si lo escrito no coincide, no desconecta: ni Zernio ni la base", async () => {
    const r = await intentarDesconexion(CUENTA, "poderosascomunida");
    expect(r.ok).toBe(false);
    expect(h.deleteAccount).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("escribir otra cuenta tampoco: el nombre del negocio no desconecta la de prueba", async () => {
    const r = await intentarDesconexion(CUENTA, "alomercadeo");
    expect(r.ok).toBe(false);
    expect(h.deleteAccount).not.toHaveBeenCalled();
  });

  it("control positivo: si coincide, desconecta en Zernio y marca el canal inactivo", async () => {
    const r = await intentarDesconexion(CUENTA, "@PoderosasComunidad");
    expect(r.ok).toBe(true);
    expect(h.deleteAccount).toHaveBeenCalledWith({ path: { accountId: "acc-p" } });
    expect(h.updates).toEqual([{ tabla: "channels", valores: { is_active: false } }]);
  });

  it("el historial queda: nada se borra y no se toca ninguna tabla con historia", async () => {
    await intentarDesconexion(CUENTA, "poderosascomunidad");
    expect(h.deleteAccount).toHaveBeenCalledTimes(1);
    expect(h.deletes).toEqual([]);
    for (const t of ["conversations", "messages", "contact_channels", "contacts"]) {
      expect(h.tablas).not.toContain(t);
    }
  });
});

describe("el diálogo, como lo ve la persona al abrirlo", () => {
  const html = renderToStaticMarkup(
    createElement(ConfirmarDesconexion, { cuenta: CUENTA, onCerrar: () => {}, onHecho: () => {} })
  );

  it("nombra la cuenta y advierte que los mensajes entrantes dejan de llegar", () => {
    expect(html).toContain("Desconectar @poderosascomunidad");
    expect(html).toContain("dejan de llegar");
    expect(html).toContain("no se borran");
  });

  it("pide escribir el nombre de la cuenta para confirmar", () => {
    expect(html).toContain("Escribí poderosascomunidad para confirmar");
  });

  it("el botón que desconecta arranca deshabilitado", () => {
    const boton = html.match(/<button[^>]*data-confirmar[^>]*>/)?.[0];
    expect(boton, "no se encontró el botón que confirma").toBeDefined();
    expect(boton).toContain("disabled");
  });
});
