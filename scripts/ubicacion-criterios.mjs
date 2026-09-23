#!/usr/bin/env node
/**
 * Informe de copias perdidas y criterios mudados entre dos commits.
 *
 * **Por qué existe.** Hasta el 23/09/2026, `compararCriterios` (en
 * `foto-criterios.mjs`) armaba un conjunto con los textos del plano y
 * preguntaba si cada línea de la foto estaba. Eso tenía dos cegueras:
 *
 * - **Duplicados.** Si un texto aparecía dos veces y queda una, el conjunto lo
 *   sigue teniendo y la copia que se fue no cuenta como faltante.
 * - **Mudanzas.** Si una línea pasa de una funcionalidad a otra, o del alcance
 *   de la fase al apéndice del plan B, el texto sigue estando y nada avisa. Un
 *   criterio que se muda a una sección que no se construye se perdió igual.
 *
 * Este script se escribió en `8d69af7` para verificar que la lista de 128 de
 * `docs/auditoria-conciliacion.md` estuviera completa. Desde el 23/09/2026 la
 * guardia del plano (`compararCriterios`) compara igual, por apariciones y
 * ruta, y usa el mismo extractor y la misma resta. Este script queda como
 * informe: agrupa por texto, dice de qué archivo viene cada línea y marca si
 * terminó fuera de la Fase 1.
 *
 * Uso:
 *   node scripts/ubicacion-criterios.mjs --foto-de ebc9702 --plano-de 584226f
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLANO, PLANOS_ORIGINALES, extraerCriterios, restar } from "./foto-criterios.mjs";

/**
 * Secciones que no se construyen en la Fase 1, reconocidas por cualquier
 * encabezado de la ruta. Lista fijada leyendo los encabezados de `584226f`, no
 * los resultados: el apéndice del plan B, las funcionalidades de fases
 * siguientes, el §13 de fuera de alcance y F5, que se eliminó de la fase.
 */
export const FUERA_DE_FASE_1 = [
  /^Apéndice: plan B/,
  /^Funcionalidades de fases siguientes/,
  /^\d+\. Fuera del alcance/,
  /^Especificado pero no construido/,
  /^F5: TikTok/,
];

export const fueraDeFase1 = (ruta) => ruta.some((h) => FUERA_DE_FASE_1.some((re) => re.test(h)));

const agrupar = (xs) => {
  const m = new Map();
  for (const x of xs) {
    if (!m.has(x.texto)) m.set(x.texto, []);
    m.get(x.texto).push(x);
  }
  return m;
};

const clave = (c) => c.ruta.join(" > ");
const porSeccion = (c) => c.seccion;

/**
 * Compara dos listas de líneas con ruta.
 *
 * - `menosCopias`: textos que aparecen menos veces después que antes. Los que
 *   quedan en cero son los faltantes de siempre; los que quedan en uno o más
 *   son los que `compararCriterios` no ve.
 * - `mudanzas`: textos presentes en los dos lados cuya ruta cambió. `de` son
 *   las ubicaciones viejas que no se conservaron y `a` las nuevas.
 */
export function compararUbicaciones(viejas, nuevas) {
  const V = agrupar(viejas);
  const N = agrupar(nuevas);
  const menosCopias = [];
  const mudanzas = [];
  for (const [texto, antes] of V) {
    const despues = N.get(texto) ?? [];
    if (despues.length < antes.length) menosCopias.push({ texto, antes, despues });
    if (!despues.length) continue;
    const de = restar(antes, despues, clave);
    const a = restar(despues, antes, clave);
    if (de.length || a.length) {
      mudanzas.push({
        texto,
        de,
        a,
        cambiaFuncionalidad: restar(antes, despues, porSeccion).length + restar(despues, antes, porSeccion).length > 0,
        terminaFueraDeFase1: a.some((x) => fueraDeFase1(x.ruta)) && !despues.some((x) => !fueraDeFase1(x.ruta)),
        algunaCopiaFueraDeFase1: a.some((x) => fueraDeFase1(x.ruta)),
      });
    }
  }
  return { menosCopias, mudanzas };
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Las líneas de los dos planos originales en un commit, con el archivo de origen. */
export function lineasDeCommit(commit, archivos = PLANOS_ORIGINALES) {
  return archivos.flatMap((archivo) => {
    let texto;
    try {
      texto = git(["show", `${commit}:${archivo}`]);
    } catch {
      return [];
    }
    return extraerCriterios(texto).map((c) => ({ ...c, archivo }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const fotoDe = arg("--foto-de");
  const planoDe = arg("--plano-de");
  if (!fotoDe || !planoDe) {
    console.log("Uso: node scripts/ubicacion-criterios.mjs --foto-de <commit> --plano-de <commit>");
    process.exit(2);
  }
  const viejas = lineasDeCommit(fotoDe);
  const nuevas = lineasDeCommit(planoDe, [PLANO]);
  const corto = (t) => t.slice(0, 150);
  const donde = (xs) => xs.map((x) => `${x.archivo ? x.archivo.replace("docs/", "") + " :: " : ""}${clave(x)}`).join("\n        ");

  console.log(`Líneas por archivo en ${fotoDe}:`);
  for (const a of PLANOS_ORIGINALES) console.log(`  ${a}: ${viejas.filter((x) => x.archivo === a).length}`);
  console.log(`Líneas en ${PLANO} de ${planoDe}: ${nuevas.length}\n`);

  const { menosCopias, mudanzas } = compararUbicaciones(viejas, nuevas);
  const ceros = menosCopias.filter((m) => !m.despues.length);
  const parciales = menosCopias.filter((m) => m.despues.length);
  console.log(`Textos con menos apariciones: ${menosCopias.length} (en cero: ${ceros.length}; con copias restantes: ${parciales.length})`);
  for (const m of parciales) {
    console.log(`\n  ${m.antes.length} -> ${m.despues.length}  ${corto(m.texto)}`);
    console.log(`      antes: ${donde(m.antes)}`);
    console.log(`      después: ${donde(m.despues)}`);
  }

  console.log(`\nMudanzas (texto presente en los dos, con otra ruta): ${mudanzas.length}`);
  for (const m of mudanzas) {
    const marcas = [m.cambiaFuncionalidad && "CAMBIA DE FUNCIONALIDAD", m.terminaFueraDeFase1 && "TERMINA FUERA DE FASE 1", !m.terminaFueraDeFase1 && m.algunaCopiaFueraDeFase1 && "UNA COPIA FUERA DE FASE 1"].filter(Boolean);
    console.log(`\n  [${marcas.join(", ") || "solo cambia el contenedor"}] ${corto(m.texto)}`);
    console.log(`      de: ${donde(m.de) || "(se conservan todas)"}`);
    console.log(`      a:  ${donde(m.a) || "(ninguna nueva)"}`);
  }
}
