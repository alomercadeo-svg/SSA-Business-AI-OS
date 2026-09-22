import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { leerSinSubir, vencido, UN_DIA_MS } from "./commits-sin-subir.mjs";

/**
 * La compuerta de cierre de sesión: los dos controles que faltaron el
 * 22/09/2026, cuando producción y el repositorio se desincronizaron dos veces
 * en el mismo día. El relato está en `docs/estado-fase1.md` y la regla en el
 * `CLAUDE.md`, sección "Cierre de sesión".
 *
 * Los dos se corrieron antes de que existieran las condiciones que arreglan y
 * fallaron: el de commits en un clon con un commit sin subir fechado dos días
 * atrás, y el de tipos contra un error real que el build de Next no ve.
 */

const AHORA = Date.UTC(2026, 8, 23, 12, 0, 0);
const hace = (ms: number) => ({ upstream: "origin/x", cantidad: 1, masViejo: new Date(AHORA - ms) });

describe("commits sin subir", () => {
  it("se vence pasado un día, y no antes", () => {
    expect(vencido(hace(UN_DIA_MS + 60_000), AHORA)).toBe(true);
    expect(vencido(hace(UN_DIA_MS - 60_000), AHORA)).toBe(false);
    expect(vencido(hace(0), AHORA)).toBe(false);
  });

  it("sin commits sin subir no hay nada vencido", () => {
    expect(vencido({ upstream: "origin/x", cantidad: 0, masViejo: null }, AHORA)).toBe(false);
  });

  const estado = leerSinSubir();

  /**
   * En un clon nuevo, o en una rama que nunca se subió, no hay contra qué
   * comparar. Se saltea a la vista, como "skipped", y no se da por verde: un
   * test que pasa porque no pudo medir es la falla que este proyecto persigue.
   */
  it.skipIf(!estado.upstream)(
    "el commit sin subir más viejo no tiene más de un día",
    () => {
      expect(
        vencido(estado),
        `Hay ${estado.cantidad} commit(s) sin subir contra ${estado.upstream}, y el más viejo es ` +
          `del ${estado.masViejo?.toISOString()}. Subilos y verificá el despliegue, o escribí en ` +
          `docs/estado-fase1.md por qué no y qué condición lo destraba.`
      ).toBe(false);
    }
  );
});

describe("tipos", () => {
  /**
   * Vitest no chequea tipos, así que la suite puede estar en verde con un
   * error que rompe `next build`. Pasó el 22/09/2026: el tipo `WebhookEvent`
   * quedó con dos eventos cuando la lista tenía tres, 211 tests en verde, y el
   * build de Railway falló. Este test corre `tsc` sobre todo el proyecto, que
   * además mira archivos que el build de Next no mira, como los tests.
   */
  it("tsc --noEmit pasa sin errores", () => {
    let salida = "";
    try {
      execFileSync("npx", ["tsc", "--noEmit", "-p", "."], { encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      salida = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(err);
    }
    expect(salida, `tsc encontró errores de tipos:\n${salida}`).toBe("");
  }, 120_000);
});
