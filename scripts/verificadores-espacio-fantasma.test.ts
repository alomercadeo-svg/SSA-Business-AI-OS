import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Deuda de §15 (ítem 7 de la sesión de cierre): «`verify-lead-scope.mjs` y
 * `verify-realtime-scope.mjs` escriben en el workspace real». Tomaban el
 * primer espacio de la base, que en producción es el del negocio, y creaban
 * ahí usuarios, contactos, canales y conversaciones de prueba. Ahora cada uno
 * trabaja en el espacio fantasma de un usuario de prueba que crea y borra.
 */
const leer = (n: string) => readFileSync(resolve(__dirname, n), "utf8");

describe("los verificadores de alcance no escriben en el espacio real", () => {
  for (const n of ["verify-lead-scope.mjs", "verify-realtime-scope.mjs"]) {
    it(`${n} no toma el primer espacio de la base: usa el fantasma de un dueño de prueba`, () => {
      const s = leer(n);
      expect(s).not.toMatch(/workspaceA = ws\w*\[0\]\.id/);
      expect(s).toMatch(/const dueno = await crearUsuario\("dueno"\)/);
    });
  }
});
