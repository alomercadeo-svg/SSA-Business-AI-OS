import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El contador de mensajes sin teléfono resuelto (F26) es solo para el Owner
 * (§11, «Pantalla: Canales»: "Admin no lo ve"). La guarda está en el servidor,
 * en la página: el componente no se renderiza para otro rol, así que el número
 * no viaja al navegador del Admin. Se lee el código porque montar la página
 * entera exige media app; el número en sí lo prueba
 * `scripts/verify-identidad-canal.mjs` contra la base real.
 */
const pagina = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("el contador de mensajes sin teléfono", () => {
  it("se renderiza solo con role === \"owner\"", () => {
    expect(pagina).toMatch(/\{role === "owner" && <ContadorSinTelefono\b/);
  });

  it("aparece una sola vez en la página, y siempre detrás de esa guarda", () => {
    expect(pagina.match(/<ContadorSinTelefono\b/g)).toHaveLength(1);
  });
});
