import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mensajeDelAviso, vistaPreviaDelAviso, type AvisoDeMensajeZernio } from "./zernio-aviso";
import { mapearMensajesDeZernio } from "./zernio-message-map";
import { enlaceDeHistoria, TEXTO_HISTORIA } from "./respuesta-historia";

/**
 * F44, criterio 3 (ítem 5 de la sesión de cierre). La forma real, leída el
 * 10/11/2026 en una entrega del registro de Zernio de @poderosascomunidad (del
 * 06/11 a las 15:41): `metadata.storyReply = { storyId, storyUrl }`, con
 * `storyUrl` del CDN de Meta, sin adjuntos. En el listado de mensajes (la
 * importación) `storyReply` es solo un sí o no. Columna nueva
 * `messages.respuesta_historia` (decisión de Marcos del 06/11/2026).
 */
const aviso = (metadata?: Record<string, unknown>, text = "¡Qué linda!"): AvisoDeMensajeZernio =>
  ({
    event: "message.received",
    message: { id: "m1", platformMessageId: "p1", direction: "incoming", text, sentAt: "2026-11-10T20:00:00.000Z", sender: { id: "s1" }, attachments: [] },
    conversation: { id: "c1" },
    account: { id: "a1", platform: "instagram" },
    metadata,
  }) as unknown as AvisoDeMensajeZernio;

describe("la respuesta a una historia", () => {
  it("el receptor guarda la marca con el id y el enlace, sin bajar ningún archivo", () => {
    const m = mensajeDelAviso(aviso({ storyReply: { storyId: "18000000000000001", storyUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?x=1" } }), "conv", "jid");
    expect(m.respuestaHistoria).toEqual({ storyId: "18000000000000001", storyUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?x=1" });
    expect(m.attachments).toBeNull();
  });
  it("control: un mensaje común no lleva la marca", () => {
    expect(mensajeDelAviso(aviso(), "conv", "jid").respuestaHistoria).toBeNull();
  });
  it("la vista previa empieza con «Historia:»; la de un mensaje común, igual que antes", () => {
    expect(vistaPreviaDelAviso(aviso({ storyReply: { storyId: "1" } }))).toBe("Historia: ¡Qué linda!");
    expect(vistaPreviaDelAviso(aviso())).toBe("¡Qué linda!");
  });
  it("la importación marca la respuesta a una historia aunque el listado no traiga el enlace", () => {
    const [m] = mapearMensajesDeZernio([{ id: "x", direction: "incoming", message: "hola", createdAt: "2026-11-10T20:00:00.000Z", storyReply: true }], "conv");
    expect(m.respuesta_historia).toEqual({ storyId: null, storyUrl: null });
    const [n] = mapearMensajesDeZernio([{ id: "y", direction: "incoming", message: "hola", createdAt: "2026-11-10T20:00:00.000Z" }], "conv");
    expect(n.respuesta_historia).toBeNull();
  });
  it("«Ver historia» solo con enlace y mientras no venció (24 horas, según los tipos de Zernio)", () => {
    const ahora = new Date("2026-11-11T10:00:00.000Z");
    expect(enlaceDeHistoria({ storyId: "1", storyUrl: "https://lookaside.fbsbx.com/a" }, "2026-11-11T00:00:00.000Z", ahora)).toBe("https://lookaside.fbsbx.com/a");
    expect(enlaceDeHistoria({ storyId: "1", storyUrl: "https://lookaside.fbsbx.com/a" }, "2026-11-09T00:00:00.000Z", ahora)).toBeNull();
    expect(enlaceDeHistoria({ storyId: "1", storyUrl: null }, "2026-11-11T00:00:00.000Z", ahora)).toBeNull();
    expect(enlaceDeHistoria({ storyId: "1", storyUrl: "javascript:alert(1)" }, "2026-11-11T00:00:00.000Z", ahora)).toBeNull();
  });
  it("el hilo muestra «Respondió a tu historia» y «Ver historia», y el GET de mensajes trae la columna", () => {
    expect(TEXTO_HISTORIA).toBe("Respondió a tu historia");
    const hilo = readFileSync(resolve(__dirname, "../components/inbox/message-thread.tsx"), "utf8");
    expect(hilo).toContain("TEXTO_HISTORIA");
    expect(hilo).toContain("Ver historia");
    expect(readFileSync(resolve(__dirname, "../app/api/v1/messages/route.ts"), "utf8")).toContain("respuesta_historia");
  });
});
