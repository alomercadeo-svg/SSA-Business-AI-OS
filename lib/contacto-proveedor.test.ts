import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { backfillInboxConversations, handleDelProveedor, upsertContactForSender } from "./inbox-sync";

/**
 * Desde el 08/10/2026, `registrarAuditoria` escribe siempre con el cliente de
 * servicio que crea ella. Acá ese cliente es la misma base falsa del test, que
 * así sigue viendo la fila de `audit_log`.
 */
const servicio = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => servicio.cliente }));

/**
 * Lo que el proveedor escribe en un contacto, y lo que no puede escribir.
 *
 * F25, criterios del nombre y el handle (22/09/2026):
 *   - el handle sale de lo que trae el proveedor, se reemplaza si cambió, y si
 *     no lo trae no se deduce de otro campo;
 *   - un nombre ya guardado no lo pisa ningún camino automático.
 * F26: nunca se deduplica por nombre.
 * F31: un contacto nuevo queda en el historial, con el Sistema como actor.
 *
 * Interpretación anotada en el Estado de F25: si el aviso no trae el handle y la
 * fila ya tenía uno, no se borra. Que no venga no prueba que cambió.
 */

interface Op {
  tabla: string;
  op: "select" | "insert" | "update" | "upsert";
  valores?: Record<string, unknown>;
  filtros: Record<string, unknown>;
}

function baseFalsa(seed: { canalPorRemitente?: Record<string, { contact_id: string; platform_username: string | null }>; conversacionesConocidas?: string[] } = {}) {
  const ops: Op[] = [];
  let n = 0;
  const client = {
    from(tabla: string) {
      const o: Op = { tabla, op: "select", filtros: {} };
      ops.push(o);
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => ((o.filtros[c] = v), b),
        insert: (v: Record<string, unknown>) => ((o.op = "insert"), (o.valores = v), b),
        update: (v: Record<string, unknown>) => ((o.op = "update"), (o.valores = v), b),
        upsert: (v: Record<string, unknown>) => ((o.op = "upsert"), (o.valores = v), b),
        single: async () => {
          if (o.op === "insert" && tabla === "contacts") return { data: { id: `contacto-${++n}` }, error: null };
          if (tabla === "contact_channels") {
            const fila = seed.canalPorRemitente?.[o.filtros.platform_sender_id as string];
            return { data: fila ?? null, error: fila ? null : { code: "PGRST116" } };
          }
          return { data: null, error: null };
        },
        then: (ok: (r: unknown) => unknown) => {
          const data =
            tabla === "conversations" && o.op === "select"
              ? (seed.conversacionesConocidas ?? []).map((id) => ({ late_conversation_id: id }))
              : o.op === "upsert"
                ? [{ id: "conv-1" }]
                : [];
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return b;
    },
  };
  servicio.cliente = client;
  return { client: client as unknown as SupabaseClient, ops };
}

const canal = { id: "ch-1", workspace_id: "ws-1", platform: "instagram" };
const base = { channel: canal, senderPicture: null, interactionAt: "2026-10-07T12:00:00Z" };

describe("un contacto nuevo", () => {
  it("guarda el handle que trajo el proveedor, el identificador crudo, y queda en el historial", async () => {
    const { client, ops } = baseFalsa();
    const r = await upsertContactForSender({ ...base, supabase: client, senderId: "ig-1", senderName: "Valeria Monge", senderUsername: "@valeria.m" });
    expect(r).toEqual({ contactId: "contacto-1", existed: false });
    expect(ops.find((o) => o.tabla === "contact_channels" && o.op === "insert")?.valores).toMatchObject({
      platform_sender_id: "ig-1",
      platform_username: "valeria.m",
      raw_jid: "ig-1",
    });
    // registrarAuditoria inserta una lista de filas.
    expect((ops.find((o) => o.tabla === "audit_log")?.valores as unknown as unknown[])[0]).toMatchObject({
      action: "contacto.creado",
      actor_id: null,
      actor_label: "Sistema",
      entity_id: "contacto-1",
      entity_label: "Valeria Monge",
      detail: { plataforma: "instagram" },
    });
  });

  it("sin handle del proveedor, queda nulo aunque el nombre tenga pinta de handle", async () => {
    const { client, ops } = baseFalsa();
    await upsertContactForSender({ ...base, supabase: client, senderId: "ig-2", senderName: "valeria_m", senderUsername: null });
    expect(ops.find((o) => o.tabla === "contact_channels" && o.op === "insert")?.valores?.platform_username).toBeNull();
  });

  it("nunca deduplica por nombre: el mismo nombre con otro remitente es otro contacto", async () => {
    const { client, ops } = baseFalsa({ canalPorRemitente: { "ig-1": { contact_id: "c-existente", platform_username: null } } });
    const r = await upsertContactForSender({ ...base, supabase: client, senderId: "ig-otro", senderName: "Valeria Monge" });
    expect(r?.existed).toBe(false);
    // La única búsqueda es por canal y remitente. Ninguna por nombre.
    const busquedas = ops.filter((o) => o.op === "select" && o.tabla !== "conversations");
    expect(busquedas.map((o) => Object.keys(o.filtros).sort())).toEqual([["channel_id", "platform_sender_id"]]);
    expect(ops.some((o) => "display_name" in o.filtros)).toBe(false);
  });
});

describe("un contacto que ya existía", () => {
  const conocido = { "ig-1": { contact_id: "c-1", platform_username: "viejo" } };

  it("si el proveedor trae otro handle, se reemplaza", async () => {
    const { client, ops } = baseFalsa({ canalPorRemitente: conocido });
    await upsertContactForSender({ ...base, supabase: client, senderId: "ig-1", senderName: "X", senderUsername: "nuevo" });
    expect(ops.find((o) => o.tabla === "contact_channels" && o.op === "update")).toMatchObject({
      valores: { platform_username: "nuevo" },
      filtros: { channel_id: "ch-1", platform_sender_id: "ig-1" },
    });
  });

  it("si no trae handle, no se borra el que había", async () => {
    const { client, ops } = baseFalsa({ canalPorRemitente: conocido });
    await upsertContactForSender({ ...base, supabase: client, senderId: "ig-1", senderName: "X", senderUsername: null });
    expect(ops.some((o) => o.tabla === "contact_channels" && o.op === "update")).toBe(false);
  });

  it("su nombre no lo toca: ni el de origen manual ni ningún otro", async () => {
    const { client, ops } = baseFalsa({ canalPorRemitente: conocido });
    await upsertContactForSender({ ...base, supabase: client, senderId: "ig-1", senderName: "Nombre Distinto", senderUsername: "nuevo" });
    const escriturasDeContacto = ops.filter((o) => o.tabla === "contacts" && (o.op === "update" || o.op === "insert"));
    expect(escriturasDeContacto.every((o) => !("display_name" in (o.valores ?? {})))).toBe(true);
    expect(ops.some((o) => o.tabla === "audit_log")).toBe(false);
  });
});

describe("la importación de Zernio", () => {
  const zernio = (data: Record<string, unknown>[]) =>
    ({ messages: { listInboxConversations: async () => ({ data: { data, pagination: { hasMore: false } } }) } }) as unknown as Zernio;

  it("lee participantUsername y lo guarda como handle del contacto nuevo", async () => {
    const { client, ops } = baseFalsa();
    await backfillInboxConversations({
      supabase: client,
      zernio: zernio([{ id: "z1", participantId: "ig-9", participantName: "Lucía", participantUsername: "lucia.flor" }]),
      workspaceId: "ws-1",
      channels: [{ id: "ch-1", late_account_id: "acc", platform: "instagram" }],
    });
    expect(ops.find((o) => o.tabla === "contact_channels" && o.op === "insert")?.valores?.platform_username).toBe("lucia.flor");
  });

  it("en una conversación ya importada, refresca el handle sin tocar nada más", async () => {
    const { client, ops } = baseFalsa({ conversacionesConocidas: ["z1"] });
    await backfillInboxConversations({
      supabase: client,
      zernio: zernio([{ id: "z1", participantId: "ig-9", participantName: "Lucía", participantUsername: "lucia.flor" }]),
      workspaceId: "ws-1",
      channels: [{ id: "ch-1", late_account_id: "acc", platform: "instagram" }],
    });
    expect(ops.filter((o) => o.op !== "select").map((o) => [o.tabla, o.op, o.valores])).toEqual([
      ["contact_channels", "update", { platform_username: "lucia.flor" }],
    ]);
  });
});

describe("handleDelProveedor", () => {
  it("saca la arroba y trata el vacío como ausencia", () => {
    expect(handleDelProveedor("@ale")).toBe("ale");
    expect(handleDelProveedor("  ")).toBeNull();
    expect(handleDelProveedor(undefined)).toBeNull();
  });
});
