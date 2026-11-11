import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Deuda de §15 (ítem 7 de la sesión de cierre): «crear un espacio de trabajo
 * desde el selector nunca funcionó, y falla sin decir nada». Lo que no depende
 * de una decisión de producto: el selector ya no se traga el error, y el error
 * es claro, no el técnico de la base. Si el producto necesita crear espacios
 * desde la interfaz queda para Marcos (§15 lo dejó «para decidir»).
 */
const selector = readFileSync(resolve(__dirname, "workspace-switcher.tsx"), "utf8");
const accion = readFileSync(resolve(__dirname, "../lib/actions/workspace.ts"), "utf8");

describe("crear un espacio desde el selector", () => {
  it("si falla, el selector muestra el motivo en vez de no hacer nada", () => {
    expect(selector).toMatch(/setErrorAlCrear\(result\.error/);
    expect(selector).toContain('role="alert"');
  });
  it("el motivo es claro, no el error técnico de la base", () => {
    expect(accion).toContain("Por ahora no se pueden crear espacios de trabajo desde acá");
    expect(accion).not.toMatch(/return \{ error: error\?\.message \|\| "Failed to create workspace" \}/);
  });
});
