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
    escrituras: [] as Array<{ tabla: string; tipo: string; valores?: unknown; opciones?: unknown }>,
    falloAlGuardar: false,
    importacionOk: null as string | null,
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

const rellenarPerfilSiFalta = vi.fn(async () => "no_aplica");
vi.mock("@/lib/relleno-perfil", () => ({
  rellenarPerfilSiFalta: (...args: unknown[]) => rellenarPerfilSiFalta(...(args as [])),
}));

// F28: la descarga se intercepta; `seDescarga` es la real.
const descargarAdjunto = vi.fn(async (..._a: unknown[]) => "descargado");
vi.mock("@/lib/adjuntos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adjuntos")>();
  return {
    ...real,
    almacenDeSupabase: () => ({}),
    descargarAdjunto: (...args: unknown[]) => descargarAdjunto(...args),
  };
});

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
      upsert: (valores: unknown, opciones?: unknown) => {
        estado.escrituras.push({ tabla, tipo: "upsert", valores, opciones });
        if (tabla === "messages") {
          return Promise.resolve({ error: estado.falloAlGuardar ? { message: "falla simulada" } : null });
        }
        return cadena;
      },
      update: (valores: unknown) => {
        estado.escrituras.push({ tabla, tipo: "update", valores });
        return cadena;
      },
      delete: () => {
        estado.escrituras.push({ tabla, tipo: "delete" });
        return cadena;
      },
      is: () => cadena,
      or: () => cadena,
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
    if (tabla === "messages" && terminador === "maybeSingle") {
      return { data: { id: "msg-local-1" }, error: null };
    }
    if (tabla === "tareas_estado") {
      return { data: estado.importacionOk ? { ultimo_ok_at: estado.importacionOk } : null, error: null };
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
  direccion = "incoming" as "incoming" | "outgoing",
}: {
  plataforma: "instagram" | "whatsapp";
  id?: string;
  texto?: string | null;
  attachments?: Array<{ type: string; url: string }>;
  direccion?: "incoming" | "outgoing";
}) {
  return JSON.stringify({
    id,
    event: "message.received",
    message: {
      id: "msg-1",
      conversationId: "zconv-1",
      platform: plataforma,
      platformMessageId: "pmid-1",
      // Los literales de Zernio son "incoming" y "outgoing". El fixture decía
      // "inbound", que no existe en ninguna respuesta del proveedor: verificado
      // contra los tipos generados del SDK y contra 8 entregas reales del log
      // el 21/09/2026.
      direction: direccion,
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

const guardadosEnMessages = () =>
  estado.escrituras.filter((e) => e.tabla === "messages" && e.tipo === "upsert").flatMap((e) => e.valores as Record<string, unknown>[]);

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
  estado.escrituras = [];
  estado.falloAlGuardar = false;
  estado.importacionOk = null;
  upsertContactForSender.mockReset();
  descargarAdjunto.mockClear();
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

  // Antes se llamaba "la idempotencia por webhook_events funciona igual para los
  // dos", como el criterio #5 de F22, y no lo probaba: recorre Instagram y
  // WhatsApp los dos POR ZERNIO. El criterio, Zernio contra Evolution sobre un
  // registro compartido, está en `../idempotencia-canales.test.ts`.
  it("la idempotencia por webhook_events funciona igual para Instagram y WhatsApp por Zernio", async () => {
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

  /**
   * Hasta el 08/10/2026 este test exigía que un `message.received` con
   * dirección `outgoing` se descartara con `reason: "outgoing"`, para no
   * procesar en bucle los propios envíos. Con F27 lo que escribe el negocio se
   * GUARDA (si no, deja de verse en la bandeja), y lo que evita el bucle es
   * que nunca dispara flujos. El test pasa a exigir eso.
   *
   * Historia que se conserva: el test original mandaba `"outbound"`, el mismo
   * literal inventado que comparaba el handler, y pasaba en verde mientras el
   * guard no filtraba nada. Los literales del proveedor son `"incoming"` y
   * `"outgoing"`.
   */
  it("un saliente se guarda como del negocio y no dispara flujos", async () => {
    const body = eventoMensaje({ plataforma: "instagram", direccion: "outgoing" });

    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ direction: "outbound" })]);
    expect(pendientes).toHaveLength(0);
    expect(matchTrigger).not.toHaveBeenCalled();
  });

  /**
   * La contraparte afirmativa, y no es decorativa: sin ella, un `return` de más
   * en el handler dejaría el test de arriba en verde descartando TODO. "No se
   * procesó" no distingue entre un filtro que funciona y una puerta tapiada.
   */
  it("procesa los entrantes, que es lo que el guard no tiene que descartar", async () => {
    const body = eventoMensaje({ plataforma: "instagram", direccion: "incoming" });

    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });
    expect(pendientes).toHaveLength(1);
    await correrPendientes();
    expect(upsertContactForSender).toHaveBeenCalledTimes(1);
  });

  /**
   * Un literal que no conocemos cae del lado del contacto, igual que en
   * `traducirDireccion` de `lib/zernio-message-map.ts`. Acá el efecto es
   * descartar, así que la elección segura es NO descartar: perder un mensaje de
   * un lead es peor que procesar de más uno propio, que además ya tiene el
   * segundo guard por cuenta remitente.
   */
  it("ante una dirección desconocida procesa, no descarta", async () => {
    const payload = JSON.parse(eventoMensaje({ plataforma: "instagram" }));
    payload.message.direction = "algo_que_no_existe";
    const body = JSON.stringify(payload);

    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });
    expect(pendientes).toHaveLength(1);
  });

  it("responde 400 ante un cuerpo que no es JSON", async () => {
    const res = await POST(pedido("esto no es json"));
    expect(res.status).toBe(400);
  });
});

/**
 * F27: guardar lo que entra, también lo que el negocio escribe fuera del
 * sistema. Con las dos entregas reales del log de Zernio (08/10/2026, cuenta de
 * prueba, datos reemplazados). Escritos en rojo contra el receptor de `8e21367`,
 * que descartaba `message.sent` en el filtro por tipo de evento, descartaba los
 * entrantes de otra cuenta conectada en el filtro de cuenta propia, y no
 * guardaba nada.
 */
import recibidoReal from "@/lib/fixtures/zernio-webhook-message-received.json";
import enviadoReal from "@/lib/fixtures/zernio-webhook-message-sent.json";

function avisoReal(fuente: { payload: Record<string, unknown> }, cambios: (p: Record<string, any>) => void = () => {}) {
  const p = JSON.parse(JSON.stringify(fuente.payload));
  p.account.id = "acct-1"; // la ranura del canal del test
  cambios(p);
  return JSON.stringify(p);
}


describe("F27: el receptor guarda los mensajes", () => {
  it("un entrante de un lead se guarda ANTES del acuse, y dispara el flujo después (control positivo)", async () => {
    const body = avisoReal(recibidoReal);
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    // Antes de correr after(): el mensaje ya está guardado.
    expect(guardadosEnMessages()).toEqual([
      expect.objectContaining({ direction: "inbound", platform_message_id: recibidoReal.payload.message.platformMessageId }),
    ]);
    await correrPendientes();
    expect(matchTrigger).toHaveBeenCalledTimes(1);
  });

  it("un entrante que cita a otro mensaje guarda la referencia (metadata.quotedMessageId, F27)", async () => {
    // El SDK 0.2.519 lo declara para Instagram: `reply_to.mid` de Meta
    // (`node_modules/@zernio/node/dist/index.d.ts:7587-7595`).
    const body = avisoReal(recibidoReal, (p) => {
      p.metadata = { ...(p.metadata ?? {}), quotedMessageId: "mid-citado-1" };
    });
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ quoted_message_id: "mid-citado-1" })]);
  });

  it("un echo de la app (message.sent) que cita guarda la referencia; sin cita queda nula", async () => {
    const conCita = avisoReal(enviadoReal, (p) => {
      p.metadata = { quotedMessageId: "mid-citado-2" };
    });
    await POST(pedido(conCita, { "x-late-signature": firmar(conCita) }));
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ quoted_message_id: "mid-citado-2" })]);
  });

  it("sin metadata, la referencia queda nula", async () => {
    const body = avisoReal(recibidoReal, (p) => {
      delete p.metadata;
    });
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ quoted_message_id: null })]);
  });

  it("un entrante actualiza la marca del último entrante del canal (F39)", async () => {
    const body = avisoReal(recibidoReal);
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(estado.escrituras).toContainEqual(
      expect.objectContaining({ tabla: "channels", tipo: "update", valores: { last_inbound_at: expect.any(String) } }),
    );
  });

  it("message.sent (real, sentVia api) de la propia cuenta: se guarda como del negocio, en la conversación del participante, sin flujo", async () => {
    // El autor de un saliente es la cuenta del negocio (en la entrega real,
    // sender.username == account.username), que es un canal activo del
    // espacio: el filtro de cuenta propia lo descartaba. El fixture es de la
    // API; el echo escrito desde la app se observó el 08/10/2026 (control 2):
    // sentVia nulo y sender.username == account.username, igual que acá.
    estado.senderChannel = { id: "ch-1" };
    const body = avisoReal(enviadoReal);
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    expect(guardadosEnMessages()).toEqual([
      expect.objectContaining({ direction: "outbound", platform_message_id: enviadoReal.payload.message.platformMessageId }),
    ]);
    expect(upsertContactForSender.mock.calls[0][0]).toMatchObject({
      senderId: enviadoReal.payload.conversation.participantId,
    });
    await correrPendientes();
    expect(matchTrigger).not.toHaveBeenCalled();
    expect(estado.escrituras.some((e) => e.tabla === "channels" && e.tipo === "update")).toBe(false);
  });

  it("un entrante cuyo autor es otra cuenta conectada del espacio se guarda, sin flujo", async () => {
    estado.senderChannel = { id: "ch-2" };
    const body = avisoReal(recibidoReal);
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ direction: "inbound" })]);
    await correrPendientes();
    expect(matchTrigger).not.toHaveBeenCalled();
  });

  it("si guardar falla, libera el reclamo y responde 500 para que el proveedor reintente", async () => {
    estado.falloAlGuardar = true;
    const body = avisoReal(recibidoReal);
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(500);
    expect(estado.escrituras).toContainEqual(expect.objectContaining({ tabla: "webhook_events", tipo: "delete" }));
    expect(pendientes).toHaveLength(0);
  });

  it("un lead nuevo después de una importación completa: su conversación queda completa", async () => {
    estado.importacionOk = "2026-10-08T21:00:00Z";
    const body = avisoReal(recibidoReal);
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(estado.escrituras).toContainEqual(
      expect.objectContaining({ tabla: "conversations", tipo: "update", valores: expect.objectContaining({ historial_estado: "completo" }) }),
    );
  });

  it("antes de la primera importación, la conversación de un lead nuevo queda pendiente (la trae la importación)", async () => {
    const body = avisoReal(recibidoReal);
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(estado.escrituras.some((e) => e.tabla === "conversations" && e.tipo === "update")).toBe(false);
  });
});

/**
 * F28: el archivo del adjunto se baja DESPUÉS del acuse. Con el aviso real del
 * 08/10/2026, al que se le pone un adjunto INVENTADO con la forma del SDK
 * (`@zernio/node` 0.2.519, `dist/index.d.ts:7480-7505`): no hay un aviso real
 * con adjunto guardado.
 */
describe("F28: la descarga del adjunto", () => {
  const conAdjunto = (tipo: string) =>
    avisoReal(recibidoReal, (p) => {
      p.message.attachments = [{ type: tipo, url: "https://cdn.ejemplo.invalid/archivo" }];
    });

  it("el entrante se guarda marcado (intentos 0) y la descarga NO corre antes del acuse", async () => {
    const body = conAdjunto("image");
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ message_type: "imagen", media_status: "pendiente", media_intentos: 0 })]);
    expect(descargarAdjunto).not.toHaveBeenCalled();
    await correrPendientes();
    expect(descargarAdjunto).toHaveBeenCalledTimes(1);
    expect(descargarAdjunto.mock.calls[0][0]).toBe("msg-local-1");
  });

  it("una descarga colgada no demora el acuse", async () => {
    descargarAdjunto.mockImplementationOnce(() => new Promise(() => {}));
    const body = conAdjunto("audio");
    const res = await POST(pedido(body, { "x-late-signature": firmar(body) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    void correrPendientes();
  });

  it("si el after() no llega a correr (redespliegue), el mensaje quedó guardado y marcado para el reintento", async () => {
    const body = conAdjunto("video");
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    pendientes.length = 0; // el proceso se cortó: nada de lo pendiente corre
    expect(descargarAdjunto).not.toHaveBeenCalled();
    expect(guardadosEnMessages()).toEqual([expect.objectContaining({ media_status: "pendiente", media_intentos: 0, direction: "inbound" })]);
  });

  it("entre cuentas propias también se baja (aunque no corran flujos)", async () => {
    estado.senderChannel = { id: "ch-otro" };
    const body = conAdjunto("image");
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await correrPendientes();
    expect(descargarAdjunto).toHaveBeenCalledTimes(1);
  });

  it("un share entrante (tipo otro) no se marca ni se baja", async () => {
    const body = conAdjunto("share");
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await correrPendientes();
    const [fila] = guardadosEnMessages();
    expect(fila).toMatchObject({ message_type: "otro", media_status: "pendiente" });
    expect(fila).not.toHaveProperty("media_intentos");
    expect(descargarAdjunto).not.toHaveBeenCalled();
  });

  it("un saliente con adjunto (echo de la app) no se marca ni se baja", async () => {
    const body = avisoReal(enviadoReal, (p) => {
      p.message.attachments = [{ type: "image", url: "https://cdn.ejemplo.invalid/archivo" }];
    });
    await POST(pedido(body, { "x-late-signature": firmar(body) }));
    await correrPendientes();
    const [fila] = guardadosEnMessages();
    expect(fila).toMatchObject({ direction: "outbound", message_type: "imagen" });
    expect(fila).not.toHaveProperty("media_intentos");
    expect(descargarAdjunto).not.toHaveBeenCalled();
  });
});
