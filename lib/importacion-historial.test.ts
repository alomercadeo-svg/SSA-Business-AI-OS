import { describe, it, expect, vi } from "vitest";
import { importarMensajes, TOPE_DE_PAGINAS_POR_CONVERSACION } from "./importacion-historial";

/**
 * La importación de mensajes de F27, con Zernio y la base simulados. La base
 * falsa aplica la restricción única de `messages` como la real (conversación,
 * identificador, dirección): un repetido no entra. Lo que se mira:
 *   - que recorre hasta que Zernio dice que no hay más;
 *   - que un corte a la mitad deja la conversación `pendiente` y la siguiente
 *     corrida la retoma SIN duplicar lo que ya había entrado;
 *   - que una respuesta sin lista no marca nada como completo.
 */

type Conv = {
  id: string;
  late_conversation_id: string;
  contact_id: string;
  historial_estado: string;
  last_message_at?: string | null;
  last_message_preview?: string | null;
};

function baseFalsa(convs: Conv[]) {
  const mensajes = new Map<string, Record<string, unknown>>();
  const supabase = {
    from(tabla: string) {
      const filtros: Array<[string, string, unknown]> = [];
      let actualizacion: Record<string, unknown> | null = null;
      const cadena: any = {
        select: () => cadena,
        eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), cadena),
        in: (c: string, v: unknown) => (filtros.push(["in", c, v]), cadena),
        not: () => cadena,
        update: (v: Record<string, unknown>) => ((actualizacion = v), cadena),
        upsert: (filas: Record<string, unknown>[], opciones: { ignoreDuplicates?: boolean }) => {
          for (const f of filas) {
            const clave = `${f.conversation_id}|${f.platform_message_id}|${f.direction}`;
            if (!mensajes.has(clave) || !opciones.ignoreDuplicates) mensajes.set(clave, f);
          }
          return Promise.resolve({ error: null });
        },
        then: (ok: (r: unknown) => unknown) => {
          if (tabla === "conversations" && actualizacion) {
            const id = filtros.find(([, c]) => c === "id")?.[2];
            const conv = convs.find((x) => x.id === id);
            if (conv) Object.assign(conv, actualizacion);
            return Promise.resolve({ error: null }).then(ok);
          }
          if (tabla === "conversations") {
            const estados = filtros.find(([t]) => t === "in")?.[2] as string[];
            return Promise.resolve({ data: convs.filter((c) => estados.includes(c.historial_estado)), error: null }).then(ok);
          }
          if (tabla === "contact_channels") {
            return Promise.resolve({ data: convs.map((c) => ({ contact_id: c.contact_id, platform_sender_id: `ig-${c.contact_id}` })), error: null }).then(ok);
          }
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return cadena;
    },
  };
  return { supabase, mensajes };
}

const msg = (id: string) => ({ id, message: `texto ${id}`, direction: "incoming", createdAt: "2026-09-01T10:00:00.000Z", attachments: [] });

/** Páginas por conversación de Zernio; cada llamada devuelve la siguiente. */
function zernioCon(paginas: Record<string, Array<{ messages?: unknown[]; hasMore?: boolean } | Error>>) {
  const vistas = new Map<string, number>();
  const llamada = vi.fn(async ({ path }: { path: { conversationId: string } }) => {
    const i = vistas.get(path.conversationId) ?? 0;
    vistas.set(path.conversationId, i + 1);
    const p = paginas[path.conversationId][Math.min(i, paginas[path.conversationId].length - 1)];
    if (p instanceof Error) throw p;
    return { data: { messages: p.messages, pagination: { hasMore: p.hasMore ?? false, nextCursor: p.hasMore ? `cur-${i + 1}` : null } } };
  });
  return { zernio: { messages: { getInboxConversationMessages: llamada } }, llamada };
}

const canal = { id: "ch-1", late_account_id: "acc-1", platform: "instagram" };
const conv = (id: string, estado = "pendiente"): Conv => ({ id, late_conversation_id: `z-${id}`, contact_id: `ct-${id}`, historial_estado: estado });

describe("importación de mensajes (F27)", () => {
  it("recorre todas las páginas hacia atrás y marca la conversación completa recién al final", async () => {
    const convs = [conv("a")];
    const { supabase, mensajes } = baseFalsa(convs);
    const { zernio, llamada } = zernioCon({
      "z-a": [
        { messages: [msg("m3"), msg("m2")], hasMore: true },
        { messages: [msg("m1")], hasMore: false },
      ],
    });
    const r = await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(llamada).toHaveBeenCalledTimes(2);
    expect(llamada.mock.calls[1][0]).toMatchObject({ query: { sortOrder: "desc", limit: 100, cursor: "cur-1" } });
    expect(mensajes.size).toBe(3);
    expect(convs[0].historial_estado).toBe("completo");
    expect(r).toMatchObject({ completas: 1, mensajes: 3 });
    expect([...mensajes.values()][0]).toMatchObject({ remote_jid: "ig-ct-a", direction: "inbound" });
  });

  it("un corte a la mitad deja la conversación pendiente; la siguiente corrida la retoma sin duplicar", async () => {
    const convs = [conv("a"), conv("b")];
    const { supabase, mensajes } = baseFalsa(convs);
    const primera = zernioCon({
      "z-a": [{ messages: [msg("a1")], hasMore: false }],
      "z-b": [{ messages: [msg("b3"), msg("b2")], hasMore: true }, Object.assign(new Error("Zernio 500"), { statusCode: 500 })],
    });
    const r1 = await importarMensajes({ supabase: supabase as never, zernio: primera.zernio, channels: [canal] });
    expect(r1).toMatchObject({ completas: 1, conError: 1 });
    expect(convs.map((c) => c.historial_estado)).toEqual(["completo", "pendiente"]);
    expect(mensajes.size).toBe(3);

    // Segunda corrida: solo pide la que quedó pendiente, y vuelve a traer b3 y
    // b2, que la restricción deja una vez.
    const segunda = zernioCon({
      "z-b": [{ messages: [msg("b3"), msg("b2")], hasMore: true }, { messages: [msg("b1")], hasMore: false }],
    });
    const r2 = await importarMensajes({ supabase: supabase as never, zernio: segunda.zernio, channels: [canal] });
    expect(segunda.llamada.mock.calls.every(([o]) => o.path.conversationId === "z-b")).toBe(true);
    expect(r2).toMatchObject({ completas: 1 });
    expect(convs[1].historial_estado).toBe("completo");
    expect(mensajes.size).toBe(4);
  });

  it("una respuesta sin lista de mensajes no marca la conversación como completa", async () => {
    const convs = [conv("a")];
    const { supabase } = baseFalsa(convs);
    const { zernio } = zernioCon({ "z-a": [{ messages: undefined, hasMore: false }] });
    const r = await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(convs[0].historial_estado).toBe("pendiente");
    expect(r.conError).toBe(1);
  });

  it("si Zernio no tiene la conversación (404), queda no_disponible", async () => {
    const convs = [conv("a")];
    const { supabase } = baseFalsa(convs);
    const { zernio } = zernioCon({ "z-a": [Object.assign(new Error("no existe"), { statusCode: 404 })] });
    await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(convs[0].historial_estado).toBe("no_disponible");
  });

  it("si llega al tope de páginas, queda incompleta, que se ve distinto de completa", async () => {
    const convs = [conv("a")];
    const { supabase } = baseFalsa(convs);
    const { zernio, llamada } = zernioCon({ "z-a": [{ messages: [msg("x")], hasMore: true }] });
    const r = await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(llamada).toHaveBeenCalledTimes(TOPE_DE_PAGINAS_POR_CONVERSACION);
    expect(convs[0].historial_estado).toBe("incompleto");
    expect(r.incompletas).toBe(1);
  });

  it("ante 429 repetidos corta la corrida y deja el resto pendiente", async () => {
    const convs = [conv("a"), conv("b")];
    const { supabase } = baseFalsa(convs);
    const { zernio } = zernioCon({
      "z-a": [Object.assign(new Error("rate"), { statusCode: 429 })],
      "z-b": [{ messages: [msg("b1")], hasMore: false }],
    });
    const r = await importarMensajes({ supabase: supabase as never, zernio, channels: [canal], esperaAnte429Ms: 0 });
    expect(r.cortadaPorLimite).toBe(true);
    expect(convs.map((c) => c.historial_estado)).toEqual(["pendiente", "pendiente"]);
  });

  it("solo toma las conversaciones que no están completas", async () => {
    const convs = [conv("a", "completo"), conv("b", "incompleto")];
    const { supabase } = baseFalsa(convs);
    const { zernio, llamada } = zernioCon({ "z-b": [{ messages: [msg("b1")], hasMore: false }] });
    await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(llamada).toHaveBeenCalledTimes(1);
    expect(llamada.mock.calls[0][0].path.conversationId).toBe("z-b");
  });

  /**
   * La importación adelanta la fecha y el preview de la conversación con el
   * mensaje más nuevo que guarda, y nunca los atrasa. Escrito en rojo el
   * 08/10/2026: la importación de ese día dejó 52 conversaciones con
   * `last_message_at` más viejo que su último mensaje guardado.
   */
  it("una conversación existente con un mensaje más nuevo que su fecha: adelanta last_message_at y el preview", async () => {
    const c = { ...conv("a"), last_message_at: "2026-09-21T14:39:53.000Z", last_message_preview: "viejo" };
    const { supabase } = baseFalsa([c]);
    const nuevo = { ...msg("m2"), message: "lo último", createdAt: "2026-10-07T04:45:53.000Z" };
    const viejo = { ...msg("m1"), createdAt: "2026-09-01T10:00:00.000Z" };
    const { zernio } = zernioCon({ "z-a": [{ messages: [nuevo, viejo], hasMore: false }] });
    await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(c.last_message_at).toBe("2026-10-07T04:45:53.000Z");
    expect(c.last_message_preview).toBe("lo último");
  });

  it("nunca atrasa: si la fecha de la conversación es más nueva que todo lo importado, queda igual", async () => {
    const c = { ...conv("a"), last_message_at: "2026-10-08T21:00:00.000Z", last_message_preview: "reciente" };
    const { supabase } = baseFalsa([c]);
    const { zernio } = zernioCon({ "z-a": [{ messages: [msg("m1")], hasMore: false }] });
    await importarMensajes({ supabase: supabase as never, zernio, channels: [canal] });
    expect(c.last_message_at).toBe("2026-10-08T21:00:00.000Z");
    expect(c.last_message_preview).toBe("reciente");
  });
});

