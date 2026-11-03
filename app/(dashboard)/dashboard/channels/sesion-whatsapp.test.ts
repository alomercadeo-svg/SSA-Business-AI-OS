import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/canales", () => ({ pedirCodigoWhatsapp: async () => ({ tipo: "sin_codigo" }) }));

const { SesionWhatsapp, ModalDeCodigo } = await import("./sesion-whatsapp");

/**
 * La tarjeta de la sesión de WhatsApp en Canales y el modal del código (F32).
 * Las reglas de cada texto están en `lib/sesion-whatsapp-pantalla.test.ts`;
 * acá se comprueba que la pantalla las muestra.
 */

const recien = () => new Date(Date.now() - 2 * 60_000).toISOString();
const canal = (estado: string | null) => ({
  id: "c-wa",
  session_state: estado as never,
  session_checked_at: recien(),
  session_changed_at: recien(),
});
const tarjeta = (estado: string | null) => renderToStaticMarkup(createElement(SesionWhatsapp, { canal: canal(estado) }));
const modal = (fase: Parameters<typeof ModalDeCodigo>[0]["fase"]) =>
  renderToStaticMarkup(createElement(ModalDeCodigo, { fase, onCerrar: () => {}, onPedir: () => {} }));

describe("la tarjeta de la sesión", () => {
  it("caído: el estado, su explicación, la fecha de verificación y «Reconectar»", () => {
    const html = tarjeta("caido");
    expect(html).toContain("Sesión de WhatsApp: Caído");
    expect(html).toContain("Hay que volver a escanear el código");
    expect(html).toContain("Verificado hace 2 min");
    expect(html).toContain("Reconectar");
  });

  /** Control positivo del botón: sin esto, «aparece» pasaría con un botón que se muestra siempre. */
  it("conectado: sin botón", () => {
    const html = tarjeta("conectado");
    expect(html).toContain("Sesión de WhatsApp: Conectado");
    expect(html).not.toContain("Reconectar");
    expect(html).not.toContain("Vincular número");
  });

  it("sin vincular: «Vincular número»", () => {
    expect(tarjeta("sin_vincular")).toContain("Vincular número");
  });

  it("sin lectura: «No se pudo verificar», nunca desconectado", () => {
    const html = tarjeta(null);
    expect(html).toContain("No se pudo verificar");
    expect(html).not.toMatch(/desconectad/i);
  });

  it("la usa la tarjeta de los canales de Evolution", () => {
    const vista = readFileSync(join(__dirname, "channels-view.tsx"), "utf8");
    expect(vista).toMatch(/channel\.provider === "evolution" && <SesionWhatsapp canal=\{channel\} \/>/);
  });
});

describe("el modal del código", () => {
  it("con código: la imagen, cómo escanearla y «Actualizar código» (control positivo)", () => {
    const html = modal({ tipo: "qr", imagen: "data:image/png;base64,AAAA" });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("Dispositivos vinculados");
    expect(html).toContain("Actualizar código");
  });

  it("cuando no puede dar un código, lo explica en vez de fallar en silencio", () => {
    expect(modal({ tipo: "sin_codigo" })).toContain("Todavía no hay un código");
    expect(modal({ tipo: "conectado" })).toContain("WhatsApp ya está conectado");
    expect(modal({ tipo: "error", motivo: "sin_credencial" })).toContain("Falta la credencial de la instancia");
    expect(modal({ tipo: "error", motivo: "sin_respuesta" })).toContain("no respondió");
    for (const f of [{ tipo: "sin_codigo" as const }, { tipo: "conectado" as const }, { tipo: "error" as const, motivo: "x" }]) {
      expect(modal(f)).not.toContain("<img");
    }
  });

  it("se agotaron los intentos: explica qué hacer en el teléfono y ofrece empezar de cero", () => {
    const html = modal({ tipo: "agotado" });
    expect(html).toContain("No se puede generar un código");
    expect(html).toContain("Empezar de cero");
  });
});
