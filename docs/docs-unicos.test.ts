import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Un solo plano, un solo estado.
 *
 * ── DE DÓNDE SALE ESTE TEST ─────────────────────────────────────────────────
 *
 * Hasta el 21 de septiembre de 2026 convivieron dos documentos de
 * requerimientos: `requerimientos-fase1.md`, con F1 a F20, congelado desde el
 * 15 de septiembre, y `requerimientos-bloques-2-3-4.md`, con F21 a F39, que era
 * el que se venía actualizando. **Numeraban distinto**, así que no se podían
 * comparar, y nadie verificaba que el segundo contuviera lo que el primero
 * diseñaba. Durante una semana se actualizó el archivo equivocado.
 *
 * Lo mismo había pasado con el estado del proyecto: una copia en el repo y otra
 * fuera de git, cada una invisible para el autor de la otra.
 *
 * ── POR QUÉ UN TEST Y NO UNA NOTA EN EL CLAUDE.md ───────────────────────────
 *
 * Porque la nota ya existía y no impidió nada. El duplicado no aparece por
 * ignorancia: aparece porque generar un documento nuevo es más cómodo que
 * editar uno de 148 KB, y en el momento de generarlo nadie está leyendo las
 * reglas. Un archivo suelto en `docs/` no le falla a nadie hasta que alguien lo
 * lee y construye sobre la versión equivocada.
 *
 * Este test falla en `npm test`, que es el único momento en que la regla se
 * hace notar sola.
 *
 * ── QUÉ ATRAPA Y QUÉ NO ─────────────────────────────────────────────────────
 *
 * Atrapa el caso real: un archivo nuevo en `docs/` cuyo nombre arranca con
 * `requerimientos` o con `estado` y no es el path oficial. **No** atrapa un
 * duplicado con otro nombre —`plano-v2.md`, `alcance-bloque-3.md`— y eso no
 * tiene arreglo razonable: distinguir un plano de cualquier otro documento por
 * su contenido sería adivinar. La regla cubre la forma en que el problema
 * ocurrió, no todas las formas imaginables.
 */

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Las dos familias, con su único archivo permitido.
 *
 * El caso del estado entró acá sin retorcer nada: es el mismo predicado
 * —prefijo del nombre, más una lista de permitidos— con otro prefijo. Si
 * hubiera necesitado una regla distinta, iba aparte.
 */
const FAMILIAS = [
  { prefijo: "requerimientos", oficial: "requerimientos-fase1.md", que: "plano de requerimientos" },
  { prefijo: "estado", oficial: "estado-fase1.md", que: "documento de estado" },
];

function archivosDeDocs(): string[] {
  return readdirSync(DOCS).filter((f) => f.endsWith(".md"));
}

describe("docs/ tiene un solo plano y un solo estado", () => {
  /**
   * El control positivo del guardián.
   *
   * Si `docs/` se moviera o el nombre del test cambiara de carpeta, la lista
   * saldría vacía y todo lo de abajo pasaría en verde sin haber mirado nada.
   * Esta comprobación es la que impide ese verde vacío.
   */
  it("encuentra los documentos de docs/, incluidos los oficiales", () => {
    const archivos = archivosDeDocs();
    expect(archivos.length).toBeGreaterThan(3);
    for (const { oficial } of FAMILIAS) {
      expect(archivos, `falta el archivo oficial ${oficial}`).toContain(oficial);
    }
  });

  for (const { prefijo, oficial, que } of FAMILIAS) {
    it(`no hay un segundo ${que}`, () => {
      const encontrados = archivosDeDocs().filter((f) => f.startsWith(prefijo));
      const intrusos = encontrados.filter((f) => f !== oficial);

      expect(
        intrusos,
        `Apareció otro ${que} en docs/: ${intrusos.join(", ")}.\n` +
          `El único es ${oficial}. Si el archivo nuevo tiene contenido que falta ` +
          `en el oficial, se concilia ahí y el nuevo se BORRA; git conserva la ` +
          `historia. Una copia en disco es el mecanismo exacto por el que se ` +
          `actualizó el archivo equivocado durante una semana.`
      ).toEqual([]);
    });
  }
});
