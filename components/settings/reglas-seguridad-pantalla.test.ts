import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PESTANAS_CONFIGURACION } from "./settings-tabs";

/**
 * F33: la pantalla `/settings/channels/whatsapp` (§11). Por la fuente: no
 * prueba el diseño (eso lo mira Marcos). Escritos en rojo antes de la pantalla.
 */
const raiz = resolve(__dirname, "../../app/(dashboard)/dashboard/settings/channels/whatsapp");
const leer = (f: string) => readFileSync(resolve(raiz, f), "utf8");

describe("F33: Configuración › Reglas de WhatsApp", () => {
  it("es una pestaña de Configuración con la URL de §11", () => {
    expect(PESTANAS_CONFIGURACION.some((p) => p.href === "/dashboard/settings/channels/whatsapp")).toBe(true);
  });

  it("solo Owner y Admin, en el servidor", () => {
    expect(leer("page.tsx")).toContain("getWorkspaceAsManager()");
  });

  it("el opt-out se muestra siempre activo y sin control para apagarlo", () => {
    const f = leer("formulario.tsx");
    expect(f).toContain("Siempre activo. Un pedido de no contacto corta para siempre, sin opción de forzarlo. No se puede apagar.");
    expect(f).not.toMatch(/opt_out|optOut/);
  });

  it("cada regla con su explicación de qué pasa si se desactiva", () => {
    const f = leer("formulario.tsx");
    for (const t of ["Si la apagás, un lead que no contesta sigue recibiendo seguimientos.", "Si la apagás, todos reciben la primera variante.", "Si la apagás, salen todos juntos", "Si la apagás, se puede mandar de madrugada."]) expect(f, t).toContain(t);
  });

  it("la proporción de respuesta dice que todavía no hay datos (el motor es de la Fase 2)", () => {
    expect(leer("formulario.tsx")).toContain("Todavía no hay seguimientos automáticos por WhatsApp: el número aparece cuando la Fase 2 los mande.");
  });

  it("dice que usa la zona del negocio porque el contacto no tiene una", () => {
    expect(leer("formulario.tsx")).toContain("Se usa la zona horaria del negocio: los contactos todavía no tienen una propia.");
  });
});
