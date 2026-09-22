import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Los números del plano contra la realidad del repo.
 *
 * ── POR QUÉ ESTOS SÍ SE PUEDEN VERIFICAR ────────────────────────────────────
 *
 * Una auditoría del 22/09/2026 encontró tres afirmaciones de estado vencidas en
 * el plano, y **dos de las tres eran conteos**: "las 5 migraciones del Bloque 1"
 * cuando ya había siete propias aplicadas, y "las 24 tablas" cuando la 00022
 * había agregado `webhook_alerts`.
 *
 * Un conteo es la única clase de afirmación de estado que se puede comprobar sin
 * interpretar prosa: hay un número escrito y hay algo que contar. Por eso estos
 * dos se automatizan y el resto queda como revisión humana, por el motivo que
 * está en `docs/plano-estado.test.ts`.
 *
 * ── QUÉ SE CUENTA Y CONTRA QUÉ ──────────────────────────────────────────────
 *
 * Las migraciones, contra `supabase/migrations/`. Las tablas, contra el esquema
 * declarado en las migraciones, **no contra la base**: un test no puede depender
 * de que haya credenciales ni de que la base esté arriba, y menos de la base de
 * producción. Si el esquema aplicado y el declarado se separaran, eso es otro
 * problema y lo detectan los verificadores de `scripts/`, que sí hablan con la
 * base.
 *
 * ── EL MARCO, QUE ES LA MITAD DEL PROBLEMA ──────────────────────────────────
 *
 * El plano mezcla dos marcos y antes los escribía iguales: el conteo **del
 * fork** —16 migraciones, 24 tablas, que no cambia nunca— y el conteo **de
 * hoy**, que crece con cada migración propia. Un número pelado no dice a cuál
 * pertenece, así que alguien que "corrija" el 24 del fork a 25 rompe lo que
 * estaba bien.
 *
 * Por eso el conteo vigente vive **en un solo lugar**, la sección 14c, y este
 * test comprueba las dos cosas: que ese lugar diga la verdad, y que el número de
 * hoy no aparezca suelto en ningún otro lado.
 */

const RAIZ = process.cwd();
const PLANO = resolve(RAIZ, "docs/requerimientos-fase1.md");
const MIGRACIONES = resolve(RAIZ, "supabase/migrations");

/** Las migraciones numeradas. `ALL_MIGRATIONS.sql` no cuenta: no la aplica el CLI. */
export function migracionesNumeradas(): string[] {
  return readdirSync(MIGRACIONES)
    .filter((f) => /^\d{5}_.*\.sql$/.test(f))
    .sort();
}

/** Las tablas que declaran las migraciones numeradas, sin hablar con la base. */
export function tablasDeclaradas(): Set<string> {
  const tablas = new Set<string>();
  for (const archivo of migracionesNumeradas()) {
    const sql = readFileSync(resolve(MIGRACIONES, archivo), "utf8");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
      tablas.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
      tablas.delete(m[1].toLowerCase());
    }
  }
  return tablas;
}

const plano = readFileSync(PLANO, "utf8");

describe("los conteos del plano contra el repo", () => {
  /**
   * El control positivo: si `supabase/migrations/` se moviera, las dos listas
   * saldrían vacías y todo lo de abajo compararía ceros contra ceros.
   */
  it("hay migraciones y tablas que contar", () => {
    expect(migracionesNumeradas().length).toBeGreaterThan(10);
    expect(tablasDeclaradas().size).toBeGreaterThan(10);
  });

  it("el conteo vigente de 14c dice la verdad", () => {
    const migraciones = migracionesNumeradas().length;
    const tablas = tablasDeclaradas().size;

    const fila = plano.split("\n").find((l) => l.includes("| Tablas existentes |"));
    expect(fila, "no se encontró la fila del conteo vigente en 14c").toBeDefined();

    expect(
      fila,
      `14c dice otra cosa que el repo: hay ${tablas} tablas y ${migraciones} migraciones aplicadas.`
    ).toContain(`${tablas} tablas y ${migraciones} migraciones`);
  });

  it("la última migración que 14c nombra es la última que existe", () => {
    const ultima = migracionesNumeradas().at(-1)!.slice(0, 5);
    const fila = plano.split("\n").find((l) => l.includes("| Tablas existentes |"))!;
    expect(fila, `la última migración es la ${ultima}`).toContain(ultima);
  });

  /**
   * Un número repetido en tres lugares se desactualiza en dos. El conteo de hoy
   * vive solo en 14c; cualquier otra mención tiene que llevar "fork" al lado,
   * porque entonces habla del conteo congelado y no del vigente.
   */
  it("el conteo de hoy no aparece suelto fuera de 14c", () => {
    const tablas = tablasDeclaradas().size;
    const sueltas = plano
      .split("\n")
      .filter((l) => new RegExp(`\\b${tablas} tablas\\b`).test(l))
      .filter((l) => !l.includes("| Tablas existentes |"))
      .filter((l) => !/fork/i.test(l))
      .filter((l) => !/14c/i.test(l));

    expect(
      sueltas.map((l) => l.trim().slice(0, 120)),
      `El conteo vigente (${tablas} tablas) aparece fuera de 14c y sin decir de qué marco es. ` +
        `O lleva "del fork" al lado, o referencia a 14c, o se borra.`
    ).toEqual([]);
  });
});
