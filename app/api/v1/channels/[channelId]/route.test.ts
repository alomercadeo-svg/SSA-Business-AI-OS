import { describe, it, expect, vi } from "vitest";

/**
 * `DELETE /api/v1/channels/[channelId]` ya no borra nada: responde 405.
 *
 * La ruta heredada del fork desconectaba la cuenta en Zernio y borraba la fila
 * del canal, que arrastraba en cascada sus conversaciones y mensajes. El
 * historial vive en la base local por decisión cerrada. El único camino para
 * desconectar es la acción de F24, que marca el canal inactivo y no borra.
 *
 * El test no solo mira el 405: comprueba que no se llegó a resolver la sesión,
 * ni a leer la clave de Zernio, ni a crear el cliente. Se vio en rojo con la
 * ruta vieja.
 */

const h = vi.hoisted(() => ({
  requireManager: vi.fn(async () => ({
    contexto: {
      workspace: { id: "ws-1" },
      supabase: {
        from: () => {
          const c = {
            select: () => c,
            eq: () => c,
            single: async () => ({ data: { id: "ch-1", late_account_id: "acc-1" }, error: null }),
            delete: () => c,
            then: (ok: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(ok),
          };
          return c;
        },
      },
    },
    error: null,
  })),
  getZernioApiKey: vi.fn(async () => "zk"),
  createZernioClient: vi.fn(() => ({ accounts: { deleteAccount: vi.fn(async () => ({ data: {} })) } })),
}));

vi.mock("@/lib/workspace", () => ({ requireManager: h.requireManager }));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: h.getZernioApiKey }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: h.createZernioClient }));

const ruta = await import("./route");

// Se la llama como la llama Next, con el pedido y los parámetros, aunque la
// versión actual no los use: así el mismo test sirvió contra la ruta vieja.
const llamar = () =>
  (ruta.DELETE as (req: Request, ctx: { params: Promise<{ channelId: string }> }) => Promise<Response>)(
    new Request("http://localhost/api/v1/channels/ch-1", { method: "DELETE" }),
    { params: Promise.resolve({ channelId: "ch-1" }) }
  );

describe("DELETE /api/v1/channels/[channelId]", () => {
  it("responde 405 y no hace nada", async () => {
    const res = await llamar();
    expect(res.status).toBe(405);
    expect(h.requireManager).not.toHaveBeenCalled();
    expect(h.getZernioApiKey).not.toHaveBeenCalled();
    expect(h.createZernioClient).not.toHaveBeenCalled();
  });

  it("dice adónde ir para desconectar", async () => {
    const res = await llamar();
    expect(JSON.stringify(await res.json())).toMatch(/integraciones/i);
  });
});
