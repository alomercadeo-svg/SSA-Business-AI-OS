import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvisoCanalInactivo } from "./aviso-canal-inactivo";

/**
 * Un canal inactivo se ve en Integraciones (05/10/2026). Los dos receptores
 * rechazan los mensajes de un canal inactivo, y la sincronización con Zernio
 * puede apagar uno sola: sin un aviso visible, la bandeja deja de recibir y
 * nadie sabe por qué. Se vio en rojo antes de escribir el componente.
 */

const TEXTO = "Inactivo: no se reciben mensajes de este canal";

describe("el aviso de canal inactivo", () => {
  it("con el canal inactivo, aparece", () => {
    expect(renderToStaticMarkup(createElement(AvisoCanalInactivo, { activo: false }))).toContain(TEXTO);
  });

  /** Control positivo: sin esto, "aparece" pasaría también con un aviso que se muestra siempre. */
  it("con el canal activo, no aparece", () => {
    expect(renderToStaticMarkup(createElement(AvisoCanalInactivo, { activo: true }))).not.toContain(TEXTO);
  });

  it("lo usan la tarjeta de Instagram y la de WhatsApp", () => {
    const vista = readFileSync(join(__dirname, "integrations-view.tsx"), "utf8");
    const usos = vista.match(/<AvisoCanalInactivo /g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
    expect(vista).toMatch(/function WhatsApp[\s\S]*?<AvisoCanalInactivo /);
    expect(vista).toMatch(/function Instagram[\s\S]*?<AvisoCanalInactivo /);
  });
});
