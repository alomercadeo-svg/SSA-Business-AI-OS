import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * F30, decisión de Marcos del 19/10/2026: el lead eliminado que vuelve a
 * escribir se restaura solo. Acá, los caminos de Instagram con la base
 * simulada: el del webhook (`upsertContactForSender`, que también usa la
 * importación, que NO restaura) y el de los comentarios (`processComment`).
 * El de WhatsApp está en `lib/evolution-guardado.test.ts`. El mensaje de
 * Instagram se prueba además con un aviso firmado contra producción
 * (`scripts/verify-borrado.mjs`); el comentario, solo acá: crea o busca el
 * contacto únicamente si hay un disparador de comentarios configurado.
 *
 * Zernio y el motor de flujos están simulados: este test no llama a nadie.
 */

vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: async () => {} }));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => null }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({}) }));

const h = vi.hoisted(() => ({
  servicio: null as unknown,
  eliminados: new Set<string>(),
  rpcs: [] as Array<{ fn: string; args: unknown }>,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => h.servicio }));

const { restaurarSiEliminado, diasParaLaPurga } = await import("./borrado");
const { upsertContactForSender } = await import("./inbox-sync");
const { processComment } = await import("./comment-processor");

/** Una base con un contacto `ct-1` ya vinculado al remitente `ig-7` del canal. */
function baseFalsa() {
  const client = {
    from(tabla: string) {
      const filtros: Array<[string, unknown]> = [];
      const b: Record<string, unknown> = {};
      const fila = () => {
        if (tabla === "contact_channels") return { contact_id: "ct-1", platform_username: "fio" };
        if (tabla === "contacts") {
          const id = String(filtros.find(([c]) => c === "id")?.[1]);
          return { deleted_at: h.eliminados.has(id) ? "2026-10-10T00:00:00Z" : null };
        }
        return null;
      };
      Object.assign(b, {
        select: () => b,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
        or: () => b,
        order: async () => ({
          data:
            tabla === "triggers"
              ? [{ id: "t-1", flow_id: "f-1", config: { keywords: [{ value: "info" }] }, priority: 1 }]
              : [],
        }),
        insert: () => b,
        upsert: () => b,
        update: () => b,
        maybeSingle: async () => ({ data: fila(), error: null }),
        single: async () => ({ data: fila(), error: null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
    rpc: async (fn: string, args: unknown) => (h.rpcs.push({ fn, args }), { data: null, error: null }),
  };
  h.servicio = client;
  return client as unknown as SupabaseClient;
}

const restauraciones = () => h.rpcs.filter((r) => r.fn === "restaurar_contacto");
const CANAL = { id: "ch-ig", workspace_id: "ws-1", platform: "instagram" };
const remitente = { senderId: "ig-7", senderName: "Fiorella", senderPicture: null, senderUsername: "fio", interactionAt: "2026-10-20T12:00:00Z" };

beforeEach(() => {
  h.eliminados.clear();
  h.rpcs.length = 0;
});

describe("restaurarSiEliminado", () => {
  it("restaura un eliminado con la vía automática y el canal", async () => {
    h.eliminados.add("ct-1");
    expect(await restaurarSiEliminado(baseFalsa(), "ct-1", "ch-ig")).toBe(true);
    expect(restauraciones()).toEqual([
      { fn: "restaurar_contacto", args: { p_contacto: "ct-1", p_via: "mensaje_entrante", p_canal: "ch-ig" } },
    ]);
  });

  it("con un saliente del negocio, la vía es «mensaje_saliente»", async () => {
    h.eliminados.add("ct-1");
    expect(await restaurarSiEliminado(baseFalsa(), "ct-1", "ch-ig", "mensaje_saliente")).toBe(true);
    expect(restauraciones()).toEqual([
      { fn: "restaurar_contacto", args: { p_contacto: "ct-1", p_via: "mensaje_saliente", p_canal: "ch-ig" } },
    ]);
  });

  it("a uno vivo no lo toca (control)", async () => {
    expect(await restaurarSiEliminado(baseFalsa(), "ct-1", "ch-ig")).toBe(false);
    expect(h.rpcs).toEqual([]);
  });

  it("si otro aviso lo restauró un instante antes (P0002), no es un error: ya está restaurado", async () => {
    h.eliminados.add("ct-1");
    const base = baseFalsa() as unknown as { rpc: unknown };
    base.rpc = async () => ({ data: null, error: { code: "P0002", message: "restaurar_contacto: no hay un contacto eliminado con ese id" } });
    expect(await restaurarSiEliminado(base as never, "ct-1", "ch-ig")).toBe(false);
  });

  it("si la base rechaza la restauración, tira: el receptor libera el reclamo y responde 500", async () => {
    h.eliminados.add("ct-1");
    const base = baseFalsa() as unknown as { rpc: unknown };
    base.rpc = async () => ({ data: null, error: { message: "boom" } });
    await expect(restaurarSiEliminado(base as never, "ct-1", "ch-ig")).rejects.toThrow("restaurar_contacto: boom");
  });
});

describe("Instagram: el webhook restaura, la importación no", () => {
  it("el webhook (restaurarEliminado) restaura al lead eliminado y devuelve su mismo contacto", async () => {
    h.eliminados.add("ct-1");
    const r = await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente, restaurarEliminado: "mensaje_entrante" });
    expect(r).toEqual({ contactId: "ct-1", existed: true });
    expect(restauraciones()).toHaveLength(1);
  });

  it("el echo de lo que escribe el negocio desde la app también restaura, con la vía del saliente", async () => {
    h.eliminados.add("ct-1");
    await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente, restaurarEliminado: "mensaje_saliente" });
    expect(restauraciones()).toEqual([
      { fn: "restaurar_contacto", args: { p_contacto: "ct-1", p_via: "mensaje_saliente", p_canal: "ch-ig" } },
    ]);
  });

  it("la importación del historial (sin la marca) no restaura: no es el lead escribiendo ahora", async () => {
    h.eliminados.add("ct-1");
    await upsertContactForSender({ supabase: baseFalsa(), channel: CANAL, ...remitente });
    expect(restauraciones()).toEqual([]);
  });
});

describe("Instagram: un comentario del lead eliminado lo restaura", () => {
  it("con un disparador de comentarios configurado, el contacto que ya existía se restaura", async () => {
    h.eliminados.add("ct-1");
    const r = await processComment({
      supabase: baseFalsa() as never,
      channel: { id: "ch-ig", workspace_id: "ws-1", platform: "instagram", late_account_id: "acc" } as never,
      comment: { id: "cm-1", postId: "p-1", text: "quiero info", author: { id: "ig-7", name: "Fiorella", username: "fio" } },
    });
    expect(r.matched).toBe(true);
    expect(restauraciones()).toEqual([
      { fn: "restaurar_contacto", args: { p_contacto: "ct-1", p_via: "mensaje_entrante", p_canal: "ch-ig" } },
    ]);
  });
});

describe("diasParaLaPurga", () => {
  it("cuenta 30 días desde que se eliminó, y nunca menos de 0", () => {
    const ahora = new Date("2026-10-20T12:00:00Z");
    expect(diasParaLaPurga("2026-10-20T12:00:00Z", ahora)).toBe(30);
    expect(diasParaLaPurga("2026-10-01T12:00:00Z", ahora)).toBe(11);
    expect(diasParaLaPurga("2026-09-01T12:00:00Z", ahora)).toBe(0);
  });
});

describe("restaurar_contacto en la 00038 acepta las dos vías automáticas, solo del servidor", () => {
  it("«mensaje_entrante» y «mensaje_saliente» son vías válidas, y ninguna la llama un usuario", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../supabase/migrations/00038_borrado_suave.sql", import.meta.url), "utf8");
    const funcion = sql.slice(sql.indexOf("create or replace function public.restaurar_contacto"), sql.indexOf("-- ── 6."));
    expect(funcion).toMatch(/p_via not in \('manual', 'mensaje_entrante', 'mensaje_saliente'\)/);
    expect(funcion).toMatch(/p_via in \('mensaje_entrante', 'mensaje_saliente'\) and not v_servidor/);
  });
});

describe("la 00038: eliminar marca la fecha, no borra, también para Owner y Admin", () => {
  it("saca las políticas de DELETE de contacts y conversations de la 00019, y no crea otras", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../supabase/migrations/00038_borrado_suave.sql", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/drop policy if exists "contacts: borrar solo manager" on contacts;/);
    expect(sql).toMatch(/drop policy if exists "conversations: borrar solo manager" on conversations;/);
    expect(sql).not.toMatch(/create policy[^;]*for delete/i);
  });
});

describe("la 00038 cierra dos huecos más (revisión del 20/10/2026)", () => {
  const sql = async () => {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL("../supabase/migrations/00038_borrado_suave.sql", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
  };
  it("nadie crea un contacto ni una conversación ya eliminados: las políticas de alta exigen deleted_at vacío", async () => {
    const s = await sql();
    expect(s).toMatch(/create policy "contacts: crear, un Member solo asignado a si mismo"[\s\S]*?with check \(\s*deleted_at is null\s+and/);
    expect(s).toMatch(/create policy "conversations: crear solo manager"[\s\S]*?with check \(deleted_at is null and/);
  });
  it("la fecha de edición de una nota la pone siempre el trigger, no el cliente", async () => {
    const s = await sql();
    expect(s).toMatch(/create or replace function public\.contact_notes_antes\(\)/);
    expect(s).toMatch(/new\.updated_at := case when new\.body is distinct from old\.body then now\(\) else old\.updated_at end;/);
  });
});
