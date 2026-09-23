import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  PLANO,
  FOTO,
  BAJAS,
  extraerCriterios,
  compararCriterios,
  fotoDeCommit,
  leerJson,
} from "../scripts/foto-criterios.mjs";

/**
 * Ningún criterio de aceptación del plano desaparece sin dejar dicho por qué.
 *
 * En `584226f` (21/09/2026) la conciliación de los dos planos perdió criterios
 * en silencio. Este test compara el plano contra `docs/criterios-foto.json`:
 * cada línea de la foto tiene que seguir en el plano, o estar en
 * `docs/criterios-bajas.json` como reescrita (con el texto nuevo presente) o
 * dada de baja (con motivo). La foto se regenera con
 * `node scripts/foto-criterios.mjs --escribir`, que se niega a hacerlo si
 * alguna línea que se fue no está explicada.
 *
 * Se vio en rojo antes del verde: sacando a mano una línea de criterio del
 * plano, y en el caso histórico de abajo.
 */

type Criterio = { seccion: string; texto: string };

const plano = readFileSync(PLANO, "utf8");
const foto = leerJson(FOTO, null) as Criterio[] | null;
const bajas = leerJson(BAJAS, []);

describe("la foto de criterios del plano", () => {
  it("existe y no está vacía", () => {
    expect(foto, `Falta ${FOTO}. Crearla con: node scripts/foto-criterios.mjs --escribir`).not.toBeNull();
    expect(foto!.length).toBeGreaterThan(100);
  });

  it("ninguna línea de criterio se fue sin explicar", () => {
    const { faltantes, reescriturasRotas } = compararCriterios(foto ?? [], plano, bajas);
    const lista = [...faltantes, ...reescriturasRotas].map((c) => `  [${c.seccion}] ${c.texto.slice(0, 160)}`).join("\n");
    expect(
      faltantes.length + reescriturasRotas.length,
      `Estas líneas de criterio ya no están en el plano y no figuran en ${BAJAS}:\n${lista}\n\n` +
        `Si se reescribieron o se dieron de baja a propósito, agregá cada una a ${BAJAS} con su ` +
        `destino y su motivo, y después corré node scripts/foto-criterios.mjs --escribir.`
    ).toBe(0);
  });

  /**
   * Las líneas nuevas también fallan, para que la foto no quede vieja: un
   * criterio que no está en la foto no está protegido. Se arregla con un solo
   * comando y sin preguntas, porque agregar no necesita motivo.
   */
  it("la foto está al día con los criterios nuevos", () => {
    const { nuevas } = compararCriterios(foto ?? [], plano, bajas);
    expect(
      nuevas,
      `Hay criterios nuevos que la foto no protege todavía. Correr: node scripts/foto-criterios.mjs --escribir`
    ).toEqual([]);
  });

  it("cada baja dice qué pasó y por qué", () => {
    for (const b of bajas) {
      expect(["reescrito", "baja"], `destino inválido en ${BAJAS}: ${JSON.stringify(b)}`).toContain(b.destino);
      expect(String(b.motivo ?? "").trim(), `baja sin motivo: ${JSON.stringify(b)}`).not.toBe("");
      if (b.destino === "reescrito") expect(String(b.nuevo ?? "").trim()).not.toBe("");
    }
  });
});

describe("el detector, contra el caso real que lo originó", () => {
  let hayHistoria = true;
  try {
    execFileSync("git", ["cat-file", "-e", "584226f^{commit}"], { stdio: "ignore" });
  } catch {
    hayHistoria = false;
  }

  /**
   * Control positivo: con la foto que habrían tenido los planos de `ebc9702`,
   * el plano de `584226f` tiene que dar faltantes, y entre ellos el criterio
   * de tiempo real que se perdió. Sin historia de git (un clon superficial) se
   * saltea a la vista, no se da por verde.
   */
  it.skipIf(!hayHistoria)("detecta el criterio de tiempo real que perdió 584226f", () => {
    const planoViejo = execFileSync("git", ["show", `584226f:${PLANO}`], { encoding: "utf8" });
    const { faltantes } = compararCriterios(fotoDeCommit("ebc9702"), planoViejo);
    expect(faltantes.map((c) => c.texto)).toContain("- [ ] El estado de cada integración se actualiza en tiempo real");
  });

  it("una sub-viñeta o un párrafo de continuación cuentan como parte del criterio", () => {
    const texto = "#### F1: x\n\n- [ ] Criterio\n    - detalle\n\n  continuación\n\nProsa que no es criterio\n    - viñeta suelta";
    expect(extraerCriterios(texto).map((c) => c.texto)).toEqual(["- [ ] Criterio", "- detalle", "continuación"]);
  });
});
