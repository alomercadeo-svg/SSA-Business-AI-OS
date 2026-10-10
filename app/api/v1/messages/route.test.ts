import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest as NextRequestReal, type NextRequest } from "next/server";

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
  filasDeMensajes: [] as Record<string, unknown>[],
  historialEstado: "completo",
  canalActivo: true,
  limite: 0,
  upserts: [] as Array<{ tabla: string; valores: Record<string, unknown>; opciones: Record<string, unknown> }>,
  sendInboxMessage: vi.fn(),
  /** F28: la RLS no devuelve la conversación (un Member sin ese lead). */
  fueraDeAlcance: false,
  firmas: [] as Array<{ bucket: string; rutas: string[]; segundos: number }>,
}));

function supabaseFalso(rol: "usuario" | "servicio" = "usuario") {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (rutas: string[], segundos: number) => {
          if (rol !== "servicio") throw new Error("firma con el cliente del usuario");
          h.firmas.push({ bucket, rutas, segundos });
          return { data: rutas.map((r) => ({ path: r, signedUrl: `https://storage.ejemplo.invalid/firmada/${r}?token=t`, error: null })), error: null };
        },
      }),
    },
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        update: () => cadena,
        order: () => cadena,
        limit: (n: number) => {
          h.limite = n;
          return Promise.resolve({ data: h.filasDeMensajes.slice(0, n), error: null });
        },
        maybeSingle: async () =>
          tabla === "conversations" && rol === "usuario" && h.fueraDeAlcance
            ? { data: null }
            : tabla === "conversations"
            ? {
                data: {
                  id: "conv-1",
                  workspace_id: "ws-1",
                  channel_id: "ch-1",
                  contact_id: "ct-1",
                  late_conversation_id: "zc-1",
                  channels: { late_account_id: "acc-1", is_active: h.canalActivo },
                  historial_estado: h.historialEstado,
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
  createClient: async () => supabaseFalso("usuario"),
  createServiceClient: async () => supabaseFalso("servicio"),
}));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => "zk" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { sendInboxMessage: h.sendInboxMessage } }),
}));
vi.mock("@/lib/integraciones-estado", () => ({ registrarFalloDeZernio: vi.fn() }));

const { GET, POST, MENSAJES_POR_HILO } = await import("./route");

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

/**
 * F27: la bandeja lee de la base. Escritos en rojo contra la ruta que le pedía
 * los mensajes a Zernio.
 */
describe("GET /api/v1/messages lee de la base (F27)", () => {
  const leer = () => GET(new NextRequestReal("http://localhost/api/v1/messages?conversationId=conv-1"));
  const fila = (id: string, extra: Record<string, unknown> = {}) => ({
    id, conversation_id: "conv-1", direction: "inbound", text: id, attachments: null, created_at: `2026-10-0${id.length}T10:00:00Z`, ...extra,
  });

  beforeEach(() => {
    h.filasDeMensajes = [];
    h.historialEstado = "completo";
    h.canalActivo = true;
    h.fueraDeAlcance = false;
    h.firmas.length = 0;
  });

  it("devuelve los mensajes de la base en orden cronológico, sin llamar a Zernio", async () => {
    h.filasDeMensajes = [fila("m2"), fila("m1")]; // la base los da del más nuevo al más viejo
    const res = await leer();
    const cuerpo = await res.json();
    expect(cuerpo.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]);
    expect(cuerpo.hayAnteriores).toBe(false);
    expect(h.sendInboxMessage).not.toHaveBeenCalled();
  });

  it("los adjuntos viajan sin la dirección del proveedor", async () => {
    h.filasDeMensajes = [fila("m1", { attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/secreto", refreshUrl: "x" }], media_status: "pendiente" })];
    const cuerpo = await (await leer()).json();
    expect(cuerpo.messages[0].attachments).toEqual([{ type: "image" }]);
    expect(JSON.stringify(cuerpo)).not.toContain("lookaside");
  });

  it("dice cuando hay más mensajes que los que trae", async () => {
    h.filasDeMensajes = Array.from({ length: MENSAJES_POR_HILO + 1 }, (_, i) => fila(`m${i}`));
    const cuerpo = await (await leer()).json();
    expect(h.limite).toBe(MENSAJES_POR_HILO + 1);
    expect(cuerpo.messages).toHaveLength(MENSAJES_POR_HILO);
    expect(cuerpo.hayAnteriores).toBe(true);
  });

  it("devuelve el estado del historial: una cuenta desconectada sin importar no se ve como un hilo vacío", async () => {
    h.historialEstado = "pendiente";
    h.canalActivo = false;
    const cuerpo = await (await leer()).json();
    expect(cuerpo.historial).toEqual({ estado: "pendiente", canalActivo: false });
  });
});

/**
 * F28, 5f: la dirección firmada. La ruta lee con el cliente del usuario (la RLS
 * aplica el alcance de leads) y firma con el de servicio SOLO las filas que
 * volvieron y están `descargado`. `media_path` no viaja al navegador.
 */
describe("GET /api/v1/messages: las direcciones firmadas de los adjuntos (F28)", () => {
  const leer = () => GET(new NextRequestReal("http://localhost/api/v1/messages?conversationId=conv-1"));
  const RUTA = "ws-1/conv-1/m1/archivo.jpg";
  const descargado = (id: string, ruta: string, extra: Record<string, unknown> = {}) => ({
    id, conversation_id: "conv-1", direction: "inbound", text: null, created_at: "2026-10-09T10:00:00Z",
    attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/secreto" }],
    message_type: "imagen", media_status: "descargado", media_path: ruta, media_mime: "image/jpeg", ...extra,
  });

  beforeEach(() => {
    h.filasDeMensajes = [];
    h.historialEstado = "completo";
    h.canalActivo = true;
    h.fueraDeAlcance = false;
    h.firmas.length = 0;
  });

  it("un Member sin ese lead no recibe ninguna dirección, y no se firma nada", async () => {
    h.fueraDeAlcance = true;
    h.filasDeMensajes = [descargado("m1", RUTA)];
    const res = await leer();
    expect(res.status).toBe(403);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain("firmada");
    expect(texto).not.toContain(RUTA);
    expect(h.firmas).toHaveLength(0);
  });

  it("un Owner recibe la dirección firmada de 10 minutos (control positivo)", async () => {
    h.filasDeMensajes = [descargado("m1", RUTA)];
    const cuerpo = await (await leer()).json();
    expect(h.firmas).toEqual([{ bucket: "message-media", rutas: [RUTA], segundos: 600 }]);
    expect(cuerpo.messages[0].archivo).toEqual({ url: `https://storage.ejemplo.invalid/firmada/${RUTA}?token=t`, mime: "image/jpeg" });
  });

  it("solo firma los descargados; media_path y la dirección del proveedor no viajan", async () => {
    h.filasDeMensajes = [
      descargado("m3", "ws-1/conv-1/m3/archivo.mp4", { media_mime: "video/mp4", message_type: "audio" }),
      descargado("m2", "ws-1/conv-1/m2/archivo.jpg", { media_status: "fallido" }),
      descargado("m1", null as unknown as string, { media_status: "pendiente", media_path: null }),
    ];
    const cuerpo = await (await leer()).json();
    expect(h.firmas).toEqual([{ bucket: "message-media", rutas: ["ws-1/conv-1/m3/archivo.mp4"], segundos: 600 }]);
    const porId = Object.fromEntries(cuerpo.messages.map((m: { id: string }) => [m.id, m]));
    expect(porId.m3.archivo).toMatchObject({ mime: "video/mp4" });
    expect(porId.m2.archivo).toBeNull();
    expect(porId.m1.archivo).toBeNull();
    expect(porId.m2.media_status).toBe("fallido");
    for (const m of cuerpo.messages) expect(m).not.toHaveProperty("media_path");
    expect(JSON.stringify(cuerpo)).not.toContain("lookaside");
  });

  it("sin adjuntos descargados no llama a Storage", async () => {
    h.filasDeMensajes = [{ id: "m1", conversation_id: "conv-1", direction: "inbound", text: "hola", attachments: null, created_at: "2026-10-09T10:00:00Z" }];
    const cuerpo = await (await leer()).json();
    expect(h.firmas).toHaveLength(0);
    expect(cuerpo.messages[0].archivo).toBeNull();
  });
});
