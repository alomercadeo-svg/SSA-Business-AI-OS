import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Activar un canal inactivo desde la pantalla de Canales (05/10/2026).
 *
 * Es la única escritura de `is_active` que queda en la interfaz, y solo en una
 * dirección: encender. Apagar un canal es una desconexión de hecho (los dos
 * receptores rechazan los mensajes de un canal inactivo), y la sincronización
 * con Zernio puede apagar uno sola, pero nada lo vuelve a encender. Se vio en
 * rojo antes de escribir la acción.
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  updates: [] as Record<string, unknown>[],
  filtros: [] as [string, unknown][],
  auditoria: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async (e: Record<string, unknown>) => {
    h.auditoria.push(e);
    return true;
  },
}));

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({
    workspace: { id: "ws-1" },
    user: { id: "u-1", email: "owner@ssa-test.local", user_metadata: { full_name: "Ale" } },
    role: h.rol,
    supabase: {
      from: () => {
        const c = {
          update: (v: Record<string, unknown>) => {
            h.updates.push(v);
            return c;
          },
          eq: (col: string, val: unknown) => {
            h.filtros.push([col, val]);
            return c;
          },
          select: () => c,
          then: (ok: (r: { data: { id: string }[]; error: null }) => unknown) =>
            Promise.resolve({ data: [{ id: "ch-1" }], error: null }).then(ok),
        };
        return c;
      },
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { activarCanal } = await import("./canales");

beforeEach(() => {
  h.rol = "owner";
  h.updates.length = 0;
  h.filtros.length = 0;
  h.auditoria.length = 0;
});

describe("activar un canal", () => {
  /** Control positivo: activar un canal inactivo sigue funcionando. */
  it("un manager lo activa, y solo dentro de su workspace", async () => {
    const r = await activarCanal("ch-1");
    expect(r.ok).toBe(true);
    expect(h.updates).toEqual([{ is_active: true }]);
    expect(h.filtros).toContainEqual(["id", "ch-1"]);
    expect(h.filtros).toContainEqual(["workspace_id", "ws-1"]);
  });

  it("queda en el historial como «canal conectado», con quien lo activó (F31)", async () => {
    await activarCanal("ch-1");
    expect(h.auditoria).toHaveLength(1);
    expect(h.auditoria[0]).toMatchObject({
      workspaceId: "ws-1",
      accion: "canal.conectado",
      actor: { id: "u-1", etiqueta: "Ale" },
      entidad: { tipo: "canal", id: "ch-1" },
    });
  });

  it("un Member que no puede activar tampoco deja rastro en el historial", async () => {
    h.rol = "member";
    await activarCanal("ch-1");
    expect(h.auditoria).toHaveLength(0);
  });

  it("nunca escribe is_active = false", async () => {
    await activarCanal("ch-1");
    expect(h.updates.some((u) => u.is_active === false)).toBe(false);
  });

  it("un Member no puede", async () => {
    h.rol = "member";
    const r = await activarCanal("ch-1");
    expect(r.ok).toBe(false);
    expect(h.updates).toEqual([]);
  });
});
