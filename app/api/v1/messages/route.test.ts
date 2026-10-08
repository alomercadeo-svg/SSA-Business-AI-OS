import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * `POST /api/v1/messages`, el envío desde la bandeja (F27). Zernio y la base
 * simulados. Hasta el 08/10/2026 el envío no se guardaba: la bandeja leía de
 * Zernio. Con la base como fuente de verdad, lo que no se guarda no se ve.
 *
 * La no duplicación con el echo la garantiza la restricción
 * `messages_mensaje_unico` en la base (probada contra Postgres el 08/10/2026);
 * acá se comprueba que el envío use exactamente esa clave y el mismo
 * `remote_jid` que escribe el echo.
 */

const h = vi.hoisted(() => ({
  upserts: [] as Array<{ tabla: string; valores: Record<string, unknown>; opciones: Record<string, unknown> }>,
  sendInboxMessage: vi.fn(),
}));

function supabaseFalso() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        update: () => cadena,
        maybeSingle: async () =>
          tabla === "conversations"
            ? {
                data: {
                  id: "conv-1",
                  workspace_id: "ws-1",
                  channel_id: "ch-1",
                  contact_id: "ct-1",
                  late_conversation_id: "zc-1",
                  channels: { late_account_id: "acc-1" },
                },
              }
            : { data: { platform_sender_id: "lead-ig-1" } },
        upsert: (valores: Record<string, unknown>, opciones: Record<string, unknown>) => {
          h.upserts.push({ tabla, valores, opciones });
          return { select: () => ({ single: async () => ({ data: { id: "msg-local-1" }, error: null }) }) };
        },
        then: (ok: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      return cadena;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseFalso(),
  createServiceClient: async () => supabaseFalso(),
}));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => "zk" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { sendInboxMessage: h.sendInboxMessage } }),
}));
vi.mock("@/lib/integraciones-estado", () => ({ registrarFalloDeZernio: vi.fn() }));

const { POST } = await import("./route");

const pedido = (cuerpo: unknown) =>
  new Request("http://localhost/api/v1/messages", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

beforeEach(() => {
  h.upserts.length = 0;
  h.sendInboxMessage.mockReset();
  h.sendInboxMessage.mockResolvedValue({ data: { data: { messageId: "pmid-enviado" } } });
});

describe("POST /api/v1/messages guarda lo enviado (F27)", () => {
  it("guarda el saliente con el id del proveedor, el autor y la clave de unicidad", async () => {
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(201);
    expect(h.upserts).toEqual([
      {
        tabla: "messages",
        valores: expect.objectContaining({
          conversation_id: "conv-1",
          direction: "outbound",
          platform_message_id: "pmid-enviado",
          sent_by_user_id: "u-1",
          remote_jid: "lead-ig-1",
          text: "hola",
        }),
        opciones: { onConflict: "conversation_id,platform_message_id,direction" },
      },
    ]);
    await expect(res.json()).resolves.toMatchObject({ id: "msg-local-1", platform_message_id: "pmid-enviado" });
  });

  it("si Zernio rechaza el envío, no guarda nada", async () => {
    h.sendInboxMessage.mockRejectedValue(new Error("403"));
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(500);
    expect(h.upserts).toEqual([]);
  });
});
