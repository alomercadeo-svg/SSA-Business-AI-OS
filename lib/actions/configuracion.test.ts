import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El guardado de la pestaña General, que pasó del navegador a una acción de
 * servidor el 07/10/2026 para quedar en el historial de cambios (F31).
 *
 * Lo que tiene que seguir haciendo igual que antes: guardar el nombre y las
 * palabras clave, y las claves en Vault solo si se escribieron. Lo nuevo: el
 * evento con el antes y el después, y para las claves, solo que se guardaron.
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  antes: { name: "Viejo", global_keywords: ["stop"] },
  updates: [] as Record<string, unknown>[],
  secretos: [] as [string, string][],
  auditoria: [] as Record<string, unknown>[][],
}));

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({
    workspace: { id: "ws-1" },
    user: { id: "u-1", email: "ale@ssa-test.local", user_metadata: {} },
    role: h.rol,
    supabase: {
      from: () => {
        const c = {
          select: () => c,
          eq: () => c,
          update: (v: Record<string, unknown>) => {
            h.updates.push(v);
            return c;
          },
          single: async () => ({ data: h.antes, error: null }),
        };
        return c;
      },
    },
  }),
}));
vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  setWorkspaceSecret: async (_s: unknown, _w: string, nombre: string, valor: string) => {
    h.secretos.push([nombre, valor]);
    return { error: null };
  },
}));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async (e: Record<string, unknown> | Record<string, unknown>[]) => {
    h.auditoria.push(Array.isArray(e) ? e : [e]);
    return true;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { guardarGeneral } = await import("./configuracion");

beforeEach(() => {
  h.rol = "owner";
  h.updates.length = 0;
  h.secretos.length = 0;
  h.auditoria.length = 0;
});

const eventos = () => h.auditoria.flat();

describe("guardar la pestaña General", () => {
  it("guarda el nombre y las palabras, y registra el antes y el después", async () => {
    const r = await guardarGeneral({ nombre: " Nuevo ", palabrasClave: ["stop", "baja"] });
    expect(r.ok).toBe(true);
    expect(h.updates).toEqual([{ name: "Nuevo", global_keywords: ["stop", "baja"] }]);
    expect(eventos()).toMatchObject([
      {
        accion: "configuracion.cambiada",
        actor: { id: "u-1" },
        cambios: {
          name: { antes: "Viejo", despues: "Nuevo" },
          global_keywords: { antes: ["stop"], despues: ["stop", "baja"] },
        },
      },
    ]);
  });

  it("si no cambió nada, no registra nada", async () => {
    await guardarGeneral({ nombre: "Viejo", palabrasClave: ["stop"] });
    expect(eventos()).toHaveLength(0);
  });

  it("una clave escrita va a Vault y en el historial queda solo que se guardó", async () => {
    const clave = "zk_" + "q".repeat(30);
    await guardarGeneral({ nombre: "Viejo", palabrasClave: ["stop"], claveZernio: clave, claveIa: "  " });
    expect(h.secretos).toEqual([["zernio_api_key", clave]]);
    expect(eventos()).toMatchObject([{ entidad: { etiqueta: "General: clave de Zernio guardada" } }]);
    expect(JSON.stringify(h.auditoria)).not.toContain(clave);
  });

  it("un Member no puede, y no deja rastro", async () => {
    h.rol = "member";
    const r = await guardarGeneral({ nombre: "Otro", palabrasClave: [] });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
  });

  it("un nombre vacío se rechaza sin escribir", async () => {
    const r = await guardarGeneral({ nombre: "  ", palabrasClave: [] });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });
});
