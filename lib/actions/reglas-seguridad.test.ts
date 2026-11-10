import { describe, it, expect, vi, beforeEach } from "vitest";
import { REGLAS_POR_DEFECTO } from "@/lib/reglas-seguridad";

/** F33: la acción que guarda las reglas. La base simulada; contra la real, `scripts/verify-reglas-seguridad.mjs`. */
const h = vi.hoisted(() => ({
  rol: "owner",
  updates: [] as unknown[],
  auditoria: [] as unknown[],
  filaActualizada: true,
}));

const supabaseFalso = {
  from: () => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      update: (v: unknown) => (h.updates.push(v), c),
      maybeSingle: async () => ({ data: h.updates.length ? (h.filaActualizada ? { id: "ch-1" } : null) : { safety_config: REGLAS_POR_DEFECTO, display_name: "Ventas" }, error: null }),
    });
    return c;
  },
};

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/workspace", () => ({
  getWorkspaceOrNull: async () => ({ user: { id: "u-1", email: "a@x.com", user_metadata: {} }, workspace: { id: "ws-1" }, role: h.rol, supabase: supabaseFalso }),
  esManager: (r: string) => r === "owner" || r === "admin",
}));
vi.mock("@/lib/auditoria", () => ({ actorDe: () => ({ id: "u-1", etiqueta: "Ana" }), registrarAuditoria: async (e: unknown) => (h.auditoria.push(e), true) }));

const { guardarReglasDeSeguridad } = await import("./reglas-seguridad");

beforeEach(() => {
  h.rol = "owner";
  h.updates.length = 0;
  h.auditoria.length = 0;
  h.filaActualizada = true;
});

describe("guardarReglasDeSeguridad (F33)", () => {
  it("un Member no puede", async () => {
    h.rol = "member";
    expect(await guardarReglasDeSeguridad("ch-1", REGLAS_POR_DEFECTO)).toEqual({ ok: false, error: "Solo Owner y Admin pueden cambiar las reglas de seguridad." });
    expect(h.updates).toEqual([]);
  });

  it("una configuración inválida se rechaza en el servidor, sin guardar", async () => {
    const r = await guardarReglasDeSeguridad("ch-1", { ...REGLAS_POR_DEFECTO, corte_silencio: { activo: true, seguimientos: 0 } });
    expect(r).toEqual({ ok: false, error: "El corte con el silencio va de 1 a 10 seguimientos." });
    expect(h.updates).toEqual([]);
  });

  it("el Owner guarda y queda en el historial con antes y después", async () => {
    const nuevas = { ...REGLAS_POR_DEFECTO, corte_silencio: { activo: true, seguimientos: 4 } };
    expect(await guardarReglasDeSeguridad("ch-1", nuevas)).toEqual({ ok: true, reglas: nuevas });
    expect(h.updates).toEqual([{ safety_config: nuevas }]);
    expect(h.auditoria).toEqual([
      expect.objectContaining({
        accion: "configuracion.cambiada",
        entidad: { tipo: "canal", id: "ch-1", etiqueta: "Reglas de seguridad de WhatsApp: Ventas" },
        cambios: { safety_config: { antes: REGLAS_POR_DEFECTO, despues: nuevas } },
      }),
    ]);
  });

  it("si la política no deja pasar el cambio (cero filas), lo dice y no registra", async () => {
    h.filaActualizada = false;
    const r = await guardarReglasDeSeguridad("ch-1", REGLAS_POR_DEFECTO);
    expect(r.ok).toBe(false);
    expect(h.auditoria).toEqual([]);
  });
});
