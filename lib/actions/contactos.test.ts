import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Las acciones de la ficha para F26: cargar el teléfono a mano (tercera vía de
 * reconciliación) y confirmar la fusión. La base está simulada; lo que la base
 * decide (permisos, el conflicto, el historial) lo prueba
 * `scripts/verify-identidad-canal.mjs` contra la base real.
 *
 * Lo que cuida este test es lo que decide la acción: normalizar antes de llamar
 * a la base, no mandar datos de un contacto ajeno, y no dejar fusionar a un
 * Member ni llamar a la base para intentarlo.
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  respuesta: { data: { resultado: "resuelto" } as unknown, error: null as null | { code: string; message: string } },
}));

function supabaseFalso() {
  const fila = { id: "x", display_name: "Lucía", phone: "+50670349182", email: null, created_at: "2026-10-01" };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return h.respuesta;
    },
    from: () => {
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: async () => ({ data: fila }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], count: 2 }).then(ok),
      };
      return c;
    },
  };
}

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({ workspace: { id: "ws-1" }, user: { id: "u-1" }, role: h.rol, supabase: supabaseFalso() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { cargarTelefono, fusionarContactos } = await import("./contactos");

beforeEach(() => {
  h.rol = "owner";
  h.rpcs.length = 0;
  h.respuesta = { data: { resultado: "resuelto" }, error: null };
});

describe("cargar el teléfono a mano", () => {
  it("normaliza a E.164 antes de llamar a la base, por la vía manual", async () => {
    const r = await cargarTelefono("c-1", "+506 7034-9182");
    expect(r).toEqual({ ok: true, resultado: "resuelto" });
    expect(h.rpcs).toEqual([{ fn: "reconciliar_telefono", args: { p_contacto: "c-1", p_telefono: "+50670349182", p_via: "manual" } }]);
  });

  it("un número que no se puede normalizar no llega a la base, y se explica", async () => {
    const r = await cargarTelefono("c-1", "7034 9182");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/código de país/);
    expect(h.rpcs).toHaveLength(0);
  });

  it("con un conflicto contra un contacto ajeno, no devuelve ningún dato del otro", async () => {
    h.rol = "member";
    h.respuesta = { data: { resultado: "conflicto", visible: false, otro_id: null }, error: null };
    const r = await cargarTelefono("c-1", "+50670349182");
    expect(r).toEqual({ ok: true, resultado: "conflicto", visible: false, puedeUnir: false, telefono: "+50670349182" });
  });

  it("con un conflicto visible, devuelve los dos lados; solo un manager puede unir", async () => {
    h.respuesta = { data: { resultado: "conflicto", visible: true, otro_id: "c-2" }, error: null };
    const owner = await cargarTelefono("c-1", "+50670349182");
    expect(owner).toMatchObject({ resultado: "conflicto", visible: true, puedeUnir: true, este: { nombre: "Lucía" }, otro: { nombre: "Lucía" } });
    h.rol = "member";
    const member = await cargarTelefono("c-1", "+50670349182");
    expect(member).toMatchObject({ resultado: "conflicto", visible: true, puedeUnir: false });
  });

  it("si la base dice que no tiene acceso, el mensaje es claro, no un error de permisos", async () => {
    h.respuesta = { data: null, error: { code: "42501", message: "permission denied" } };
    const r = await cargarTelefono("c-1", "+50670349182");
    expect(!r.ok && r.error).toMatch(/ya no está a tu cargo/);
  });
});

describe("fusionar", () => {
  it("un Member no puede, y ni siquiera se llama a la base", async () => {
    h.rol = "member";
    const r = await fusionarContactos("c-2", "c-1");
    expect(r.ok).toBe(false);
    expect(h.rpcs).toHaveLength(0);
  });

  it("un Owner fusiona: queda el que ya tenía el teléfono", async () => {
    h.respuesta = { data: { resultado: "fusionado" }, error: null };
    const r = await fusionarContactos("c-2", "c-1");
    expect(r).toEqual({ ok: true, conservado: "c-2" });
    expect(h.rpcs).toEqual([{ fn: "fusionar_contactos", args: { p_conservar: "c-2", p_absorber: "c-1" } }]);
  });
});
