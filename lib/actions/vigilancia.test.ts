import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El límite de silencio de un canal (F39), desde Configuración, Vigilancia de
 * canales. Solo Owner y Admin, con el control en el servidor. Vacío = el canal
 * no se vigila. Queda en el historial con el antes y el después.
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  canal: { id: "ch-1", workspace_id: "ws-1", platform: "instagram", username: "poderosascomunidad", display_name: null, instance_name: null, umbral_silencio_horas: 8 as number | null },
  updates: [] as Array<{ valores: Record<string, unknown>; filtros: Record<string, unknown> }>,
  auditoria: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({
    workspace: { id: "ws-1" },
    user: { id: "u-1", email: "ale@ssa-test.local", user_metadata: {} },
    role: h.rol,
    supabase: {
      from: () => {
        const filtros: Record<string, unknown> = {};
        let valores: Record<string, unknown> | null = null;
        const c: any = {
          select: () => c,
          eq: (k: string, v: unknown) => ((filtros[k] = v), c),
          update: (v: Record<string, unknown>) => ((valores = v), c),
          maybeSingle: async () => {
            if (valores) {
              h.updates.push({ valores, filtros: { ...filtros } });
              return { data: { id: h.canal.id }, error: null };
            }
            return { data: filtros.id === h.canal.id && filtros.workspace_id === "ws-1" ? h.canal : null, error: null };
          },
        };
        return c;
      },
    },
  }),
}));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async (e: Record<string, unknown>) => (h.auditoria.push(e), true),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { guardarUmbral } = await import("./vigilancia");

beforeEach(() => {
  h.rol = "owner";
  h.canal.umbral_silencio_horas = 8;
  h.updates.length = 0;
  h.auditoria.length = 0;
});

describe("guardar el límite de silencio de un canal (F39)", () => {
  it("vacío deja el canal sin vigilar (nulo) y queda en el historial", async () => {
    const r = await guardarUmbral("ch-1", "");
    expect(r.ok).toBe(true);
    expect(h.updates).toEqual([{ valores: { umbral_silencio_horas: null }, filtros: { id: "ch-1", workspace_id: "ws-1" } }]);
    expect(h.auditoria).toMatchObject([
      {
        accion: "configuracion.cambiada",
        entidad: { tipo: "canal", id: "ch-1", etiqueta: "Vigilancia de canales: Instagram @poderosascomunidad" },
        cambios: { umbral_silencio_horas: { antes: 8, despues: null } },
      },
    ]);
  });

  it("un número entero mayor que 0 se guarda", async () => {
    expect((await guardarUmbral("ch-1", " 12 ")).ok).toBe(true);
    expect(h.updates[0].valores).toEqual({ umbral_silencio_horas: 12 });
  });

  it("0, negativos, decimales y texto se rechazan sin escribir", async () => {
    for (const v of ["0", "-3", "1.5", "ocho"]) expect((await guardarUmbral("ch-1", v)).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("un Member no puede", async () => {
    h.rol = "member";
    expect((await guardarUmbral("ch-1", "4")).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("un canal de otro espacio no se toca", async () => {
    expect((await guardarUmbral("ch-ajeno", "4")).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("si no cambió, no escribe ni registra", async () => {
    expect((await guardarUmbral("ch-1", "8")).ok).toBe(true);
    expect(h.updates).toEqual([]);
    expect(h.auditoria).toEqual([]);
  });
});
