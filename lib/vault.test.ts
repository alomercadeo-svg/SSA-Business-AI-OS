import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SECRET_NAMES,
  __clearSecretCache,
  deleteWorkspaceSecret,
  getAiGatewayKey,
  getWorkspaceSecret,
  getZernioApiKey,
  hasWorkspaceSecret,
  invalidateWorkspaceSecret,
  setWorkspaceSecret,
} from "./vault";

const WS = "11111111-1111-1111-1111-111111111111";
const WS_2 = "22222222-2222-2222-2222-222222222222";

/** Cliente falso que registra las llamadas a rpc y devuelve lo que se le indique. */
function fakeClient(respuestas: Array<{ data?: unknown; error?: { message: string } }>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let i = 0;
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const r = respuestas[Math.min(i, respuestas.length - 1)];
      i++;
      return { data: r.data ?? null, error: r.error ?? null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls, rpc: client.rpc };
}

beforeEach(() => {
  __clearSecretCache();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getWorkspaceSecret", () => {
  it("devuelve el valor y lo pide con el nombre y el workspace correctos", async () => {
    const { client, calls } = fakeClient([{ data: "sk_abc" }]);

    const v = await getWorkspaceSecret(client, WS, "zernio_api_key");

    expect(v).toBe("sk_abc");
    expect(calls).toEqual([
      { fn: "read_secret", args: { secret_name: "zernio_api_key", workspace_id: WS } },
    ]);
  });

  it("devuelve null cuando el secret no está configurado", async () => {
    const { client } = fakeClient([{ data: null }]);
    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBeNull();
  });

  // Los llamadores son webhooks y trabajos de fondo: un error de permisos no
  // puede tirar abajo la entrega, tiene que comportarse como "no hay clave".
  it("ante un error devuelve null y no lanza", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([{ error: { message: "no autorizado" } }]);

    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it("no loguea el valor del secret cuando falla", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([{ error: { message: "boom" } }]);

    await getWorkspaceSecret(client, WS, "zernio_api_key");

    const logueado = err.mock.calls.flat().join(" ");
    expect(logueado).not.toContain("sk_");
  });
});

describe("caché", () => {
  it("una segunda lectura no vuelve a la base", async () => {
    const { client, rpc } = fakeClient([{ data: "sk_abc" }]);

    await getWorkspaceSecret(client, WS, "zernio_api_key");
    const segunda = await getWorkspaceSecret(client, WS, "zernio_api_key");

    expect(segunda).toBe("sk_abc");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("cachea también la ausencia, para no golpear la base en cada mensaje", async () => {
    const { client, rpc } = fakeClient([{ data: null }]);

    await getWorkspaceSecret(client, WS, "zernio_api_key");
    await getWorkspaceSecret(client, WS, "zernio_api_key");

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("no mezcla workspaces", async () => {
    const { client, rpc } = fakeClient([{ data: "de-ws-1" }, { data: "de-ws-2" }]);

    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBe("de-ws-1");
    expect(await getWorkspaceSecret(client, WS_2, "zernio_api_key")).toBe("de-ws-2");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("no mezcla secrets distintos del mismo workspace", async () => {
    const { client, rpc } = fakeClient([{ data: "zernio" }, { data: "ia" }]);

    expect(await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBe("zernio");
    expect(await getWorkspaceSecret(client, WS, SECRET_NAMES.aiGateway)).toBe("ia");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("expira al minuto", async () => {
    vi.useFakeTimers();
    const { client, rpc } = fakeClient([{ data: "vieja" }, { data: "nueva" }]);

    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBe("vieja");
    vi.advanceTimersByTime(59_000);
    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBe("vieja");
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(await getWorkspaceSecret(client, WS, "zernio_api_key")).toBe("nueva");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("invalidateWorkspaceSecret borra solo el secret indicado", async () => {
    const { client, rpc } = fakeClient([{ data: "a" }]);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.aiGateway);
    expect(rpc).toHaveBeenCalledTimes(2);

    invalidateWorkspaceSecret(WS, SECRET_NAMES.zernio);

    await getWorkspaceSecret(client, WS, SECRET_NAMES.aiGateway); // sigue cacheado
    expect(rpc).toHaveBeenCalledTimes(2);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio); // se relee
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("invalidateWorkspaceSecret sin nombre borra todo el workspace, y solo ese", async () => {
    const { client, rpc } = fakeClient([{ data: "a" }]);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.aiGateway);
    await getWorkspaceSecret(client, WS_2, SECRET_NAMES.zernio);
    expect(rpc).toHaveBeenCalledTimes(3);

    invalidateWorkspaceSecret(WS);

    await getWorkspaceSecret(client, WS_2, SECRET_NAMES.zernio); // intacto
    expect(rpc).toHaveBeenCalledTimes(3);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio);
    await getWorkspaceSecret(client, WS, SECRET_NAMES.aiGateway);
    expect(rpc).toHaveBeenCalledTimes(5);
  });
});

describe("setWorkspaceSecret", () => {
  it("guarda y devuelve error null", async () => {
    const { client, calls } = fakeClient([{ data: "uuid-del-secret" }]);

    const r = await setWorkspaceSecret(client, WS, SECRET_NAMES.zernio, "sk_nueva");

    expect(r.error).toBeNull();
    expect(calls[0]).toEqual({
      fn: "store_secret",
      args: { secret_name: "zernio_api_key", secret_value: "sk_nueva", workspace_id: WS },
    });
  });

  // Sin esto, el motor de flujos seguiría usando la clave vieja hasta un minuto
  // después de rotarla, y todos los envíos fallarían sin explicación.
  it("guardar invalida lo cacheado", async () => {
    const { client, rpc } = fakeClient([{ data: "vieja" }, { data: null }, { data: "nueva" }]);

    expect(await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBe("vieja");
    await setWorkspaceSecret(client, WS, SECRET_NAMES.zernio, "nueva");
    expect(await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBe("nueva");

    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("propaga el mensaje de error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([{ error: { message: "no autorizado" } }]);

    const r = await setWorkspaceSecret(client, WS, SECRET_NAMES.zernio, "x");
    expect(r.error).toBe("no autorizado");
  });

  it("no loguea el valor que se intentó guardar", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([{ error: { message: "boom" } }]);

    await setWorkspaceSecret(client, WS, SECRET_NAMES.zernio, "sk_supersecreta");

    expect(err.mock.calls.flat().join(" ")).not.toContain("sk_supersecreta");
  });
});

describe("deleteWorkspaceSecret", () => {
  it("borra e invalida lo cacheado", async () => {
    const { client, calls, rpc } = fakeClient([{ data: "algo" }, { data: true }, { data: null }]);

    await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio);
    await deleteWorkspaceSecret(client, WS, SECRET_NAMES.zernio);
    expect(await getWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBeNull();

    expect(calls[1].fn).toBe("delete_secret");
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("atajos por integración", () => {
  it("getZernioApiKey pide zernio_api_key", async () => {
    const { client, calls } = fakeClient([{ data: "sk_zernio" }]);
    expect(await getZernioApiKey(client, WS)).toBe("sk_zernio");
    expect(calls[0].args.secret_name).toBe("zernio_api_key");
  });

  it("getAiGatewayKey pide ai_gateway_api_key y no cae al entorno", async () => {
    const { client, calls } = fakeClient([{ data: null }]);
    const previo = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "del-entorno";
    try {
      // El fallback al entorno es responsabilidad del nodo de IA, no de este módulo.
      expect(await getAiGatewayKey(client, WS)).toBeNull();
      expect(calls[0].args.secret_name).toBe("ai_gateway_api_key");
    } finally {
      if (previo === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = previo;
    }
  });

  it("hasWorkspaceSecret no devuelve el valor", async () => {
    const { client } = fakeClient([{ data: "sk_abc" }]);
    expect(await hasWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBe(true);
  });

  it("hasWorkspaceSecret es false cuando no está configurado", async () => {
    const { client } = fakeClient([{ data: null }]);
    expect(await hasWorkspaceSecret(client, WS, SECRET_NAMES.zernio)).toBe(false);
  });
});
