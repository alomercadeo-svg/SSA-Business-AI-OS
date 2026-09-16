import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Tests del webhook entrante de Zernio.
 *
 * Cubren tres cosas distintas:
 *
 *   1. **La firma.** Desde esta sesión el webhook falla cerrado: sin secret
 *      configurado responde 401 en vez de procesar. Antes la condición era
 *      `if (secret && !verifica(...))`, o sea que sin secret aceptaba cualquier
 *      cosa, y eso convierte el endpoint en una entrada abierta al motor de
 *      flujos durante toda la ventana entre conectar un canal y guardar el
 *      secret.
 *
 *   2. **La paridad entre plataformas.** El criterio de F6 pide que WhatsApp
 *      entre por el mismo camino que Instagram, sin condicionales por
 *      plataforma. La forma de probarlo es mandar el mismo evento con las dos
 *      plataformas y comparar tanto la respuesta como lo que recibe el
 *      procesamiento.
 *
 *   3. **La idempotencia.** Zernio reintenta con el mismo `id` de evento. El
 *      reintento no puede volver a disparar un flujo.
 *
 * `after()` se intercepta en vez de ejecutarse: el handler responde primero y
 * procesa después, así que los tests que miran el procesamiento corren los
 * pendientes a mano con `correrPendientes()`.
 */

const { pendientes, estado } = vi.hoisted(() => ({
  pendientes: [] as Array<() => unknown | Promise<unknown>>,
  estado: {
    channel: null as Record<string, unknown> | null,
    senderChannel: null as Record<string, unknown> | null,
    workspaceSecret: null as string | null,
    claimDuplicado: false,
    eventosReclamados: [] as string[],
  },
}));

vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void pendientes.push(fn) };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => crearSupabaseFalso(),
}));

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({
  upsertContactForSender: (...args: unknown[]) => upsertContactForSender(...args),
}));

const matchTrigger = vi.fn();
vi.mock("@/lib/flow-engine/trigger-matcher", () => ({
  matchTrigger: (...args: unknown[]) => matchTrigger(...args),
}));

const executeFlow = vi.fn();
vi.mock("@/lib/flow-engine/engine", () => ({
  executeFlow: (...args: unknown[]) => executeFlow(...args),
}));

const processComment = vi.fn();
vi.mock("@/lib/comment-processor", () => ({
  processComment: (...args: unknown[]) => processComment(...args),
}));

/**
 * Cliente de Supabase de mentira. Enruta por tabla y por cómo termina la
 * cadena, que es lo único que distingue a las consultas del handler:
 * `channels` con `.single()` es la búsqueda del canal, con `.maybeSingle()` es
 * la detección de mensaje propio.
 */
function crearSupabaseFalso() {
  const constructor = (tabla: string) => {
    const cadena = {
      select: () => cadena,
      eq: () => cadena,
      upsert: () => cadena,
      update: () => cadena,
      single: async () => resolver(tabla, "single"),
      maybeSingle: async () => resolver(tabla, "maybeSingle"),
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === "webhook_events") {
          const id = String(fila.event_id);
          if (estado.claimDuplicado || estado.eventosReclamados.includes(id)) {
            return { error: { code: "23505" } };
          }
          estado.eventosReclamados.push(id);
          return { error: null };
        }
        return { error: null };
      },
      then: undefined,
    };
    return cadena;
  };

  const resolver = (tabla: string, terminador: string) => {
    if (tabla === "channels" && terminador === "single") {
      return { data: estado.channel, error: null };
    }
    if (tabla === "channels" && terminador === "maybeSingle") {
      return { data: estado.senderChannel, error: null };
    }
    if (tabla === "workspaces") {
      return { data: { webhook_secret: estado.workspaceSecret, global_keywords: [] }, error: null };
    }
    if (tabla === "conversations") {
      return { data: { id: "conv-1", is_automation_paused: false }, error: null };
    }
    return { data: null, error: null };
  };

  return {
    from: constructor,
    rpc: () => ({ then: (fn: () => void) => Promise.resolve().then(fn) }),
  };
}

const { POST } = await import("./route");

const SECRET = "secreto-de-prueba-0123456789abcdef";

function firmar(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function pedido(body: string, headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/webhooks/late", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  }) as unknown as NextRequest;
}

/** Evento `message.received`, idéntico salvo la plataforma. */
function eventoMensaje({
  plataforma,
  id = "evt-1",
  texto = "hola",
  attachments = [] as Array<{ type: string; url: string }>,
}: {
  plataforma: "instagram" | "whatsapp";
  id?: string;
  texto?: string | null;
  attachments?: Array<{ type: string; url: string }>;
}) {
  return JSON.stringify({
    id,
    event: "message.received",
    message: {
      id: "msg-1",
      conversationId: "zconv-1",
      platform: plataforma,
      platformMessageId: "pmid-1",
      direction: "inbound",
      text: texto,
      attachments,
      sender: { id: "sender-1", name: "Quien Escribe", username: "quien_escribe", picture: null },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: {
      id: "zconv-1",
      platformConversationId: "pconv-1",
      participantId: "sender-1",
      participantName: "Quien Escribe",
      participantUsername: "quien_escribe",
      participantPicture: null,
      status: "open",
    },
    account: { id: "acct-1", platform: plataforma, username: "el_negocio", displayName: "El Negocio" },
    timestamp: new Date().toISOString(),
  });
}

function eventoComentario(id = "evt-c1") {
  return JSON.stringify({
    id,
    event: "comment.received",
    comment: {
      id: "cmt-1",
      postId: "post-1",
      platformPostId: "ppost-1",
      platform: "instagram",
      text: "precio?",
      author: { id: "autor-1", username: "alguien", name: "Alguien" },
      createdAt: new Date().toISOString(),
      isReply: false,
      parentCommentId: null,
    },
    post: { id: "post-1", platformPostId: "ppost-1" },
    account: { id: "acct-1", platform: "instagram", username: "el_negocio" },
    timestamp: new Date().toISOString(),
  });
}

async function correrPendientes() {
  const cola = pendientes.splice(0, pendientes.length);
  for (const fn of cola) await fn();
}

beforeEach(() => {
  pendientes.length = 0;
  estado.channel = {
    id: "ch-1",
    workspace_id: "ws-1",
    platform: "instagram",
    late_account_id: "acct-1",
    username: "el_negocio",
    is_active: true,
    webhook_secret: null,
  };
  estado.senderChannel = null;
  estado.workspaceSecret = SECRET;
  estado.claimDuplicado = false;
  estado.eventosReclamados = [];
  upsertContactForSender.mockReset();
  upsertContactForSender.mockResolvedValue({ contactId: "contact-1", existed: false });
  matchTrigger.mockReset();
  matchTrigger.mockResolvedValue(null);
  executeFlow.mockReset();
  processComment.mockReset();
});

describe("firma HMAC del webhook", () => {
  it("acepta una firma válida", async () => {
    const body = eventoMensaje({ plataforma: "instagram" });
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, queued: true });
  });

  it("rechaza una firma inválida", async () => {
    const body = eventoMensaje({ plataforma: "instagram" });
    const res = await POST(pedido(body, { "x-late-signature": firmar(body, "otro-secreto") }));
    expect(res.status).toBe(401);
    expect(pendientes).toHaveLength(0);
  });

  it("rechaza una firma ausente", async () => {
    const body = eventoMensaje({ plataforma: "instagram" });
    const res = await POST(pedido(body));
    expect(res.status).toBe(401);
    expect(pendientes).toHaveLength(0);
  });

  it("rechaza cuando el canal no tiene secret configurado, aunque la firma venga", async () => {
    // El agujero que cerró esta sesión: sin secret la condición vieja
    // (`secret && !verifica`) daba false y el evento se procesaba entero.
    estado.workspaceSecret = null;
    const body = eventoMensaje({ plataforma: "instagram" });
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(401);
    expect(pendientes).toHaveLength(0);
    expect(upsertContactForSender).not.toHaveBeenCalled();
  });

  it("rechaza sin secret también en el camino de comentarios", async () => {
    estado.workspaceSecret = null;
    const body = eventoComentario();
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(401);
    expect(processComment).not.toHaveBeenCalled();
  });

  it("cae al secret heredado del canal cuando el workspace no tiene", async () => {
    estado.workspaceSecret = null;
    estado.channel = { ...estado.channel!, webhook_secret: SECRET };
    const body = eventoMensaje({ plataforma: "instagram" });
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
  });
});

describe("paridad entre Instagram y WhatsApp", () => {
  it("procesa message.received por el mismo camino y con el mismo resultado", async () => {
    const recibido: Record<string, unknown>[] = [];

    for (const plataforma of ["instagram", "whatsapp"] as const) {
      estado.channel = { ...estado.channel!, platform: plataforma };
      estado.eventosReclamados = [];
      const body = eventoMensaje({ plataforma, id: `evt-${plataforma}` });
      const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, queued: true });

      await correrPendientes();
      recibido.push(upsertContactForSender.mock.calls.at(-1)![0] as Record<string, unknown>);
    }

    // Mismo contrato de canal: lo único que difiere es la plataforma del canal.
    const [ig, wa] = recibido;
    expect(ig.senderId).toBe(wa.senderId);
    expect(ig.senderName).toBe(wa.senderName);
    expect(ig.senderUsername).toBe(wa.senderUsername);
    expect((ig.channel as Record<string, unknown>).platform).toBe("instagram");
    expect((wa.channel as Record<string, unknown>).platform).toBe("whatsapp");
    expect(matchTrigger).toHaveBeenCalledTimes(2);
  });

  it("la idempotencia por webhook_events funciona igual para los dos", async () => {
    for (const plataforma of ["instagram", "whatsapp"] as const) {
      estado.channel = { ...estado.channel!, platform: plataforma };
      estado.eventosReclamados = [];
      const body = eventoMensaje({ plataforma, id: `evt-dup-${plataforma}` });
      const req = () => pedido(body, { "x-late-signature": firmar(body) });

      const primera = await POST(req());
      await expect(primera.json()).resolves.toEqual({ ok: true, queued: true });

      const reintento = await POST(req());
      await expect(reintento.json()).resolves.toMatchObject({
        skipped: true,
        reason: "duplicate_event",
      });

      // Una sola vez, no dos: el reintento no vuelve a disparar el flujo.
      expect(pendientes).toHaveLength(1);
      await correrPendientes();
    }
  });
});

describe("tipos de evento", () => {
  it("procesa una story reply como cualquier otro mensaje entrante", async () => {
    // Zernio las entrega como message.received con un attachment; el handler no
    // las trata aparte, y el criterio de F4 es justamente que no se caigan.
    const body = eventoMensaje({
      plataforma: "instagram",
      id: "evt-story",
      texto: "me encantó tu historia",
      attachments: [{ type: "story_mention", url: "https://cdn.ejemplo/story.jpg" }],
    });
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));

    expect(res.status).toBe(200);
    await correrPendientes();
    expect(upsertContactForSender).toHaveBeenCalledTimes(1);
    expect(matchTrigger).toHaveBeenCalledTimes(1);
  });

  it("procesa comment.received con firma válida", async () => {
    const body = eventoComentario();
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });
    await correrPendientes();
    expect(processComment).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a procesar un comment.received repetido", async () => {
    const body = eventoComentario("evt-c-dup");
    const req = () => pedido(body, { "x-late-signature": firmar(body) });

    await POST(req());
    const reintento = await POST(req());

    await expect(reintento.json()).resolves.toMatchObject({
      skipped: true,
      reason: "duplicate_event",
    });
    expect(pendientes).toHaveLength(1);
  });

  it("ignora los mensajes salientes para no hacer un bucle consigo mismo", async () => {
    const payload = JSON.parse(eventoMensaje({ plataforma: "instagram" }));
    payload.message.direction = "outbound";
    const body = JSON.stringify(payload);

    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await expect(res.json()).resolves.toMatchObject({ skipped: true });
    expect(pendientes).toHaveLength(0);
  });

  it("responde 400 ante un cuerpo que no es JSON", async () => {
    const res = await POST(pedido("esto no es json"));
    expect(res.status).toBe(400);
  });
});
