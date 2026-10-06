import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resumenWebhook, webhookDe } from "@/lib/integraciones";
import { EstadoWebhook } from "./estado-webhook";

/**
 * El estado del registro del webhook de Zernio en la tarjeta de Instagram (F24).
 *
 * El dato es la respuesta real de `GET /v1/webhooks/settings` del 05/10/2026
 * (`lib/fixtures/zernio-webhooks-settings.json`), con el secreto de firma
 * reemplazado por un marcador del mismo largo antes de guardarla. El marcador
 * es lo que estos tests buscan: si aparece en el HTML, el secreto real también
 * aparecería.
 *
 * Se vieron en rojo antes de escribir el código: no existía nada de esto.
 */

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../../../../lib/fixtures/zernio-webhooks-settings.json"), "utf8")
);
const MARCADOR = "MARCADOR-SECRETO";

describe("el resumen del registro del webhook", () => {
  it("con la respuesta real: registrado, contra app.alomercadeo.com/api/webhooks/late, activo, tres eventos", () => {
    const r = resumenWebhook(fixture.cuerpo);
    expect(r.registrado).toBe(true);
    expect(r.url).toBe("https://app.alomercadeo.com/api/webhooks/late");
    expect(r.activo).toBe(true);
    expect(r.eventos).toEqual(["message.received", "comment.received", "message.sent"]);
    expect(r.secreto?.largo).toBe(64);
    expect(JSON.stringify(r)).not.toContain(MARCADOR);
  });

  it("sin ningún webhook hacia la ruta del receptor: no registrado", () => {
    expect(resumenWebhook({ webhooks: [] }).registrado).toBe(false);
    const otro = resumenWebhook({ webhooks: [{ url: "https://otra.cosa/hook", isActive: true, secret: "x".repeat(32) }] });
    expect(otro.registrado).toBe(false);
    expect(otro.otros).toBe(1);
  });

  it("lo que vuelve de config pasa por una lista de campos: un secreto crudo ahí no sale", () => {
    const v = webhookDe({ webhook: { ...resumenWebhook(fixture.cuerpo), secret: `${MARCADOR}-CRUDO`, verificado_el: "2026-10-05T23:30:00Z" } });
    expect(JSON.stringify(v)).not.toContain(MARCADOR);
    expect(v?.verificado_el).toBe("2026-10-05T23:30:00Z");
  });
});

describe("la tarjeta, convertida a HTML", () => {
  const vista = webhookDe({ webhook: { ...resumenWebhook(fixture.cuerpo), verificado_el: "2026-10-05T23:30:00Z" } });
  const html = renderToStaticMarkup(createElement(EstadoWebhook, { webhook: vista }));

  /** Control positivo: sin esto, "el secreto no aparece" pasaría con una tarjeta vacía. */
  it("muestra la dirección y que está activo", () => {
    expect(html).toContain("app.alomercadeo.com/api/webhooks/late");
    expect(html).toContain("Activo");
    expect(html).toMatch(/64 caracteres/);
  });

  it("el secreto de firma no aparece en el HTML", () => {
    expect(html).not.toContain(MARCADOR);
  });

  it("sin registro, lo dice", () => {
    const sin = renderToStaticMarkup(
      createElement(EstadoWebhook, { webhook: webhookDe({ webhook: { ...resumenWebhook({ webhooks: [] }), verificado_el: null } }) })
    );
    expect(sin).toMatch(/No hay ningún webhook registrado/);
  });
});
