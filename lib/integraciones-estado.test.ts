import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La detección del estado de las integraciones (F24), con la red simulada.
 * Ninguna llamada real a ningún proveedor.
 *
 * La regla que más importa: "sin verificar" es "no se pudo preguntar", y nunca
 * se convierte en "desconectado". Por eso hay un test por cada forma de no
 * poder preguntar: red caída, tiempo agotado, error del proveedor, límite de
 * consultas.
 *
 * Se vieron en rojo antes de escribir `lib/integraciones-estado.ts`.
 */

const h = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  secretos: {} as Record<string, string | null>,
}));

vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { listAccounts: h.listAccounts } }),
}));

vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  getWorkspaceSecret: async (_s: unknown, _ws: string, nombre: string) => h.secretos[nombre] ?? null,
}));

const { estadoPorHttp, estadoPorFallo, consultarProveedor, verificarTodas, registrarFalloDeZernio } = await import(
  "./integraciones-estado"
);

const fetchFalso = vi.fn();
const respuesta = (status: number, cuerpo: unknown = {}) => {
  const json = vi.fn(async () => cuerpo);
  return { status, ok: status >= 200 && status < 300, json };
};

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
  h.listAccounts.mockReset();
  h.secretos = {};
  delete process.env.EVOLUTION_API_URL;
});

afterEach(() => vi.unstubAllGlobals());

describe("de la respuesta HTTP al estado", () => {
  it("2xx es conectado; 401 y 403 son desconectado", () => {
    expect(estadoPorHttp(200).estado).toBe("conectado");
    expect(estadoPorHttp(401).estado).toBe("desconectado");
    expect(estadoPorHttp(403).estado).toBe("desconectado");
  });

  it("un error del proveedor o un límite de consultas es sin verificar, nunca desconectado", () => {
    for (const s of [429, 500, 502, 503, 404]) expect(estadoPorHttp(s).estado).toBe("sin_verificar");
  });
});

describe("de un fallo de una operación real al estado", () => {
  it("credenciales rechazadas: desconectado", () => {
    expect(estadoPorFallo(Object.assign(new Error("x"), { statusCode: 401 }))?.estado).toBe("desconectado");
    expect(estadoPorFallo(Object.assign(new Error("x"), { statusCode: 403 }))?.estado).toBe("desconectado");
  });

  it("red caída, tiempo agotado o error del proveedor: sin verificar", () => {
    expect(estadoPorFallo(new TypeError("fetch failed"))?.estado).toBe("sin_verificar");
    expect(estadoPorFallo(Object.assign(new Error("t"), { name: "TimeoutError" }))?.estado).toBe("sin_verificar");
    expect(estadoPorFallo(Object.assign(new Error("x"), { statusCode: 503 }))?.estado).toBe("sin_verificar");
  });

  it("un fallo que no es de credenciales ni de conexión no toca el estado", () => {
    expect(estadoPorFallo(Object.assign(new Error("x"), { statusCode: 400 }))).toBeNull();
    expect(estadoPorFallo(Object.assign(new Error("x"), { statusCode: 404 }))).toBeNull();
  });
});

describe("la consulta a cada proveedor", () => {
  it("Resend: lista los dominios con Bearer y dice cuál está verificado", async () => {
    fetchFalso.mockResolvedValue(respuesta(200, { data: [{ name: "notificaciones.alomercadeo.com", status: "verified" }] }));
    const r = await consultarProveedor("resend", "re_clave");
    expect(fetchFalso).toHaveBeenCalledWith("https://api.resend.com/domains", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer re_clave" }),
    }));
    expect(r.estado).toBe("conectado");
    expect(r.detalle).toContain("notificaciones.alomercadeo.com");
  });

  it("Anthropic: x-api-key y anthropic-version, como dice su referencia", async () => {
    fetchFalso.mockResolvedValue(respuesta(200));
    await consultarProveedor("anthropic", "clave-a");
    expect(fetchFalso).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ "x-api-key": "clave-a", "anthropic-version": "2023-06-01" }),
    }));
  });

  it("OpenAI con 401: desconectado, y el error no incluye la clave", async () => {
    fetchFalso.mockResolvedValue(respuesta(401));
    const r = await consultarProveedor("openai", "sk-CLAVESECRETA");
    expect(r.estado).toBe("desconectado");
    expect(JSON.stringify(r)).not.toContain("CLAVESECRETA");
  });

  it("Google: la clave va en el parámetro key, como en su referencia", async () => {
    fetchFalso.mockResolvedValue(respuesta(200));
    await consultarProveedor("google", "clave-g");
    expect(fetchFalso.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/models?key=clave-g");
  });

  it("si la red falla, sin verificar: no se pudo preguntar", async () => {
    fetchFalso.mockRejectedValue(new TypeError("fetch failed"));
    const r = await consultarProveedor("openai", "sk-x");
    expect(r.estado).toBe("sin_verificar");
  });

  it("Evolution sin EVOLUTION_API_URL: sin configurar, sin llamar a nada", async () => {
    const r = await consultarProveedor("evolution", "clave-e");
    expect(r.estado).toBe("sin_configurar");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("Evolution nunca lee el cuerpo de la respuesta: trae el token de la instancia", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.ejemplo";
    const res = respuesta(200, [{ token: "TOKEN-DE-INSTANCIA" }]);
    fetchFalso.mockResolvedValue(res);
    const r = await consultarProveedor("evolution", "clave-e");
    expect(fetchFalso).toHaveBeenCalledWith("https://evo.ejemplo/instance/fetchInstances", expect.objectContaining({
      headers: expect.objectContaining({ apikey: "clave-e" }),
    }));
    expect(res.json).not.toHaveBeenCalled();
    expect(r.estado).toBe("conectado");
    expect(JSON.stringify(r)).not.toContain("TOKEN");
  });

  it("Zernio: pregunta con listAccounts, que es lo que ya usa la conexión", async () => {
    h.listAccounts.mockResolvedValue({ data: { accounts: [{}, {}] } });
    expect((await consultarProveedor("zernio", "zk")).estado).toBe("conectado");
    h.listAccounts.mockRejectedValue(Object.assign(new Error("no"), { statusCode: 401 }));
    expect((await consultarProveedor("zernio", "zk")).estado).toBe("desconectado");
    h.listAccounts.mockRejectedValue(new TypeError("fetch failed"));
    expect((await consultarProveedor("zernio", "zk")).estado).toBe("sin_verificar");
  });

  it("un proveedor sin forma de consultarlo queda sin verificar, no conectado", async () => {
    expect((await consultarProveedor("telegram", "x")).estado).toBe("sin_verificar");
  });
});

function supabaseFalso(filas: { proveedor: string; tipo: string; nombre: string; config?: unknown }[]) {
  const updates: { proveedor: string; valores: Record<string, unknown> }[] = [];
  return {
    updates,
    from() {
      let valores: Record<string, unknown> | null = null;
      const cadena = {
        select: () => cadena,
        update: (v: Record<string, unknown>) => {
          valores = v;
          return cadena;
        },
        eq: (col: string, val: string) => {
          if (valores && col === "proveedor") updates.push({ proveedor: val, valores });
          return cadena;
        },
        then: (ok: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: valores ? null : filas, error: null }).then(ok),
      };
      return cadena;
    },
  };
}

describe("verificar todas al abrir la pantalla", () => {
  it("sin clave es sin configurar, y cada fila queda con fecha de verificación", async () => {
    const s = supabaseFalso([{ proveedor: "openai", tipo: "ia", nombre: "OpenAI" }]);
    await verificarTodas(s as never, "ws-1");
    expect(s.updates).toHaveLength(1);
    expect(s.updates[0].valores).toMatchObject({ estado: "sin_configurar" });
    expect(s.updates[0].valores.verificado_el).toEqual(expect.any(String));
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("con clave consulta al proveedor y escribe lo que respondió", async () => {
    h.secretos = { resend_api_key: "re_clave" };
    fetchFalso.mockResolvedValue(respuesta(200, { data: [] }));
    const s = supabaseFalso([{ proveedor: "resend", tipo: "correo", nombre: "Correo" }]);
    await verificarTodas(s as never, "ws-1");
    expect(s.updates[0].valores).toMatchObject({ estado: "conectado", ultimo_error: null });
  });
});

describe("un envío por Zernio que falla", () => {
  it("por credenciales, marca la integración de Zernio como desconectada", async () => {
    const s = supabaseFalso([]);
    await registrarFalloDeZernio(s as never, "ws-1", Object.assign(new Error("x"), { statusCode: 401 }));
    expect(s.updates).toEqual([{ proveedor: "zernio", valores: expect.objectContaining({ estado: "desconectado" }) }]);
  });

  it("por otra cosa (un 400), no toca el estado", async () => {
    const s = supabaseFalso([]);
    await registrarFalloDeZernio(s as never, "ws-1", Object.assign(new Error("x"), { statusCode: 400 }));
    expect(s.updates).toEqual([]);
  });

  it("nunca tira: el envío que falló ya tiene su propio manejo de error", async () => {
    const roto = { from: () => { throw new Error("base caída"); } };
    await expect(registrarFalloDeZernio(roto as never, "ws-1", new TypeError("fetch failed"))).resolves.toBeUndefined();
  });
});

/**
 * Los tres caminos de envío por Zernio que existen hoy avisan el fallo. Un test
 * de texto, a propósito: lo que protege es que nadie saque la llamada al tocar
 * esos archivos, y esos caminos no tienen tests de ejecución propios.
 */
describe("los envíos por Zernio avisan sus fallos a integraciones", () => {
  for (const archivo of ["app/api/v1/messages/route.ts", "lib/flow-engine/engine.ts", "lib/sequence-processor.ts"]) {
    it(archivo, () => {
      expect(readFileSync(join(__dirname, "..", archivo), "utf8")).toMatch(/registrarFalloDeZernio\(/);
    });
  }
});
