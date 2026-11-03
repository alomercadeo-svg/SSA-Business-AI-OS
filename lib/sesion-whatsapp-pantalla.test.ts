import { describe, it, expect, vi } from "vitest";
import { textoDeSesion, interpretarConnect, pedirCodigoQR, textoDeMotivo } from "./sesion-whatsapp-pantalla";

/**
 * Lo que la pantalla de Canales dice de la sesión de WhatsApp (F32), y cómo se
 * lee la respuesta de `GET /instance/connect` de Evolution 2.3.7
 * (`instance.controller.ts:309-341`, leído el 02/11/2026).
 */

const AHORA = new Date("2026-11-02T19:00:00-06:00");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

function canal(estado: string | null, verificadoHaceMin: number | null = 2) {
  return {
    session_state: estado as never,
    session_checked_at: verificadoHaceMin === null ? null : hace(verificadoHaceMin),
    session_changed_at: hace(60),
  };
}

describe("textoDeSesion", () => {
  it("conectado, con la fecha de verificación y sin botón", () => {
    const t = textoDeSesion(canal("conectado"), AHORA);
    expect(t).toMatchObject({ estado: "conectado", etiqueta: "Conectado", boton: null });
    expect(t.verificado).toBe("Verificado hace 2 min");
  });

  it("caído, con «Reconectar»", () => {
    expect(textoDeSesion(canal("caido"), AHORA)).toMatchObject({ etiqueta: "Caído", boton: "Reconectar" });
  });

  it("se agotaron los intentos, con «Reconectar» y la explicación de empezar de cero", () => {
    const t = textoDeSesion(canal("agotado"), AHORA);
    expect(t).toMatchObject({ etiqueta: "Se agotaron los intentos", boton: "Reconectar" });
    expect(t.explicacion).toMatch(/de cero/);
  });

  it("sin vincular, con «Vincular número»", () => {
    expect(textoDeSesion(canal("sin_vincular"), AHORA)).toMatchObject({ etiqueta: "Sin vincular", boton: "Vincular número" });
  });

  /**
   * `canal(null)` es el canal nuevo cuya primera lectura no cambió el estado
   * (un `connecting` sin marca): tiene hora de chequeo y ningún estado. Sin él,
   * borrar `!guardado` seguía en verde (visto el 03/11/2026, S7 tramo 2).
   */
  it("un estado desconocido nunca se muestra como desconectado", () => {
    for (const t of [textoDeSesion(canal("sin_verificar"), AHORA), textoDeSesion(canal(null, null), AHORA), textoDeSesion(canal(null), AHORA)]) {
      expect(t.etiqueta).toBe("No se pudo verificar");
      expect(JSON.stringify(t)).not.toMatch(/desconectad/i);
    }
  });

  it("sin ninguna lectura, no dice que un chequeo no respondió: dice que todavía no hay lectura", () => {
    const t = textoDeSesion(canal(null, null), AHORA);
    expect(t.etiqueta).toBe("No se pudo verificar");
    expect(t.explicacion).toBe("Todavía no hay ninguna lectura de la sesión.");
    // Control positivo: con una lectura fallida, sí habla del chequeo.
    expect(textoDeSesion(canal("sin_verificar"), AHORA).explicacion).toMatch(/El último chequeo no obtuvo respuesta/);
  });

  it("un chequeo de más de 30 minutos es «no se pudo verificar», aunque lo guardado diga conectado", () => {
    const viejo = textoDeSesion(canal("conectado", 31), AHORA);
    expect(viejo.etiqueta).toBe("No se pudo verificar");
    expect(viejo.explicacion).toMatch(/Último estado conocido: conectado/);
    // Control positivo: a los 29 minutos sigue siendo conectado.
    expect(textoDeSesion(canal("conectado", 29), AHORA).etiqueta).toBe("Conectado");
  });

  it("todo en voseo y en lenguaje claro: dice cada cuánto se reintenta", () => {
    expect(textoDeSesion(canal("sin_verificar"), AHORA).explicacion).toMatch(/10 minutos/);
  });
});

describe("interpretarConnect", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("con el código: lo devuelve (control positivo)", () => {
    expect(interpretarConnect(200, { pairingCode: null, code: "2@abc", base64: PNG, count: 1 })).toEqual({ tipo: "qr", imagen: PNG });
  });

  it("ya conectado: lo dice en vez de dar un código", () => {
    expect(interpretarConnect(200, { instance: { instanceName: "x", state: "open" } })).toEqual({ tipo: "conectado" });
  });

  it("sin base64 todavía: lo dice", () => {
    expect(interpretarConnect(200, { pairingCode: null, code: undefined, base64: undefined, count: 0 })).toEqual({ tipo: "sin_codigo" });
  });

  it("un error de Evolution, aunque venga con 200: lo dice sin mostrar el mensaje crudo", () => {
    expect(interpretarConnect(200, { error: true, message: "BadRequestException: The x instance does not exist" })).toEqual({ tipo: "error", motivo: "evolution" });
  });

  it("un 401: la credencial", () => {
    expect(interpretarConnect(401, {})).toEqual({ tipo: "error", motivo: "http_401" });
    expect(textoDeMotivo("http_401")).toMatch(/credencial/);
  });

  it("una imagen que no es un PNG en data URL no se muestra", () => {
    expect(interpretarConnect(200, { base64: "javascript:alert(1)" })).toEqual({ tipo: "sin_codigo" });
  });
});

describe("pedirCodigoQR", () => {
  it("pide connect con el token de la instancia", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 }));
    expect(await pedirCodigoQR("mi-inst", "token-x", { url: "https://evo.ejemplo/", fetch: f as never })).toEqual({ tipo: "conectado" });
    expect(f.mock.calls[0][0]).toBe("https://evo.ejemplo/instance/connect/mi-inst");
    expect(new Headers(f.mock.calls[0][1]?.headers).get("apikey")).toBe("token-x");
  });

  it("sin respuesta: lo dice", async () => {
    const f = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await pedirCodigoQR("x", "t", { url: "https://evo.ejemplo", fetch: f as never })).toEqual({ tipo: "error", motivo: "sin_respuesta" });
  });
});
