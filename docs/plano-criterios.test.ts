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
 * en silencio. Este test compara el plano contra `docs/criterios-foto.json`
 * por apariciones: texto y ruta completa de encabezados, contadas. Cada
 * aparición de la foto tiene que seguir en el plano en la misma ruta, o estar
 * en `docs/criterios-bajas.json` como reescrita (con el texto nuevo presente),
 * dada de baja (con motivo) o movida (con la ruta nueva, donde tiene que
 * estar). La foto se regenera con `node scripts/foto-criterios.mjs --escribir`,
 * que se niega a hacerlo si alguna no está explicada.
 *
 * Se vio en rojo antes del verde: sacando a mano una línea de criterio del
 * plano, en el caso histórico de abajo y, el 23/09/2026, con los tres casos
 * trampa de `8d69af7` contra la comparación por conjunto de textos, que tenía
 * antes. Siguieron en rojo después de agregarle la ruta al extractor, y
 * pasaron a verde recién con la comparación por apariciones.
 */

type Criterio = { seccion: string; ruta: string[]; texto: string };

const plano = readFileSync(PLANO, "utf8");
const foto = leerJson(FOTO, null) as Criterio[] | null;
const bajas = leerJson(BAJAS, []);

describe("la foto de criterios del plano", () => {
  it("existe y no está vacía", () => {
    expect(foto, `Falta ${FOTO}. Crearla con: node scripts/foto-criterios.mjs --escribir`).not.toBeNull();
    expect(foto!.length).toBeGreaterThan(100);
  });

  it("ninguna línea de criterio se fue ni se mudó sin explicar", () => {
    const { faltantes, mudanzas, reescriturasRotas, movidasRotas } = compararCriterios(foto ?? [], plano, bajas);
    const donde = (c: Criterio) => c.ruta.join(" > ");
    const lista = [
      ...faltantes.map((c) => `  FALTA   [${donde(c)}] ${c.texto.slice(0, 160)}`),
      ...mudanzas.map((c) => `  MUDADA  [${donde(c)}] -> [${c.rutaNueva.join(" > ")}] ${c.texto.slice(0, 120)}`),
      ...reescriturasRotas.map((c) => `  REESCRITURA ROTA [${donde(c)}] ${c.texto.slice(0, 160)}`),
      ...movidasRotas.map((c) => `  MOVIDA ROTA [${donde(c)}] no está en la ruta declarada: ${c.texto.slice(0, 120)}`),
    ].join("\n");
    expect(
      faltantes.length + mudanzas.length + reescriturasRotas.length + movidasRotas.length,
      `Estas líneas de criterio ya no están donde estaban y no figuran en ${BAJAS}:\n${lista}\n\n` +
        `Si se reescribieron, se dieron de baja o se movieron a propósito, agregá cada una a ${BAJAS} ` +
        `con su destino y su motivo, y después corré node scripts/foto-criterios.mjs --escribir.`
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
      expect(["reescrito", "baja", "movido"], `destino inválido en ${BAJAS}: ${JSON.stringify(b)}`).toContain(b.destino);
      expect(String(b.motivo ?? "").trim(), `baja sin motivo: ${JSON.stringify(b)}`).not.toBe("");
      if (b.destino === "reescrito") expect(String(b.nuevo ?? "").trim()).not.toBe("");
      if (b.destino === "movido") {
        expect(Array.isArray(b.ruta) && b.ruta.length > 0, `movido sin ruta nueva: ${JSON.stringify(b)}`).toBe(true);
      }
    }
  });
});

/**
 * Los tres casos trampa de `8d69af7`: una copia borrada de un texto duplicado,
 * una línea que cambia de funcionalidad, y una que conserva el nombre de su
 * sección pero cambia de padre (lo que pasó con F6b al irse al apéndice). Una
 * comparación por conjunto de textos no ve ninguno de los tres.
 */
const VIEJO = [
  "#### F1: Uno",
  "",
  "- [ ] Duplicada",
  "- [ ] Se muda",
  "- [ ] Se queda",
  "",
  "#### F2: Dos",
  "",
  "- [ ] Duplicada",
  "",
  "### Bloque 1",
  "",
  "#### F6b: Algo",
  "",
  "- [ ] Cambia de padre",
].join("\n");

const NUEVO = [
  "#### F1: Uno",
  "",
  "- [ ] Duplicada",
  "- [ ] Se queda",
  "",
  "#### F2: Dos",
  "",
  "### Apéndice: plan B",
  "",
  "#### F6b: Algo",
  "",
  "- [ ] Se muda",
  "- [ ] Cambia de padre",
].join("\n");

const APENDICE = ["Apéndice: plan B", "F6b: Algo"];

describe("la comparación ve copias borradas y mudanzas", () => {
  const r = () => compararCriterios(extraerCriterios(VIEJO), NUEVO);

  it("una copia borrada de un texto duplicado es un faltante", () => {
    expect(r().faltantes.map((c) => [c.seccion, c.texto])).toEqual([["F2: Dos", "- [ ] Duplicada"]]);
  });

  it("una línea que cambia de funcionalidad es una mudanza", () => {
    const m = r().mudanzas?.find((x) => x.texto === "- [ ] Se muda");
    expect(m, "la mudanza de F1 al apéndice no se detectó").toBeDefined();
    expect(m!.ruta).toEqual(["F1: Uno"]);
    expect(m!.rutaNueva).toEqual(APENDICE);
  });

  it("una línea que conserva su sección pero cambia de padre es una mudanza", () => {
    const m = r().mudanzas?.find((x) => x.texto === "- [ ] Cambia de padre");
    expect(m, "el cambio de padre de F6b no se detectó").toBeDefined();
    expect(m!.ruta).toEqual(["Bloque 1", "F6b: Algo"]);
    expect(m!.rutaNueva).toEqual(APENDICE);
  });

  it("un plano igual a su foto no da nada", () => {
    const iguales = compararCriterios(extraerCriterios(VIEJO), VIEJO);
    expect([iguales.faltantes, iguales.mudanzas, iguales.nuevas]).toEqual([[], [], []]);
  });

  /** Control positivo de las bajas: explicadas, las tres dejan de fallar. */
  it("explicadas en las bajas, ninguna de las tres falla", () => {
    const bajas = [
      { texto: "- [ ] Duplicada", desde: ["F2: Dos"], destino: "baja", motivo: "una copia sobraba" },
      { texto: "- [ ] Se muda", destino: "movido", ruta: APENDICE, motivo: "pasa al plan B" },
      { texto: "- [ ] Cambia de padre", destino: "movido", ruta: APENDICE, motivo: "pasa al plan B" },
    ];
    const x = compararCriterios(extraerCriterios(VIEJO), NUEVO, bajas);
    expect([x.faltantes, x.mudanzas, x.movidasRotas, x.reescriturasRotas]).toEqual([[], [], [], []]);
  });

  it("un movido cuya ruta no es donde está la línea no explica nada", () => {
    const bajas = [{ texto: "- [ ] Se muda", destino: "movido", ruta: ["F2: Dos"], motivo: "x" }];
    const x = compararCriterios(extraerCriterios(VIEJO), NUEVO, bajas);
    expect(x.movidasRotas.map((c) => c.texto)).toEqual(["- [ ] Se muda"]);
  });

  it("una baja explica una sola aparición: borrar las dos copias pide dos", () => {
    const sinCopias = NUEVO.replace("- [ ] Duplicada\n", "");
    const una = [{ texto: "- [ ] Duplicada", destino: "baja", motivo: "x" }];
    expect(compararCriterios(extraerCriterios(VIEJO), sinCopias, una).faltantes.map((c) => c.texto)).toEqual(["- [ ] Duplicada"]);
    expect(compararCriterios(extraerCriterios(VIEJO), sinCopias, [...una, ...una]).faltantes).toEqual([]);
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
    const { faltantes, mudanzas } = compararCriterios(fotoDeCommit("ebc9702"), planoViejo);
    expect(faltantes.map((c) => c.texto)).toContain("- [ ] El estado de cada integración se actualiza en tiempo real");
    // La copia de F6 de un texto duplicado, y las mudanzas de F6b y F6c: lo que el conjunto de textos no veía.
    expect(faltantes).toHaveLength(129);
    expect(faltantes.filter((c) => c.texto === "- [ ] El estado de la conexión es visible en `/settings/integrations`").map((c) => c.seccion))
      .toEqual(["F6: WhatsApp por API oficial vía Zernio"]);
    expect(mudanzas).toHaveLength(16);
  });

  it("una sub-viñeta o un párrafo de continuación cuentan como parte del criterio", () => {
    const texto = "#### F1: x\n\n- [ ] Criterio\n    - detalle\n\n  continuación\n\nProsa que no es criterio\n    - viñeta suelta";
    expect(extraerCriterios(texto).map((c) => c.texto)).toEqual(["- [ ] Criterio", "- detalle", "continuación"]);
  });
});
