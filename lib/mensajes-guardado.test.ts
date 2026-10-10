import { describe, it, expect } from "vitest";
import { guardarMensajes, type MensajeParaGuardar } from "./mensajes-guardado";

/**
 * F28: solo el receptor de Zernio marca un adjunto para bajar
 * (`marcarDescarga`). La importación del historial y el receptor de Evolution
 * llaman sin la opción, y lo que guardan queda con `media_intentos` sin
 * escribir (nulo en la base): el reintento no lo toma. En WhatsApp la bajada
 * todavía no existe (parte B): marcarlo haría que el reintento lo dejara
 * «no_disponible» por no tener dirección.
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
  it("sin la opción (importación, Evolution) no escribe media_intentos", async () => {
    const { supabase, filas } = capturar();
    await guardarMensajes(supabase as never, [base]);
    expect(filas[0]).toMatchObject({ media_status: "pendiente" });
    expect(filas[0]).not.toHaveProperty("media_intentos");
  });

  it("con la opción (receptor de Zernio) marca en 0 solo los entrantes con archivo", async () => {
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
