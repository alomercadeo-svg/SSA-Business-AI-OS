import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El otro camino que crea contactos: un comentario que dispara una regla de
 * palabra clave (`lib/comment-processor.ts`). En la Etapa 1 no hay flujos
 * publicados, así que hoy no corre; si corre, el contacto nuevo tiene que
 * quedar en el historial igual que el del webhook (F31), con su identificador
 * crudo (F26).
 *
 * Zernio y el motor de flujos están simulados: este test no responde nada.
 */

vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: async () => {} }));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => null }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({}) }));

const { processComment } = await import("./comment-processor");

function baseFalsa() {
  const inserts: { tabla: string; valores: unknown }[] = [];
  const client = {
    from(tabla: string) {
      let op = "select";
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        or: () => b,
        order: async () => ({
          data:
            tabla === "triggers"
              ? [{ id: "t-1", flow_id: "f-1", config: { keywords: [{ value: "info" }] }, priority: 1 }]
              : [],
        }),
        insert: (v: unknown) => ((op = "insert"), inserts.push({ tabla, valores: v }), b),
        upsert: () => ((op = "upsert"), b),
        update: () => ((op = "update"), b),
        maybeSingle: async () => ({ data: null }),
        single: async () => ({ data: op === "insert" && tabla === "contacts" ? { id: "c-1" } : op === "upsert" ? { id: "conv-1" } : null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, inserts };
}

describe("contacto creado por un comentario", () => {
  it("queda en el historial con el Sistema como actor, y con su identificador crudo", async () => {
    const { client, inserts } = baseFalsa();
    const r = await processComment({
      supabase: client as never,
      channel: { id: "ch-1", workspace_id: "ws-1", platform: "instagram", late_account_id: "acc" } as never,
      comment: { id: "cm-1", postId: "p-1", text: "quiero info", author: { id: "ig-7", name: "Fiorella", username: "fio" } },
    });
    expect(r.matched).toBe(true);
    expect(inserts.find((i) => i.tabla === "contact_channels")?.valores).toMatchObject({ platform_sender_id: "ig-7", raw_jid: "ig-7" });
    expect((inserts.find((i) => i.tabla === "audit_log")?.valores as unknown[])[0]).toMatchObject({
      action: "contacto.creado",
      actor_label: "Sistema",
      entity_id: "c-1",
      entity_label: "Fiorella",
      detail: { origen: "comentario" },
    });
  });
});
