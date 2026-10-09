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
  antes: { name: "Viejo", global_keywords: ["stop"], zona_horaria: "America/Costa_Rica", horario_atencion: null as unknown },
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
const { HORARIO_POR_DEFECTO } = await import("@/lib/horas-habiles");

beforeEach(() => {
  h.rol = "owner";
  h.antes.horario_atencion = HORARIO_POR_DEFECTO;
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

  it("F39: guarda la zona y el horario, y registra el antes y el después", async () => {
    const todoElDia = Object.fromEntries(["lun", "mar", "mie", "jue", "vie", "sab", "dom"].map((d) => [d, [["00:00", "24:00"]]]));
    const r = await guardarGeneral({ nombre: "Viejo", palabrasClave: ["stop"], zonaHoraria: "America/New_York", horario: todoElDia });
    expect(r.ok).toBe(true);
    expect(h.updates).toEqual([{ name: "Viejo", global_keywords: ["stop"], zona_horaria: "America/New_York", horario_atencion: todoElDia }]);
    expect(eventos()).toMatchObject([
      {
        cambios: {
          zona_horaria: { antes: "America/Costa_Rica", despues: "America/New_York" },
          horario_atencion: { antes: HORARIO_POR_DEFECTO, despues: todoElDia },
        },
      },
    ]);
  });

  it("F39: una zona o un horario inválidos se rechazan en el servidor, sin escribir", async () => {
    expect((await guardarGeneral({ nombre: "Viejo", palabrasClave: [], zonaHoraria: "Marte/Olympus" })).ok).toBe(false);
    const alReves = { ...HORARIO_POR_DEFECTO, lun: [["18:00", "08:00"]] };
    expect((await guardarGeneral({ nombre: "Viejo", palabrasClave: [], horario: alReves })).ok).toBe(false);
    expect(h.updates).toEqual([]);
    expect(eventos()).toEqual([]);
  });
});
