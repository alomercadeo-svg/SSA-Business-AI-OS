import { describe, it, expect } from "vitest";
import { guardarMensajes, type MensajeParaGuardar } from "./mensajes-guardado";

/**
 * F28: los dos receptores marcan un adjunto para bajar (`marcarDescarga`): el
 * de Zernio desde la parte A, y el de Evolution desde la parte B (19/10/2026),
 * solo en los entrantes de `messages.upsert` (ver `lib/evolution-guardado.test.ts`).
 * La importación del historial llama sin la opción, y lo que guarda queda con
 * `media_intentos` sin escribir (nulo en la base): el reintento no lo toma.
 */
function capturar() {
  const filas: Record<string, unknown>[] = [];
  const supabase = {
    from: () => ({
      upsert: async (v: Record<string, unknown>[]) => {
        filas.push(...v);
        return { error: null };
      },
    }),
  };
  return { supabase, filas };
}

const base: MensajeParaGuardar = {
  conversationId: "c1",
  direction: "inbound",
  platformMessageId: "p1",
  text: null,
  attachments: [{ type: "image", url: "https://cdn.ejemplo.invalid/a" }],
  messageType: "imagen",
  quotedMessageId: null,
  remoteJid: "r1",
  createdAt: "2026-10-09T10:00:00.000Z",
};

describe("guardarMensajes y la marca de descarga de F28", () => {
  it("sin la opción (la importación) no escribe media_intentos", async () => {
    const { supabase, filas } = capturar();
    await guardarMensajes(supabase as never, [base]);
    expect(filas[0]).toMatchObject({ media_status: "pendiente" });
    expect(filas[0]).not.toHaveProperty("media_intentos");
  });

  it("con la opción (los receptores) marca en 0 solo los entrantes con archivo", async () => {
    const { supabase, filas } = capturar();
    await guardarMensajes(
      supabase as never,
      [
        base,
        { ...base, platformMessageId: "p2", direction: "outbound" },
        { ...base, platformMessageId: "p3", messageType: "otro", attachments: [{ type: "share" }] },
        { ...base, platformMessageId: "p4", messageType: "texto", attachments: null },
      ],
      { marcarDescarga: true },
    );
    expect(filas.map((f) => f.media_intentos ?? null)).toEqual([0, null, null, null]);
  });
});
