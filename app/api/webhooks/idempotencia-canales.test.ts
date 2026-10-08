import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import type { NextRequest } from "next/server";

/**
 * F22, criterio #5: "La idempotencia por `webhook_events` funciona igual para
 * los dos canales". Devuelto por la auditoría del 23/09/2026.
 *
 * **Por qué un archivo aparte y no un test más en cada receptor.** El test de
 * Zernio que llevaba el nombre de este criterio recorría Instagram y WhatsApp
 * los dos POR ZERNIO: Evolution no aparecía. Y cada receptor tenía su propio
 * registro falso de `webhook_events`, así que ningún test podía ver lo que pasa
 * cuando los dos escriben en la misma tabla, que es lo que pasa en producción:
 * `webhook_events` tiene una sola columna de clave (`event_id`, 00012) y no
 * distingue proveedor.
 *
 * Acá corren las dos rutas reales contra **un solo** registro compartido.
 *
 * **Qué significa "igual".** El contrato, no la clave. Las claves son distintas
 * a propósito: Zernio reclama el id del evento de la entrega; Evolution una
 * clave por mensaje, con prefijo `evolution:`, chat y dirección
 * (`lib/evolution-webhook.ts`). Lo que tiene que ser igual en los dos:
 *
 *   1. La primera entrega se procesa: responde `queued` y el procesamiento corre
 *      una vez. **Es el control positivo:** sin él, "el repetido no se procesó"
 *      no distingue entre idempotencia y un receptor que no procesa nada.
 *   2. La entrega repetida responde 200 con `duplicate_event` (un 200 y no un
 *      error, para que el proveedor no reintente) y el procesamiento no vuelve a
 *      correr.
 *   3. Queda una sola fila en el registro.
 *
 * Y uno que solo se ve con el registro compartido: los dos canales no se pisan.
 */

const { pendientes, estado } = vi.hoisted(() => ({
  pendientes: [] as Array<() => unknown | Promise<unknown>>,
  estado: {
    /** El registro compartido: lo que en producción es `webhook_events`. */
    webhookEvents: [] as string[],
    canalZernio: null as Record<string, unknown> | null,
    canalEvolution: null as Record<string, unknown> | null,
  },
}));

vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void pendientes.push(fn) };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => crearSupabaseFalso(),
}));

const SECRETO_ZERNIO = "secreto-de-zernio-0123456789abcdef";
const SECRETO_EVOLUTION = "secreto-de-evolution-0123456789abcdef";

vi.mock("@/lib/vault", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vault")>();
  return {
    ...real,
    getWorkspaceSecret: async (_c: unknown, _ws: string, nombre: string) =>
      nombre === real.SECRET_NAMES.evolutionWebhookSecret
        ? "secreto-de-evolution-0123456789abcdef"
        : null,
  };
});

// El procesamiento de cada canal, observado. Es lo que cuenta "se procesó".
const procesarEventoEvolution = vi.fn();
const guardarEventoEvolution = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/evolution-processor", () => ({
  procesarEventoEvolution: (...args: unknown[]) => procesarEventoEvolution(...args),
  guardarEventoEvolution: (...args: unknown[]) => guardarEventoEvolution(...args),
}));

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({
  upsertContactForSender: (...args: unknown[]) => upsertContactForSender(...args),
}));
vi.mock("@/lib/flow-engine/trigger-matcher", () => ({ matchTrigger: async () => null }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: vi.fn() }));
vi.mock("@/lib/comment-processor", () => ({ processComment: vi.fn() }));

/**
 * Supabase de mentira para los dos receptores. Las dos rutas consultan
 * `channels`, así que se distinguen por las columnas filtradas: Evolution busca
 * por `instance_name`, Zernio por `late_account_id`, y la detección de mensaje
 * propio de Zernio por `username`.
 */
function crearSupabaseFalso() {
  const constructor = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    const resolver = () => {
      if (tabla === "channels") {
        if ("instance_name" in filtros) {
          return estado.canalEvolution?.instance_name === filtros.instance_name
            ? estado.canalEvolution
            : null;
        }
        if ("late_account_id" in filtros) {
          return estado.canalZernio?.late_account_id === filtros.late_account_id
            ? estado.canalZernio
            : null;
        }
        return null; // detección de mensaje propio: el remitente no es un canal nuestro
      }
      if (tabla === "workspaces") return { webhook_secret: SECRETO_ZERNIO, global_keywords: [] };
      if (tabla === "conversations") return { id: "conv-1", is_automation_paused: false };
      return null;
    };
    const cadena = {
      select: () => cadena,
      eq: (columna: string, valor: unknown) => {
        filtros[columna] = valor;
        return cadena;
      },
      is: () => cadena,
      order: () => cadena,
      returns: () => cadena,
      upsert: () => cadena,
      update: () => cadena,
      single: async () => ({ data: resolver(), error: null }),
      maybeSingle: async () => ({ data: resolver(), error: null }),
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === "webhook_events") {
          // La restricción real: `event_id` es la clave primaria, sin proveedor.
          const id = String(fila.event_id);
          if (estado.webhookEvents.includes(id)) return { error: { code: "23505" } };
          estado.webhookEvents.push(id);
        }
        return { error: null };
      },
      then: undefined,
    };
    return cadena;
  };

  return { from: constructor, rpc: async () => ({ data: null, error: null }) };
}

const { POST: recibirZernio } = await import("./late/route");
const { POST: recibirEvolution } = await import("./evolution/route");

// ── Entregas de cada proveedor, firmadas como las firma cada uno ────────────

/** Zernio firma el cuerpo con HMAC-SHA256 en `x-late-signature`. */
function entregaZernio(eventId: string): () => NextRequest {
  const body = JSON.stringify({
    id: eventId,
    event: "message.received",
    message: {
      id: "msg-1",
      conversationId: "zconv-1",
      platform: "instagram",
      platformMessageId: "pmid-1",
      direction: "incoming",
      text: "hola",
      attachments: [],
      sender: { id: "sender-1", name: "Quien Escribe", username: "quien_escribe", picture: null },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: { id: "zconv-1", participantId: "sender-1", status: "open" },
    account: { id: "acct-1", platform: "instagram", username: "el_negocio" },
    timestamp: new Date().toISOString(),
  });
  const firma = createHmac("sha256", SECRETO_ZERNIO).update(body).digest("hex");
  return () =>
    new Request("http://localhost/api/webhooks/late", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "x-late-signature": firma },
    }) as unknown as NextRequest;
}

/** Evolution firma cada entrega con un JWT HS256 en `Authorization`. */
async function entregaEvolution(mensajeId: string): Promise<() => NextRequest> {
  const body = JSON.stringify({
    event: "messages.upsert",
    instance: "ssa-whatsapp",
    data: {
      key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: false, id: mensajeId },
      message: { conversation: "hola" },
      messageType: "conversation",
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });
  const ahora = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO_EVOLUTION));
  return () =>
    new Request("http://localhost/api/webhooks/evolution", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    }) as unknown as NextRequest;
}

async function correrPendientes() {
  const cola = pendientes.splice(0, pendientes.length);
  for (const fn of cola) await fn();
}

beforeEach(() => {
  pendientes.length = 0;
  estado.webhookEvents = [];
  estado.canalZernio = {
    id: "ch-ig",
    workspace_id: "ws-1",
    platform: "instagram",
    late_account_id: "acct-1",
    username: "el_negocio",
    is_active: true,
    webhook_secret: null,
  };
  estado.canalEvolution = {
    id: "ch-wa",
    workspace_id: "ws-1",
    platform: "whatsapp",
    provider: "evolution",
    instance_name: "ssa-whatsapp",
  };
  procesarEventoEvolution.mockReset();
  upsertContactForSender.mockReset();
  upsertContactForSender.mockResolvedValue({ contactId: "contact-1", existed: false });
});

/**
 * Cada canal, con su receptor real y lo que cuenta como "se procesó" en él.
 * El mismo cuerpo de test corre para los dos: si el contrato difiere, el mismo
 * test falla en uno solo.
 */
const CANALES = [
  {
    nombre: "Instagram, por Zernio",
    recibir: recibirZernio,
    entrega: async (id: string) => entregaZernio(id),
    procesados: () => upsertContactForSender.mock.calls.length,
  },
  {
    nombre: "WhatsApp, por Evolution",
    recibir: recibirEvolution,
    entrega: entregaEvolution,
    procesados: () => procesarEventoEvolution.mock.calls.length,
  },
] as const;

describe("F22 #5: la idempotencia por webhook_events funciona igual para los dos canales", () => {
  for (const canal of CANALES) {
    describe(canal.nombre, () => {
      it("la primera entrega se procesa (control positivo)", async () => {
        const pedido = await canal.entrega("ID-PRIMERO");

        const res = await canal.recibir(pedido());
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ok: true, queued: true });

        await correrPendientes();
        expect(canal.procesados()).toBe(1);
        expect(estado.webhookEvents).toHaveLength(1);
      });

      it("la entrega repetida se acusa con 200 y no se vuelve a procesar", async () => {
        const pedido = await canal.entrega("ID-REPETIDO");

        const primera = await canal.recibir(pedido());
        await expect(primera.json()).resolves.toEqual({ ok: true, queued: true });
        await correrPendientes();
        // El control positivo, dentro del mismo test: sin esto, "no se volvió a
        // procesar" se cumpliría también si nunca se procesó.
        expect(canal.procesados()).toBe(1);

        const repetida = await canal.recibir(pedido());
        expect(repetida.status).toBe(200);
        await expect(repetida.json()).resolves.toEqual({
          ok: true,
          skipped: true,
          reason: "duplicate_event",
        });

        expect(pendientes).toHaveLength(0);
        await correrPendientes();
        expect(canal.procesados()).toBe(1);
        expect(estado.webhookEvents).toHaveLength(1);
      });
    });
  }

  // Con un registro por receptor, este caso no existía en los tests. En
  // producción la tabla es una sola y su clave no tiene proveedor.
  //
  // El id de Zernio es, a propósito, la clave de Evolution SIN el prefijo: es la
  // colisión que el prefijo evita. Con un id cualquiera este test pasaría
  // aunque el prefijo desapareciera, porque la clave de Evolution también lleva
  // chat y dirección. Con este id, sacarle el prefijo a `claveIdempotencia` pone
  // este test en rojo: comprobado el 07/10/2026.
  it("los dos canales no se pisan en el registro compartido", async () => {
    const id = "MISMO-ID";
    const claveSinPrefijo = `ssa-whatsapp:5491122334455@s.whatsapp.net:${id}:0`;

    const deZernio = await recibirZernio((await CANALES[0].entrega(claveSinPrefijo))());
    const deEvolution = await recibirEvolution((await CANALES[1].entrega(id))());

    await expect(deZernio.json()).resolves.toEqual({ ok: true, queued: true });
    await expect(deEvolution.json()).resolves.toEqual({ ok: true, queued: true });
    await correrPendientes();

    expect(upsertContactForSender).toHaveBeenCalledTimes(1);
    expect(procesarEventoEvolution).toHaveBeenCalledTimes(1);
    expect(estado.webhookEvents).toEqual([claveSinPrefijo, `evolution:${claveSinPrefijo}`]);
  });
});
