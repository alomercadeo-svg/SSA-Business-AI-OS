import { describe, it, expect, vi } from "vitest";
import {
  estadoDeVentana,
  moverVentana,
  reglaDeVentana,
  textoDeVence,
  textoDeVentana,
  venceEn,
} from "./ventana-instagram";

const H = 60 * 60 * 1000;
const AHORA = new Date("2026-11-05T20:00:00.000Z");

describe("reglaDeVentana: por proveedor y plataforma (D3)", () => {
  it("Instagram por Zernio: 24 horas", () => {
    expect(reglaDeVentana("zernio", "instagram")).toEqual({ horas: 24 });
  });
  it("WhatsApp por Evolution: sin ventana", () => {
    expect(reglaDeVentana("evolution", "whatsapp")).toBeNull();
  });
  it("WhatsApp por la API oficial (plan B): con ventana", () => {
    expect(reglaDeVentana("zernio", "whatsapp")).toEqual({ horas: 24 });
  });
  it("lo que no está en la tabla: sin ventana", () => {
    expect(reglaDeVentana("otro", "instagram")).toBeNull();
    expect(reglaDeVentana(null, null)).toBeNull();
  });
});

describe("venceEn: 24 horas desde la hora de Meta", () => {
  it("sentAt + 24 h", () => {
    expect(venceEn("2026-11-05T19:00:00.000Z", AHORA, 24)).toBe("2026-11-06T19:00:00.000Z");
  });
  it("un sentAt en el futuro no la alarga: cuenta desde ahora", () => {
    expect(venceEn("2026-11-05T22:00:00.000Z", AHORA, 24)).toBe("2026-11-06T20:00:00.000Z");
  });
  it("sin sentAt, o inválido: desde ahora", () => {
    expect(venceEn(null, AHORA, 24)).toBe("2026-11-06T20:00:00.000Z");
    expect(venceEn("no es fecha", AHORA, 24)).toBe("2026-11-06T20:00:00.000Z");
  });
});

function baseQueRegistra(error: { message: string } | null = null) {
  const llamadas: Array<[string, unknown[]]> = [];
  const cadena: Record<string, unknown> = {};
  for (const m of ["update", "eq", "or"]) {
    cadena[m] = (...args: unknown[]) => {
      llamadas.push([m, args]);
      return m === "or" ? Promise.resolve({ error }) : cadena;
    };
  }
  const from = vi.fn(() => cadena);
  return { cliente: { from } as never, from, llamadas };
}

describe("moverVentana: solo adelanta", () => {
  it("escribe la ventana y 'mensaje' en esa conversación, solo si estaba vacía o era anterior", async () => {
    const b = baseQueRegistra();
    await moverVentana(b.cliente, { conversationId: "c1", vence: "2026-11-06T19:00:00.000Z" });
    expect(b.from).toHaveBeenCalledWith("conversations");
    expect(b.llamadas).toEqual([
      ["update", [{ window_expires_at: "2026-11-06T19:00:00.000Z", window_source: "mensaje" }]],
      ["eq", ["id", "c1"]],
      ["or", ['window_expires_at.is.null,window_expires_at.lt."2026-11-06T19:00:00.000Z"']],
    ]);
  });
  it("si la base falla, tira (el receptor responde 500 y el proveedor reintenta)", async () => {
    const b = baseQueRegistra({ message: "caída" });
    await expect(moverVentana(b.cliente, { conversationId: "c1", vence: "x" })).rejects.toThrow("caída");
  });
});

describe("estadoDeVentana", () => {
  const ahora = AHORA.getTime();
  const conVence = (ms: number | null, platform = "instagram") => ({ platform, window_expires_at: ms === null ? null : new Date(ms).toISOString() });
  it("WhatsApp: null (la bandeja no muestra ventana)", () => {
    expect(estadoDeVentana(conVence(ahora + 10 * H, "whatsapp"), ahora)).toBeNull();
  });
  it("sin ningún mensaje del lead: cerrada", () => {
    expect(estadoDeVentana(conVence(null), ahora)).toEqual({ estado: "cerrada" });
  });
  it("vencida, o justo ahora: cerrada", () => {
    expect(estadoDeVentana(conVence(ahora - 1), ahora)).toEqual({ estado: "cerrada" });
    expect(estadoDeVentana(conVence(ahora), ahora)).toEqual({ estado: "cerrada" });
  });
  it("con 2 horas o menos: por vencer", () => {
    expect(estadoDeVentana(conVence(ahora + H), ahora)).toEqual({ estado: "por_vencer", restanteMs: H });
    expect(estadoDeVentana(conVence(ahora + 2 * H), ahora)).toEqual({ estado: "por_vencer", restanteMs: 2 * H });
  });
  it("con más de 2 horas: abierta", () => {
    expect(estadoDeVentana(conVence(ahora + 2 * H + 1), ahora)).toEqual({ estado: "abierta", restanteMs: 2 * H + 1 });
  });
});

describe("los textos (el criterio reescrito y D1)", () => {
  it("«Vence en 1 h 20 min», y «Vence en 45 min» con menos de una hora", () => {
    expect(textoDeVence(80 * 60000)).toBe("Vence en 1 h 20 min");
    expect(textoDeVence(45 * 60000)).toBe("Vence en 45 min");
    expect(textoDeVence(60 * 60000)).toBe("Vence en 1 h");
    expect(textoDeVence(30000)).toBe("Vence en 1 min");
  });
  it("en la lista: «Ventana cerrada» o el aviso de que vence; abierta con más de 2 horas, nada", () => {
    expect(textoDeVentana({ estado: "cerrada" }, "lista")).toBe("Ventana cerrada");
    expect(textoDeVentana({ estado: "por_vencer", restanteMs: 80 * 60000 }, "lista")).toBe("Vence en 1 h 20 min");
    expect(textoDeVentana({ estado: "abierta", restanteMs: 10 * H }, "lista")).toBeNull();
    expect(textoDeVentana(null, "lista")).toBeNull();
  });
  it("en el encabezado: siempre el estado, con el tiempo restante si está abierta", () => {
    expect(textoDeVentana({ estado: "abierta", restanteMs: 10.5 * H }, "encabezado")).toBe("Ventana abierta · quedan 10 h");
    expect(textoDeVentana({ estado: "por_vencer", restanteMs: 45 * 60000 }, "encabezado")).toBe("Vence en 45 min");
    expect(textoDeVentana({ estado: "cerrada" }, "encabezado")).toBe("Ventana cerrada");
  });
});
