import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chequearSesionesDelEspacio, leerSesionDeEvolution, tieneOwnerJid } from "./chequeo-sesion-whatsapp";

/**
 * El chequeo periódico de F32 contra un Evolution simulado. Lo que NO prueba:
 * que nuestro Evolution conteste así. Eso lo dice su código (2.3.7, leído el
 * 02/11/2026) y lo comprueba la primera corrida real.
 */

const URL_EVO = "https://evolution.ejemplo";

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status });
}

describe("leerSesionDeEvolution", () => {
  it("pide connectionState con el token de la instancia y lee el estado (control positivo)", async () => {
    const llamadas: Array<{ url: string; apikey: string | null }> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url, apikey: new Headers(init?.headers).get("apikey") });
      return respuesta(200, { instance: { instanceName: "mi-inst", state: "open" } });
    });
    const l = await leerSesionDeEvolution("mi-inst", "token-x", { url: URL_EVO, fetch: f as never });
    expect(l).toEqual({ tipo: "estado", estado: "open" });
    expect(llamadas).toEqual([{ url: `${URL_EVO}/instance/connectionState/mi-inst`, apikey: "token-x" }]);
  });

  it("un 401 es «no se pudo verificar», con el código como motivo", async () => {
    const l = await leerSesionDeEvolution("x", "t", { url: URL_EVO, fetch: (async () => respuesta(401, {})) as never });
    expect(l).toEqual({ tipo: "sin_verificar", motivo: "http_401" });
  });

  it("sin state (instancia no cargada) es «no se pudo verificar», nunca desconectado", async () => {
    const l = await leerSesionDeEvolution("x", "t", { url: URL_EVO, fetch: (async () => respuesta(200, { instance: { instanceName: "x" } })) as never });
    expect(l).toEqual({ tipo: "sin_verificar", motivo: "sin_state" });
  });

  it("sin respuesta es «no se pudo verificar»", async () => {
    const l = await leerSesionDeEvolution("x", "t", {
      url: URL_EVO,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as never,
    });
    expect(l).toEqual({ tipo: "sin_verificar", motivo: "sin_respuesta" });
  });
});

describe("tieneOwnerJid", () => {
  it("true con un ownerJid no vacío en fetchInstances (control positivo)", async () => {
    const f = vi.fn(async (_url: string) => respuesta(200, [{ name: "x", ownerJid: "5491100000000@s.whatsapp.net", token: "NO-SE-USA" }]));
    expect(await tieneOwnerJid("x", "t", { url: URL_EVO, fetch: f as never })).toBe(true);
    expect(f.mock.calls[0][0]).toBe(`${URL_EVO}/instance/fetchInstances?instanceName=x`);
  });

  it("false con ownerJid vacío, con error o sin respuesta", async () => {
    expect(await tieneOwnerJid("x", "t", { url: URL_EVO, fetch: (async () => respuesta(200, [{ ownerJid: null }])) as never })).toBe(false);
    expect(await tieneOwnerJid("x", "t", { url: URL_EVO, fetch: (async () => respuesta(404, {})) as never })).toBe(false);
    expect(
      await tieneOwnerJid("x", "t", {
        url: URL_EVO,
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as never,
      }),
    ).toBe(false);
  });
});

describe("chequearSesionesDelEspacio", () => {
  /** `channels` con los canales de Evolution del espacio; la escritura va por `registrar`. */
  function servicioCon(canales: Array<Record<string, unknown>>) {
    const servicio = {
      from() {
        const q: any = {
          select: () => q,
          eq: () => q,
          then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: canales, error: null }).then(ok),
        };
        return q;
      },
    };
    return servicio as unknown as SupabaseClient;
  }

  const CANAL = { id: "c-wa", instance_name: "mi-inst", session_linked_at: null };

  it("lee cada canal, guarda la lectura y avisa la transición que lo pide", async () => {
    const registrar = vi.fn(async () => ({ canalId: "c-wa", workspaceId: "ws-1", de: "conectado", a: "caido", avisar: true }));
    const notificar = vi.fn(async () => null);
    const r = await chequearSesionesDelEspacio({
      servicio: servicioCon([{ ...CANAL, session_linked_at: "2026-11-01T00:00:00Z" }]),
      workspaceId: "ws-1",
      ahora: new Date(),
      leerToken: async () => "token-x",
      leerEstado: async () => ({ tipo: "estado", estado: "close" }),
      leerOwnerJid: async () => false,
      registrar: registrar as never,
      notificar,
    });
    expect(registrar).toHaveBeenCalledWith(expect.anything(), "c-wa", { tipo: "estado", estado: "close" }, expect.any(Date), false);
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(r.canales).toEqual([{ id: "c-wa", lectura: "close", estado: "caido", error: null }]);
  });

  it("sin credencial no llama a Evolution: «no se pudo verificar» con motivo sin_credencial", async () => {
    const leerEstado = vi.fn();
    const registrar = vi.fn(async () => null);
    await chequearSesionesDelEspacio({
      servicio: servicioCon([CANAL]),
      workspaceId: "ws-1",
      ahora: new Date(),
      leerToken: async () => null,
      leerEstado: leerEstado as never,
      leerOwnerJid: vi.fn() as never,
      registrar: registrar as never,
      notificar: vi.fn(),
    });
    expect(leerEstado).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(expect.anything(), "c-wa", { tipo: "sin_verificar", motivo: "sin_credencial" }, expect.any(Date), false);
  });

  it("sin marca y sin open, mira el ownerJid; con marca, no lo pide", async () => {
    const leerOwnerJid = vi.fn(async () => true);
    const registrar = vi.fn(async () => null);
    const base = {
      workspaceId: "ws-1",
      ahora: new Date(),
      leerToken: async () => "t",
      leerEstado: async () => ({ tipo: "estado" as const, estado: "close" as const }),
      leerOwnerJid,
      registrar: registrar as never,
      notificar: vi.fn(),
    };
    await chequearSesionesDelEspacio({ ...base, servicio: servicioCon([CANAL]) });
    expect(leerOwnerJid).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenLastCalledWith(expect.anything(), "c-wa", { tipo: "estado", estado: "close" }, expect.any(Date), true);

    await chequearSesionesDelEspacio({ ...base, servicio: servicioCon([{ ...CANAL, session_linked_at: "2026-11-01T00:00:00Z" }]) });
    expect(leerOwnerJid).toHaveBeenCalledTimes(1);
  });

  it("sin transición que avise, no hay correo", async () => {
    const notificar = vi.fn();
    await chequearSesionesDelEspacio({
      servicio: servicioCon([CANAL]),
      workspaceId: "ws-1",
      ahora: new Date(),
      leerToken: async () => "t",
      leerEstado: async () => ({ tipo: "sin_verificar", motivo: "http_401" }),
      leerOwnerJid: async () => false,
      registrar: (async () => ({ canalId: "c-wa", workspaceId: "ws-1", de: "conectado", a: "sin_verificar", avisar: false })) as never,
      notificar,
    });
    expect(notificar).not.toHaveBeenCalled();
  });

  it("un canal que falla no frena a los demás, y queda su error", async () => {
    const registrar = vi.fn(async (_s: unknown, id: string) => {
      if (id === "c-1") throw new Error("channels: caído");
      return null;
    });
    const r = await chequearSesionesDelEspacio({
      servicio: servicioCon([{ ...CANAL, id: "c-1" }, { ...CANAL, id: "c-2" }]),
      workspaceId: "ws-1",
      ahora: new Date(),
      leerToken: async () => "t",
      leerEstado: async () => ({ tipo: "estado", estado: "open" }),
      leerOwnerJid: async () => false,
      registrar: registrar as never,
      notificar: vi.fn(),
    });
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(r.canales.map((c) => c.error)).toEqual(["channels: caído", null]);
  });
});
