import { describe, it, expect, vi } from "vitest";
import {
  traerMensajesDeConversacion,
  TAMANO_DE_PAGINA,
  type ClienteDeMensajes,
} from "./zernio-message-map";

/**
 * El hilo terminaba el 25 de agosto aunque la conversación tuviera mensajes de
 * septiembre.
 *
 * LA CAUSA, medida contra la API real el 16 de septiembre de 2026:
 * la conversación `1331828025829865` tiene **111 mensajes en 2 páginas**. La
 * ruta pedía sin `sortOrder` ni `limit`, así que recibía la página 1 en orden
 * ascendente —los 100 MÁS VIEJOS, de 2024-06-27 a 2026-08-25— y nunca pedía la
 * siguiente. Los 11 restantes, de 2026-08-29 a 2026-09-17, no llegaban nunca.
 *
 * Era la única de 33 conversaciones con `hasMore=true`, y por eso el síntoma
 * aparecía en una sola.
 *
 * ── EL FALSO CLIENTE ────────────────────────────────────────────────────────
 *
 * Imita el comportamiento observado del endpoint, no el declarado:
 *
 *   * `limit` por defecto 100, y TOPEADO en 100: pedir 200 devuelve 100.
 *   * `sortOrder` por defecto `asc`. `desc` funciona y Instagram lo respeta.
 *   * `offset` NO existe: se probó y la respuesta es idéntica con y sin él.
 *   * `pagination.hasMore` y `nextCursor` marcan si quedan más.
 *
 * Por eso este test discrimina de verdad: si el código no pide `desc`, el falso
 * cliente le entrega los más viejos, igual que la API real.
 */

/** 111 mensajes, del más viejo al más nuevo, como los tiene la conversación real. */
function historialCompleto() {
  const mensajes = [];
  // 100 viejos: del 2024-06-27 al 2026-08-25.
  for (let i = 0; i < 100; i++) {
    mensajes.push({
      id: `viejo-${String(i).padStart(3, "0")}`,
      message: `mensaje viejo ${i}`,
      direction: i % 2 === 0 ? "incoming" : "outgoing",
      createdAt: new Date(Date.UTC(2024, 5, 27) + i * 7 * 86400000).toISOString(),
      attachments: [],
    });
  }
  // 11 recientes: los que hoy no se ven. El último es el del 17 de septiembre.
  for (let i = 0; i < 11; i++) {
    mensajes.push({
      id: `reciente-${String(i).padStart(2, "0")}`,
      message: `mensaje reciente ${i}`,
      direction: i % 2 === 0 ? "outgoing" : "incoming",
      createdAt: new Date(Date.UTC(2026, 7, 29) + i * 2 * 86400000).toISOString(),
      attachments: [],
    });
  }
  return mensajes;
}

const TODOS = historialCompleto();
const EL_MAS_NUEVO = TODOS[TODOS.length - 1];
const EL_MAS_VIEJO = TODOS[0];

function clienteFalso() {
  const llamadas: Array<Record<string, unknown>> = [];

  const cliente: ClienteDeMensajes = {
    messages: {
      getInboxConversationMessages: async ({ query }) => {
        llamadas.push({ ...query });

        // El tope real de la API: pedir más de 100 devuelve 100.
        const limit = Math.min(query.limit ?? TAMANO_DE_PAGINA, 100);
        const desc = query.sortOrder === "desc";

        const ordenados = desc ? [...TODOS].reverse() : TODOS;
        const pagina = ordenados.slice(0, limit);

        return {
          data: {
            messages: pagina,
            pagination: {
              hasMore: ordenados.length > limit,
              nextCursor: ordenados.length > limit ? "cursor-pagina-2" : null,
            },
          },
        };
      },
    },
  };

  return { cliente, llamadas };
}

const OPTS = {
  conversationIdDeZernio: "1331828025829865",
  accountId: "6aab34cb8d284ffb210b9700",
  conversationIdLocal: "local-uuid",
};

describe("traída de los mensajes de una conversación larga", () => {
  it("incluye el mensaje más reciente", async () => {
    // EL TEST QUE IMPORTA. Con el orden ascendente y una sola página, el más
    // nuevo cae fuera y el hilo termina en agosto.
    const { cliente } = clienteFalso();
    const { messages } = await traerMensajesDeConversacion(cliente, OPTS);

    const ids = messages.map((m) => m.platform_message_id);
    expect(ids).toContain(EL_MAS_NUEVO.id);
  });

  it("termina en el mensaje más reciente, que es donde se abre un chat", async () => {
    const { cliente } = clienteFalso();
    const { messages } = await traerMensajesDeConversacion(cliente, OPTS);

    expect(messages[messages.length - 1].platform_message_id).toBe(EL_MAS_NUEVO.id);
  });

  it("los devuelve en orden cronológico, del más viejo al más nuevo", async () => {
    // Pedir `desc` es para que la API entregue los recientes; la pantalla los
    // necesita al revés. Si el revertido faltara, el hilo se leería de atrás
    // para adelante.
    const { cliente } = clienteFalso();
    const { messages } = await traerMensajesDeConversacion(cliente, OPTS);

    const fechas = messages.map((m) => m.created_at);
    expect(fechas).toEqual([...fechas].sort());
  });

  it("le pide a la API el orden descendente, que es lo que trae lo reciente", async () => {
    const { cliente, llamadas } = clienteFalso();
    await traerMensajesDeConversacion(cliente, OPTS);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ sortOrder: "desc", limit: TAMANO_DE_PAGINA });
  });

  it("avisa que hay mensajes anteriores en vez de callarse el corte", async () => {
    // La condición de esta sesión: cambiar "faltan los nuevos sin avisar" por
    // "faltan los viejos sin avisar" no sería una mejora.
    const { cliente } = clienteFalso();
    const { hayAnteriores } = await traerMensajesDeConversacion(cliente, OPTS);

    expect(hayAnteriores).toBe(true);
  });

  it("una sola llamada, sin importar el largo de la conversación", async () => {
    // 111 mensajes, una llamada. El costo no crece con el historial.
    const { cliente, llamadas } = clienteFalso();
    await traerMensajesDeConversacion(cliente, OPTS);

    expect(llamadas).toHaveLength(1);
  });

  it("no marca anteriores cuando la conversación entra entera", async () => {
    // Control positivo del aviso: 32 de las 33 conversaciones reales entran en
    // una página, y ahí el indicador NO tiene que aparecer. Sin esto, un
    // `hayAnteriores: true` fijo pasaría los tests de arriba.
    const cortas = TODOS.slice(-5);
    const cliente: ClienteDeMensajes = {
      messages: {
        getInboxConversationMessages: async () => ({
          data: {
            messages: [...cortas].reverse(),
            pagination: { hasMore: false, nextCursor: null },
          },
        }),
      },
    };

    const { messages, hayAnteriores } = await traerMensajesDeConversacion(cliente, OPTS);

    expect(hayAnteriores).toBe(false);
    expect(messages).toHaveLength(5);
    expect(messages[messages.length - 1].platform_message_id).toBe(EL_MAS_NUEVO.id);
  });

  it("no revienta con una conversación sin mensajes", async () => {
    const cliente: ClienteDeMensajes = {
      messages: {
        getInboxConversationMessages: async () => ({ data: { messages: [] } }),
      },
    };

    const { messages, hayAnteriores } = await traerMensajesDeConversacion(cliente, OPTS);
    expect(messages).toEqual([]);
    expect(hayAnteriores).toBe(false);
  });

  it("el historial viejo sigue siendo alcanzable: es lo que el indicador anuncia", async () => {
    // Deja escrito que el corte es deliberado y qué queda afuera: los 100 más
    // viejos, con el más viejo de todos entre ellos.
    const { cliente } = clienteFalso();
    const { messages } = await traerMensajesDeConversacion(cliente, OPTS);

    expect(messages).toHaveLength(TAMANO_DE_PAGINA);
    expect(messages.map((m) => m.platform_message_id)).not.toContain(EL_MAS_VIEJO.id);
  });
});
