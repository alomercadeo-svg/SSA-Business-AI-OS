import { describe, expect, it } from "vitest";
import { lineasPorAccion, SQL_AUDIT_ACCIONES } from "./recuento-auditoria.mjs";

/**
 * El recuento se presenta como «sin contenido», y la etiqueta de una fila del
 * historial puede ser el nombre de un lead real («contacto.creado»). Anotado
 * el 19/10/2026: imprimía la etiqueta de la última fila de cada acción.
 */
describe("el recuento de audit_log por acción no imprime etiquetas", () => {
  it("la consulta no pide la etiqueta de la entidad", () => {
    expect(SQL_AUDIT_ACCIONES).not.toMatch(/entity_label/);
  });

  it("aunque una fila traiga etiqueta, lo impreso no la incluye: solo cantidad y hora", () => {
    const lineas: string[] = lineasPorAccion([
      { espacio: "Espacio", accion: "contacto.creado", n: 3, ultima: "2026-10-19T19:04:23Z", ultima_entidad: "Nombre De Un Lead" },
    ]);
    expect(lineas).toEqual(["    Espacio · contacto.creado: 3 (última 2026-10-19T19:04:23Z)"]);
    expect(lineas.join("\n")).not.toContain("Nombre De Un Lead");
  });
});
