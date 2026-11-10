import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
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
  /** F35: el filtro del cursor y el orden que pidió la ruta. */
  or: null as string | null,
  ordenes: [] as Array<[string, unknown]>,
  /** F40: campos de la conversación que cambia cada test (plataforma, canal, ventana). */
  conv: {} as Record<string, unknown>,
  /** F42: el token de la instancia en Vault (null: no está). */
  tokenEvolution: "tok-instancia" as string | null,
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
        or: (f: string) => {
          h.or = f;
          return cadena;
        },
        order: (columna: string, opciones: unknown) => {
          if (tabla === "messages") h.ordenes.push([columna, opciones]);
          return cadena;
        },
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
                  ...h.conv,
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
vi.mock("@/lib/vault", () => ({
  getZernioApiKey: async () => "zk",
  getWorkspaceSecret: async () => h.tokenEvolution,
  evolutionInstanceTokenName: (canal: string) => `evolution_instance_token:${canal}`,
}));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { sendInboxMessage: h.sendInboxMessage } }),
}));
const registrarFalloDeZernio = vi.fn();
vi.mock("@/lib/integraciones-estado", () => ({ registrarFalloDeZernio: (...a: unknown[]) => registrarFalloDeZernio(...a) }));

const { GET, POST, MENSAJES_POR_HILO } = await import("./route");

const pedido = (cuerpo: unknown) =>
  new Request("http://localhost/api/v1/messages", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

beforeEach(() => {
  h.conv = {};
  registrarFalloDeZernio.mockReset();
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
    expect(res.status).toBe(502);
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

  it("F44: una publicación viaja con su título y sin enlace, un reel con su enlace; los ya guardados también", async () => {
    const ADJ = JSON.parse(readFileSync(new URL("../../../../lib/fixtures/zernio-adjuntos-f44.json", import.meta.url), "utf8"));
    h.filasDeMensajes = [
      fila("m3", { attachments: [ADJ.videoDeCamara], media_status: "pendiente" }),
      fila("m2", { attachments: [ADJ.reel], media_status: "no_disponible" }),
      fila("m1", { attachments: [ADJ.publicacion], media_status: "pendiente" }),
    ];
    const cuerpo = await (await leer()).json();
    expect(cuerpo.messages[0].attachments).toEqual([{ type: "share", compartido: "publicacion", titulo: ADJ.publicacion.payload.title }]);
    expect(JSON.stringify(cuerpo.messages[0])).not.toContain("lookaside");
    expect(cuerpo.messages[1].attachments).toEqual([{ type: "video", compartido: "reel", enlace: ADJ.reel.payload.url }]);
    // El video de la cámara no es compartido: su dirección no viaja.
    expect(cuerpo.messages[2].attachments).toEqual([{ type: "video" }]);
    expect(JSON.stringify(cuerpo.messages[2])).not.toContain("lookaside");
  });

  it("F44: un compartido con un enlace fuera de la lista viaja sin enlace", async () => {
    h.filasDeMensajes = [fila("m1", { attachments: [{ type: "share", url: "https://ejemplo.com/p/x" }], media_status: "pendiente" })];
    const cuerpo = await (await leer()).json();
    expect(cuerpo.messages[0].attachments).toEqual([{ type: "share", compartido: "publicacion" }]);
    expect(JSON.stringify(cuerpo)).not.toContain("ejemplo.com");
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

  /**
   * F28, parte B: la clave de descifrado de WhatsApp (`mediaKey`) vive solo en
   * `whatsapp_adjuntos_por_bajar`, que esta ruta no lee. Aunque una fila de
   * `messages` llegara a traerla dentro del adjunto (un cambio futuro en el
   * receptor), la respuesta no la deja salir: de cada adjunto viaja solo `type`.
   */
  it("la clave de descifrado de WhatsApp no viaja nunca, aunque el adjunto la trajera", async () => {
    h.filasDeMensajes = [
      descargado("w1", "ws-1/conv-1/w1/archivo.jpg", {
        attachments: [{ type: "imageMessage", mimetype: "image/jpeg", fileName: null, mediaKey: { 0: 7, 1: 8 }, directPath: "/v/t62/secreto" }],
      }),
    ];
    const cuerpo = await (await leer()).json();
    const texto = JSON.stringify(cuerpo);
    expect(cuerpo.messages[0].archivo).toMatchObject({ mime: "image/jpeg" });
    expect(cuerpo.messages[0].attachments).toEqual([{ type: "imageMessage" }]);
    for (const pedazo of ["mediaKey", "directPath", "/v/t62/secreto"]) expect(texto).not.toContain(pedazo);
  });

  it("sin adjuntos descargados no llama a Storage", async () => {
    h.filasDeMensajes = [{ id: "m1", conversation_id: "conv-1", direction: "inbound", text: "hola", attachments: null, created_at: "2026-10-09T10:00:00Z" }];
    const cuerpo = await (await leer()).json();
    expect(h.firmas).toHaveLength(0);
    expect(cuerpo.messages[0].archivo).toBeNull();
  });
});

/**
 * F35 (tramo A de S8): el hilo carga los mensajes anteriores a los últimos 200,
 * hasta el primero guardado. El cursor es la pareja hora e id del más viejo
 * que ya tiene el hilo: el historial importado tiene mensajes con la misma
 * hora, y con la hora sola se repetirían o se perderían en el corte.
 */
describe("GET /api/v1/messages: los anteriores (F35)", () => {
  const ID = "6f1c3d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const leer = (q: string) => GET(new NextRequestReal(`http://localhost/api/v1/messages?conversationId=conv-1${q}`));

  beforeEach(() => {
    h.filasDeMensajes = [];
    h.fueraDeAlcance = false;
    h.or = null;
    h.ordenes.length = 0;
  });

  it("sin cursor, ordena por hora y desempata por id", async () => {
    await leer("");
    expect(h.ordenes).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(h.or).toBeNull();
  });

  it("con cursor, pide los anteriores a esa pareja de hora e id", async () => {
    const hora = "2026-10-24T17:32:00.123456+00:00";
    await leer(`&antesAt=${encodeURIComponent(hora)}&antesId=${ID}`);
    expect(h.or).toBe(`created_at.lt."${hora}",and(created_at.eq."${hora}",id.lt.${ID})`);
  });

  it("al llegar al primero no avisa que hay anteriores", async () => {
    h.filasDeMensajes = [{ id: "m1", conversation_id: "conv-1", direction: "inbound", text: "primero", attachments: null, created_at: "2026-10-01T10:00:00Z" }];
    const cuerpo = await (await leer(`&antesAt=2026-10-02T10%3A00%3A00Z&antesId=${ID}`)).json();
    expect(cuerpo.messages.map((m: { text: string }) => m.text)).toEqual(["primero"]);
    expect(cuerpo.hayAnteriores).toBe(false);
  });

  it("un cursor a medias, o con una hora o un id que no lo son, es 400", async () => {
    expect((await leer("&antesAt=2026-10-02T10:00:00Z")).status).toBe(400);
    expect((await leer(`&antesAt=ayer&antesId=${ID}`)).status).toBe(400);
    expect((await leer("&antesAt=2026-10-02T10:00:00Z&antesId=x),id.gt.(0")).status).toBe(400);
    expect(h.or).toBeNull();
  });
});

describe("POST /api/v1/messages: la ventana de Instagram (F40)", () => {
  const instagram = (vence: string | null) => ({
    platform: "instagram",
    window_expires_at: vence,
    channels: { late_account_id: "acc-1", is_active: true, provider: "zernio" },
  });
  const enUnaHora = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("con la ventana cerrada: 409 ventana_cerrada con el aviso, sin llamar al proveedor y sin guardar nada", async () => {
    h.conv = instagram(haceUnaHora());
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      code: "ventana_cerrada",
      error: "No se envió: la ventana de 24 horas se cerró mientras escribías. Escribile desde la app de Instagram.",
    });
    expect(h.sendInboxMessage).not.toHaveBeenCalled();
    expect(h.upserts).toEqual([]);
  });

  it("sin ningún mensaje del lead (ventana en null): 409, sin llamar al proveedor", async () => {
    h.conv = instagram(null);
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(409);
    expect(h.sendInboxMessage).not.toHaveBeenCalled();
  });

  it("control positivo: con la ventana abierta, se envía", async () => {
    h.conv = instagram(enUnaHora());
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(201);
    expect(h.sendInboxMessage).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp por Evolution no tiene ventana: no se corta por eso", async () => {
    h.conv = { platform: "whatsapp", window_expires_at: null, channels: { late_account_id: "acc-1", is_active: true, provider: "evolution" } };
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).not.toBe(409);
  });

  it("si el proveedor lo rechaza por la ventana: 409 ventana_cerrada, y la integración NO se marca como caída", async () => {
    h.conv = instagram(enUnaHora());
    h.sendInboxMessage.mockRejectedValue(Object.assign(new Error("(#10) This message is sent outside of allowed window."), { statusCode: 403 }));
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "ventana_cerrada" });
    expect(registrarFalloDeZernio).not.toHaveBeenCalled();
    expect(h.upserts).toEqual([]);
  });

  it("cualquier otro rechazo: 502 con un texto en castellano, y la integración se entera", async () => {
    h.conv = instagram(enUnaHora());
    h.sendInboxMessage.mockRejectedValue(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
    const res = await POST(pedido({ conversationId: "conv-1", text: "hola" }));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ code: "proveedor", error: "No se envió: Instagram rechazó el mensaje." });
    expect(registrarFalloDeZernio).toHaveBeenCalledTimes(1);
  });
});

/**
 * F42: contestar por WhatsApp desde la bandeja, con respuestas simuladas de
 * Evolution (la forma sale de `prepareMessage` de Evolution 2.3.7, armada).
 * Escritos en rojo antes de la rama de Evolution: la ruta respondía 400 «No
 * Zernio conversation ID linked to this conversation» a toda conversación de
 * WhatsApp por Evolution.
 */
describe("POST /api/v1/messages por WhatsApp (F42)", () => {
  const EVO = "https://evo.ejemplo.invalid";
  const evolution = vi.fn();
  const conWhatsapp = (sesion: string, extra: Record<string, unknown> = {}) => {
    h.conv = {
      platform: "whatsapp",
      late_conversation_id: null,
      window_expires_at: null,
      channels: { provider: "evolution", instance_name: "inst-1", session_state: sesion, late_account_id: null, is_active: true },
      ...extra,
    };
  };
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = EVO;
    h.tokenEvolution = "tok-instancia";
    evolution.mockReset();
    evolution.mockResolvedValue(new Response(JSON.stringify({ key: { remoteJid: "lead@s.whatsapp.net", fromMe: true, id: "3EB0ENVIADO" } }), { status: 201 }));
    vi.stubGlobal("fetch", evolution);
  });

  for (const sesion of ["caido", "agotado", "sin_vincular"]) {
    it(`con la sesión «${sesion}» responde 409 y no llama a Evolution ni guarda`, async () => {
      conWhatsapp(sesion);
      const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code: "whatsapp_desconectado", error: "WhatsApp no está conectado. Los mensajes no pueden salir ni entrar por este canal hasta reconectarlo." });
      expect(evolution).not.toHaveBeenCalled();
      expect(h.upserts).toEqual([]);
    });
  }

  it("con la sesión conectada envía por Evolution y guarda con el key.id, una sola clave de unicidad", async () => {
    conWhatsapp("conectado");
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(201);
    const [url, init] = evolution.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${EVO}/message/sendText/inst-1`);
    expect((init.headers as Record<string, string>).apikey).toBe("tok-instancia");
    expect(JSON.parse(String(init.body))).toEqual({ number: "lead-ig-1", text: "prueba F42" });
    expect(h.sendInboxMessage).not.toHaveBeenCalled();
    expect(h.upserts).toEqual([
      {
        tabla: "messages",
        valores: expect.objectContaining({ conversation_id: "conv-1", direction: "outbound", platform_message_id: "3EB0ENVIADO", sent_by_user_id: "u-1", remote_jid: "lead-ig-1", text: "prueba F42" }),
        opciones: { onConflict: "conversation_id,platform_message_id,direction" },
      },
    ]);
  });

  it("«no se pudo verificar» intenta enviar (control)", async () => {
    conWhatsapp("sin_verificar");
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(201);
    expect(evolution).toHaveBeenCalledTimes(1);
  });

  it("no hay ventana de 24 horas: con la ventana vencida igual envía (criterio 4)", async () => {
    conWhatsapp("conectado", { window_expires_at: "2026-01-01T00:00:00Z" });
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(201);
    expect(evolution).toHaveBeenCalledTimes(1);
  });

  it("si Evolution rechaza (400), responde el error y no guarda nada", async () => {
    conWhatsapp("conectado");
    evolution.mockResolvedValue(new Response(JSON.stringify({ status: 400 }), { status: 400 }));
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "No se envió: WhatsApp rechazó el mensaje." });
    expect(h.upserts).toEqual([]);
  });

  it("si Evolution no responde a tiempo, lo dice y no guarda nada (si salió, lo guarda el aviso)", async () => {
    conWhatsapp("conectado");
    evolution.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ error: "WhatsApp no respondió a tiempo. Si el mensaje salió, va a aparecer en el hilo en unos segundos." });
    expect(h.upserts).toEqual([]);
  });

  it("sin el token de la instancia en Vault no llama a Evolution", async () => {
    conWhatsapp("conectado");
    h.tokenEvolution = null;
    const res = await POST(pedido({ conversationId: "conv-1", text: "prueba F42" }));
    expect(res.status).toBe(503);
    expect(evolution).not.toHaveBeenCalled();
  });
});
