import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F38, criterios 14 y 15: un contacto sin ningún canal no se da de alta en una
 * secuencia, y uno con canal sí (control positivo). La base simulada. El otro
 * camino de alta, el nodo del motor de flujos, no se toca hoy.
 */
const h = vi.hoisted(() => ({
  contacto: null as null | { id: string; phone: string | null; email: string | null },
  identidades: [] as { id: string }[],
  inserts: [] as unknown[],
}));

function tabla(nombre: string) {
  const c: Record<string, unknown> = {};
  const resultado = () => {
    if (nombre === "sequences") return { data: { id: "seq-1", steps: [{ type: "message" }], status: "active" }, error: null };
    if (nombre === "contacts") return { data: h.contacto, error: null };
    if (nombre === "contact_channels") return { data: h.identidades, error: null };
    return { data: { id: "enr-1" }, error: null };
  };
  Object.assign(c, {
    select: () => c,
    eq: () => c,
    limit: () => c,
    insert: (v: unknown) => (h.inserts.push(v), c),
    single: async () => resultado(),
    maybeSingle: async () => resultado(),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok),
  });
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ workspace: { id: "ws-1" }, supabase: { from: tabla } }),
}));

const { enrollContact } = await import("./sequences");

beforeEach(() => {
  h.contacto = null;
  h.identidades = [];
  h.inserts.length = 0;
});

describe("enrollContact y el contacto sin canal (F38)", () => {
  it("sin teléfono, sin correo y sin ningún canal, no entra", async () => {
    h.contacto = { id: "c-1", phone: null, email: null };
    const r = await enrollContact("seq-1", "c-1", "ch-1");
    expect(r).toEqual({ error: "Este contacto no tiene teléfono, correo ni ningún canal: no se le puede escribir, así que no entra en una secuencia." });
    expect(h.inserts).toEqual([]);
  });

  it("con teléfono, entra (control positivo)", async () => {
    h.contacto = { id: "c-2", phone: "+50688881111", email: null };
    const r = await enrollContact("seq-1", "c-2", "ch-1");
    expect(r).toMatchObject({ ok: true });
    expect(h.inserts).toHaveLength(1);
  });

  it("sin teléfono ni correo pero con una identidad de canal (Instagram), entra", async () => {
    h.contacto = { id: "c-3", phone: null, email: null };
    h.identidades = [{ id: "cc-1" }];
    expect(await enrollContact("seq-1", "c-3", "ch-1")).toMatchObject({ ok: true });
  });

  it("un contacto de otro espacio (o inexistente) no entra", async () => {
    h.contacto = null;
    expect(await enrollContact("seq-1", "c-9", "ch-1")).toEqual({ error: "No encontramos ese contacto en este espacio." });
    expect(h.inserts).toEqual([]);
  });
});
