import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** F40 (ítem 6): la ruta de la respuesta privada, solo para Owner y Admin; el resto lo prueba lib/respuesta-privada.test.ts. */
const h = vi.hoisted(() => ({ rol: "member", llamadas: 0 }));
vi.mock("@/lib/asignacion", () => ({ origenPermitido: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/respuesta-privada-servidor", () => ({ dependenciasDeRespuesta: () => ({}) }));
vi.mock("@/lib/respuesta-privada", () => ({
  enviarRespuestaPrivada: async () => {
    h.llamadas++;
    return { status: 200, messageId: "m-1" };
  },
}));
vi.mock("@/lib/workspace", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireManager: async () =>
      h.rol === "member"
        ? { contexto: null, error: NextResponse.json({ error: "Requiere rol de Owner o Admin" }, { status: 403 }) }
        : { contexto: { workspace: { id: "ws-1" } }, error: null },
  };
});

const pedido = () => new NextRequest("https://app.ejemplo/api", { method: "POST", body: JSON.stringify({ mensaje: "hola" }), headers: { "content-type": "application/json" } });
const params = { params: Promise.resolve({ comentarioId: "cl-1" }) };

beforeEach(() => {
  h.llamadas = 0;
});

describe("POST /api/v1/comentarios/<id>/respuesta-privada", () => {
  it("un Member recibe 403 y no se intenta nada", async () => {
    h.rol = "member";
    const { POST } = await import("./route");
    expect((await POST(pedido(), params)).status).toBe(403);
    expect(h.llamadas).toBe(0);
  });
  it("control: un Admin llega al envío", async () => {
    h.rol = "admin";
    const { POST } = await import("./route");
    expect((await POST(pedido(), params)).status).toBe(200);
    expect(h.llamadas).toBe(1);
  });
});
