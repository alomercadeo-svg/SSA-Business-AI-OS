import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * F29 con la base simulada: el remitente nuevo de Instagram cuyo usuario
 * coincide con el de otro canal deja una sugerencia (nunca se une solo), la
 * importación no busca, y una sugerencia no se repite. La búsqueda misma
 * (`buscar_contacto_entre_canales`) y la vinculación por teléfono contra el
 * receptor de producción los prueba `scripts/verify-entre-canales.mjs`.
 */

const h = vi.hoisted(() => ({
  servicio: null as unknown,
  hallazgo: null as null | Record<string, string>,
  existentes: [] as unknown[],
  inserts: [] as Array<{ tabla: string; valores: any }>,
  rpcs: [] as Array<{ fn: string; args: any }>,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => h.servicio }));

const { upsertContactForSender } = await import("./inbox-sync");
const { sugerirUnion } = await import("./entre-canales");

function baseFalsa() {
  const client = {
    from(tabla: string) {
      let op = "select";
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        or: () => b,
        limit: async () => ({ data: tabla === "sugerencias_union" ? h.existentes : [], error: null }),
        insert: (v: unknown) => ((op = "insert"), h.inserts.push({ tabla, valores: v }), b),
        update: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        // contact_channels sin fila: el remitente es nuevo en este canal.
        single: async () => ({ data: op === "insert" && tabla === "contacts" ? { id: "ct-nuevo" } : null, error: null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
    rpc: async (fn: string, args: unknown) => (h.rpcs.push({ fn, args }), { data: fn === "buscar_contacto_entre_canales" ? h.hallazgo : null, error: null }),
  };
  h.servicio = client;
  return client as unknown as SupabaseClient;
}

const CANAL = { id: "ch-ig-2", workspace_id: "ws-1", platform: "instagram" };
const remitente = { senderId: "ig-9", senderName: "Caro", senderPicture: null, senderUsername: "caro.urena", interactionAt: "2026-10-20T12:00:00Z" };
const sugerencias = () => h.inserts.filter((i) => i.tabla === "sugerencias_union").map((i) => i.valores);

beforeEach(() => {
  h.hallazgo = null;
  h.existentes = [];
  h.inserts.length = 0;
  h.rpcs.length = 0;
});

describe("F29 en Instagram: el usuario sugiere, no une", () => {
  it("un remitente nuevo cuyo usuario es de un contacto de otro canal: contacto nuevo y la sugerencia «usuario»", async () => {
    h.hallazgo = { tipo: "sugerencia", por: "usuario", contact_id: "ct-viejo" };
    const r = await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente, buscarEnOtrosCanales: true });
    expect(r).toEqual({ contactId: "ct-nuevo", existed: false });
    expect(h.rpcs).toContainEqual({
      fn: "buscar_contacto_entre_canales",
      args: expect.objectContaining({ p_workspace: "ws-1", p_usuario: "caro.urena", p_canal: "ch-ig-2", p_excluir: "ct-nuevo" }),
    });
    expect(sugerencias()).toEqual([expect.objectContaining({ contacto_id: "ct-nuevo", otro_id: "ct-viejo", motivo: "usuario" })]);
  });

  it("sin coincidencia, no hay sugerencia (control)", async () => {
    await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente, buscarEnOtrosCanales: true });
    expect(h.rpcs.some((x) => x.fn === "buscar_contacto_entre_canales")).toBe(true);
    expect(sugerencias()).toEqual([]);
  });

  it("la importación del historial no busca", async () => {
    h.hallazgo = { tipo: "sugerencia", por: "usuario", contact_id: "ct-viejo" };
    await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente });
    expect(h.rpcs).toEqual([]);
    expect(sugerencias()).toEqual([]);
  });
});

describe("sugerirUnion", () => {
  it("si el par ya existe (en cualquier orden, también descartado), no se repite: «No es la misma» no vuelve", async () => {
    h.existentes = [{ id: "s-1" }];
    expect(await sugerirUnion(baseFalsa(), { workspaceId: "ws-1", contactoId: "a", otroId: "b", motivo: "usuario" })).toBe(false);
    expect(sugerencias()).toEqual([]);
  });

  it("un contacto consigo mismo no se sugiere", async () => {
    expect(await sugerirUnion(baseFalsa(), { workspaceId: "ws-1", contactoId: "a", otroId: "a", motivo: "usuario" })).toBe(false);
  });
});

describe("la búsqueda y la sugerencia nunca tiran (revisión del 20/10/2026)", () => {
  it("si la búsqueda falla, se registra y sigue: el contacto ya creado no queda a medias", async () => {
    const { buscarEntreCanales } = await import("./entre-canales");
    const base = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as SupabaseClient;
    await expect(buscarEntreCanales(base, { workspaceId: "ws-1", telefono: "+50670001111" })).resolves.toBeNull();
  });

  it("si la sugerencia no se puede escribir, se registra y sigue", async () => {
    const base = {
      from: () => {
        const b: any = { select: () => b, or: () => b, limit: async () => ({ data: [], error: null }), insert: async () => ({ error: { code: "XX000", message: "boom" } }) };
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(sugerirUnion(base, { workspaceId: "ws-1", contactoId: "a", otroId: "b", motivo: "usuario" })).resolves.toBe(false);
  });
});


describe("la 00039 (revisión y respuestas de Marcos del 20/10/2026)", () => {
  const sql = async () => {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL("../supabase/migrations/00039_contacto_entre_canales.sql", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
  };
  it("un par se sugiere una sola vez, en cualquier orden: índice único sobre el par sin orden", async () => {
    expect(await sql()).toMatch(/create unique index if not exists sugerencias_union_par_sin_orden\s+on sugerencias_union \(least\(contacto_id, otro_id\), greatest\(contacto_id, otro_id\)\)/);
  });
  it("busca el teléfono también en whatsapp_phone y el correo también en el secundario", async () => {
    const s = await sql();
    expect(s).toMatch(/phone = p_telefono or whatsapp_phone = p_telefono/);
    expect(s).toMatch(/lower\(email\) = lower\(btrim\(p_correo\)\) or lower\(secondary_email\) = lower\(btrim\(p_correo\)\)/);
  });
  it("si no hay un vivo, busca un eliminado (los purgados ya no existen) y lo marca", async () => {
    expect(await sql()).toMatch(/'eliminado', true/);
  });
});
