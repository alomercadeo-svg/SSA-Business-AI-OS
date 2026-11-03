import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * «Reconectar» y «Vincular número» (F32): la acción que le pide el código QR a
 * Evolution. Solo Owner y Admin, y solo para un canal de Evolution del propio
 * espacio. Evolution está simulado: esta acción NO se aprieta sobre la
 * instancia real en S7 (genera códigos y puede dejarla en «se agotaron los
 * intentos»).
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  canal: { id: "c-wa", instance_name: "mi-inst" } as Record<string, unknown> | null,
  token: "token-x" as string | null,
  pedidos: [] as Array<[string, string]>,
  filtros: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspaceOrNull: async () => ({
    workspace: { id: "ws-1" },
    user: { id: "u-1" },
    role: h.rol,
    supabase: {
      from: () => {
        const c = {
          select: () => c,
          eq: (col: string, v: unknown) => (h.filtros.push([col, v]), c),
          maybeSingle: async () => ({ data: h.canal, error: null }),
        };
        return c;
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  getWorkspaceSecret: async () => h.token,
}));
vi.mock("@/lib/sesion-whatsapp-pantalla", async (original) => ({
  ...(await original<typeof import("@/lib/sesion-whatsapp-pantalla")>()),
  pedirCodigoQR: async (instancia: string, token: string) => {
    h.pedidos.push([instancia, token]);
    return { tipo: "qr", imagen: "data:image/png;base64,AAAA" };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { pedirCodigoWhatsapp } = await import("./canales");

beforeEach(() => {
  h.rol = "owner";
  h.canal = { id: "c-wa", instance_name: "mi-inst" };
  h.token = "token-x";
  h.pedidos.length = 0;
  h.filtros.length = 0;
  process.env.EVOLUTION_API_URL = "https://evo.ejemplo";
});

describe("pedirCodigoWhatsapp", () => {
  it("un Owner recibe el código, pedido con el token de la instancia (control positivo)", async () => {
    expect(await pedirCodigoWhatsapp("c-wa")).toEqual({ tipo: "qr", imagen: "data:image/png;base64,AAAA" });
    expect(h.pedidos).toEqual([["mi-inst", "token-x"]]);
  });

  it("un Admin también", async () => {
    h.rol = "admin";
    expect((await pedirCodigoWhatsapp("c-wa")).tipo).toBe("qr");
  });

  it("un Member no, y no se le pide nada a Evolution", async () => {
    h.rol = "member";
    expect(await pedirCodigoWhatsapp("c-wa")).toEqual({ tipo: "error", motivo: "permiso" });
    expect(h.pedidos).toHaveLength(0);
  });

  /**
   * Los filtros los aplica la base, así que el doble no puede devolver vacío
   * por su cuenta: se comprueba que la consulta los pida. Sin esto, sacar el de
   * `provider` o el de `workspace_id` seguía en verde (visto el 03/11/2026, S7
   * tramo 2).
   */
  it("un canal que no es de Evolution del espacio no pide nada", async () => {
    h.canal = null;
    expect(await pedirCodigoWhatsapp("otro")).toEqual({ tipo: "error", motivo: "canal" });
    expect(h.pedidos).toHaveLength(0);
    expect(h.filtros).toEqual(
      expect.arrayContaining([
        ["id", "otro"],
        ["workspace_id", "ws-1"],
        ["provider", "evolution"],
      ]),
    );
  });

  it("sin credencial no llama a Evolution y lo dice", async () => {
    h.token = null;
    expect(await pedirCodigoWhatsapp("c-wa")).toEqual({ tipo: "error", motivo: "sin_credencial" });
    expect(h.pedidos).toHaveLength(0);
  });

  it("sin EVOLUTION_API_URL no llama a Evolution y lo dice", async () => {
    delete process.env.EVOLUTION_API_URL;
    expect(await pedirCodigoWhatsapp("c-wa")).toEqual({ tipo: "error", motivo: "sin_configurar" });
    expect(h.pedidos).toHaveLength(0);
  });
});
