import { describe, it, expect, vi } from "vitest";
import { enviarTextoPorEvolution, ErrorDeEnvioEvolution } from "./evolution-envio";
import { sesionImpideEnviar, AVISO_WHATSAPP_DESCONECTADO } from "./whatsapp-bandeja";

/**
 * F42 con respuestas simuladas de Evolution: la forma de la respuesta sale de
 * `prepareMessage` de Evolution 2.3.7 (`whatsapp.baileys.service.ts:4652-4657`),
 * armada, no copiada de una respuesta real.
 */
const base = { base: "https://evo.ejemplo.invalid/", instancia: "ventas 1", token: "tok-secreto", numero: "50670001111@s.whatsapp.net", texto: "prueba F42" };

describe("enviarTextoPorEvolution", () => {
  it("manda POST /message/sendText/{instancia} con apikey y { number, text }, y devuelve key.id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ key: { remoteJid: "x@s.whatsapp.net", fromMe: true, id: "3EB0ENVIADO" } }), { status: 201 }));
    const r = await enviarTextoPorEvolution({ ...base, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ id: "3EB0ENVIADO" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.ejemplo.invalid/message/sendText/ventas%201");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).apikey).toBe("tok-secreto");
    expect(JSON.parse(String(init.body))).toEqual({ number: "50670001111@s.whatsapp.net", text: "prueba F42" });
  });

  it("un 400 de Evolution es un rechazo", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 400, error: "Bad Request" }), { status: 400 }));
    await expect(enviarTextoPorEvolution({ ...base, fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ tipo: "rechazo", status: 400 });
  });

  it("sin respuesta dentro del tiempo máximo es «sin respuesta»", async () => {
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_ok, mal) => init.signal?.addEventListener("abort", () => mal(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    await expect(enviarTextoPorEvolution({ ...base, esperaMs: 20, fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ tipo: "sin_respuesta" });
  });

  it("un 201 sin key.id es «sin respuesta»: puede haber salido", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 201 }));
    await expect(enviarTextoPorEvolution({ ...base, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(ErrorDeEnvioEvolution);
  });

  it("el error no lleva el token", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }));
    const e = await enviarTextoPorEvolution({ ...base, fetch: f as unknown as typeof fetch }).catch((x) => x);
    expect(String(e.message)).not.toContain("tok-secreto");
  });
});

describe("la sesión que impide enviar (F42, criterio 5)", () => {
  it("caída, agotada y sin vincular no envían", () => {
    for (const s of ["caido", "agotado", "sin_vincular"]) expect(sesionImpideEnviar(s), s).toBe(true);
  });
  it("conectada y «no se pudo verificar» sí intentan (control)", () => {
    for (const s of ["conectado", "sin_verificar"]) expect(sesionImpideEnviar(s), s).toBe(false);
  });
  it("el texto es el del criterio", () => {
    expect(AVISO_WHATSAPP_DESCONECTADO).toBe("WhatsApp no está conectado. Los mensajes no pueden salir ni entrar por este canal hasta reconectarlo.");
  });
});
