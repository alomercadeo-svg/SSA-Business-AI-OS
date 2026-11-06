import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F36, las acciones de Configuración › Respuestas rápidas: crear, editar y
 * eliminar, solo Owner y Admin, con el control en el servidor (la base lo
 * repite en sus políticas, 00052). Cada cambio queda en el historial como
 * «configuracion.cambiada» del espacio (F31).
 */
const h = vi.hoisted(() => ({
  rol: "owner",
  inserts: [] as Record<string, unknown>[],
  updates: [] as Array<{ valores: Record<string, unknown>; filtros: Record<string, unknown> }>,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  errorDeInsert: null as null | { code: string; message: string },
  rpcDevuelve: true as boolean,
  existente: { id: "r-1", workspace_id: "ws-1", nombre: "Saludo", atajo: "hola", contenido: "Hola!" } as Record<string, unknown> | null,
  auditoria: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({
    workspace: { id: "ws-1", name: "Alo" },
    user: { id: "u-1", email: "ale@ssa-test.local", user_metadata: {} },
    role: h.rol,
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => (h.rpcs.push({ fn, args }), { data: h.rpcDevuelve, error: null }),
      from: () => {
        const filtros: Record<string, unknown> = {};
        let valores: Record<string, unknown> | null = null;
        let insertado: Record<string, unknown> | null = null;
        const c: any = {
          select: () => c,
          eq: (k: string, v: unknown) => ((filtros[k] = v), c),
          is: (k: string, v: unknown) => ((filtros[k] = v), c),
          insert: (v: Record<string, unknown>) => ((insertado = v), c),
          update: (v: Record<string, unknown>) => ((valores = v), c),
          maybeSingle: async () => {
            if (insertado) {
              h.inserts.push(insertado);
              return h.errorDeInsert ? { data: null, error: h.errorDeInsert } : { data: { id: "r-nuevo" }, error: null };
            }
            if (valores) {
              h.updates.push({ valores, filtros: { ...filtros } });
              return { data: { id: filtros.id }, error: null };
            }
            return { data: h.existente && filtros.id === h.existente.id ? h.existente : null, error: null };
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

const { crearRespuestaRapida, editarRespuestaRapida, eliminarRespuestaRapida } = await import("./respuestas-rapidas");

beforeEach(() => {
  h.rol = "owner";
  h.inserts = [];
  h.updates = [];
  h.rpcs = [];
  h.auditoria = [];
  h.errorDeInsert = null;
  h.rpcDevuelve = true;
});

const NUEVA = { nombre: "Precios", atajo: "precios", contenido: "Hola {{contact.display_name}}, los precios son…" };

describe("las Respuestas rápidas, desde Configuración (F36)", () => {
  it("un Member no crea, no edita ni elimina, y no llega a la base", async () => {
    h.rol = "member";
    expect(await crearRespuestaRapida(NUEVA)).toEqual({ ok: false, error: "Solo Owner y Admin pueden cambiar las respuestas rápidas." });
    expect((await editarRespuestaRapida("r-1", NUEVA)).ok).toBe(false);
    expect((await eliminarRespuestaRapida("r-1")).ok).toBe(false);
    expect(h.inserts).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(h.rpcs).toEqual([]);
  });

  it("control positivo: un Owner crea, en su espacio, y queda en el historial", async () => {
    expect(await crearRespuestaRapida(NUEVA)).toEqual({ ok: true });
    expect(h.inserts).toEqual([{ workspace_id: "ws-1", nombre: "Precios", atajo: "precios", contenido: NUEVA.contenido, created_by: "u-1" }]);
    expect(h.auditoria).toHaveLength(1);
    expect(h.auditoria[0]).toMatchObject({ workspaceId: "ws-1", accion: "configuracion.cambiada", entidad: { tipo: "espacio", etiqueta: "Respuestas rápidas: creada «Precios» (/precios)" } });
  });

  it("lo inválido no llega a la base", async () => {
    expect((await crearRespuestaRapida({ ...NUEVA, atajo: "dos palabras" })).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });

  it("un atajo repetido lo dice en claro", async () => {
    h.errorDeInsert = { code: "23505", message: "duplicate key value violates unique constraint" };
    expect(await crearRespuestaRapida(NUEVA)).toEqual({ ok: false, error: "Ya hay una respuesta rápida con el atajo «/precios»." });
    expect(h.auditoria).toEqual([]);
  });

  it("editar: dentro del espacio, con el antes y el después en el historial", async () => {
    expect(await editarRespuestaRapida("r-1", NUEVA)).toEqual({ ok: true });
    expect(h.updates).toEqual([{ valores: { nombre: "Precios", atajo: "precios", contenido: NUEVA.contenido }, filtros: { id: "r-1", workspace_id: "ws-1" } }]);
    expect(h.auditoria[0]).toMatchObject({ accion: "configuracion.cambiada", cambios: { nombre: { antes: "Saludo", despues: "Precios" }, atajo: { antes: "hola", despues: "precios" } } });
  });

  it("eliminar: por la función de la base, que marca la fecha, y queda en el historial", async () => {
    expect(await eliminarRespuestaRapida("r-1")).toEqual({ ok: true });
    expect(h.rpcs).toEqual([{ fn: "eliminar_respuesta_rapida", args: { p_id: "r-1" } }]);
    expect(h.auditoria[0]).toMatchObject({ entidad: { tipo: "espacio", etiqueta: "Respuestas rápidas: eliminada «Saludo» (/hola)" } });
  });

  it("eliminar una que no está (o ya eliminada): lo dice y no deja historial", async () => {
    h.rpcDevuelve = false;
    expect(await eliminarRespuestaRapida("r-1")).toEqual({ ok: false, error: "No se encontró esa respuesta rápida." });
    expect(h.auditoria).toEqual([]);
  });
});
