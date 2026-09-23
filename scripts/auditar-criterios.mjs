#!/usr/bin/env node
/**
 * Auditoría de criterios perdidos en la conciliación de `584226f` (21/09/2026),
 * que juntó los dos planos en `docs/requerimientos-fase1.md`.
 *
 * Toma cada criterio (`- [ ]` y sus sub-viñetas) de un documento en un commit
 * y busca, entre los criterios del plano actual, el que más palabras con
 * contenido le comparte. Si ninguno llega al UMBRAL, el criterio va a la lista
 * de candidatos a revisión. **No decide si se perdió**: eso lo decide una
 * persona, clasificándolo como perdido, reescrito o descartado con motivo.
 *
 * UMBRAL fijado ANTES de ver resultados, el 22/09/2026: 0,75. Alto a propósito,
 * porque un falso "perdido" cuesta una revisión y un falso "presente" esconde
 * una pérdida. Límite conocido: compara contra todo el plano, así que un
 * criterio puede "aparecer" en otra funcionalidad con palabras parecidas. Por
 * eso se imprime dónde está la mejor coincidencia.
 *
 * Uso: node scripts/auditar-criterios.mjs <commit> <archivo> [regex de encabezado]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const UMBRAL = 0.75;
const VACIAS = new Set(
  "a al con de del el en es la las lo los o para por que se sin su sus un una uno y ya no si como cada".split(" ")
);

const [commit, archivo, filtro] = process.argv.slice(2);
const viejo = execFileSync("git", ["show", `${commit}:${archivo}`], { encoding: "utf8" });
const actual = readFileSync("docs/requerimientos-fase1.md", "utf8");

const palabras = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[`*_>#()[\]"“”'.,:;!?¿¡/\\|=-]/g, " ")
    .split(/\s+/).filter((w) => w.length > 1 && !VACIAS.has(w));

function criterios(texto) {
  const salida = [];
  let seccion = "";
  for (const linea of texto.split("\n")) {
    const h = linea.match(/^#{2,4} (.+)/);
    if (h) seccion = h[1];
    if (/^\s*- \[ \]/.test(linea) || /^ {4}- /.test(linea)) salida.push({ seccion, texto: linea.trim() });
  }
  return salida;
}

const actuales = criterios(actual).map((c) => ({ ...c, set: new Set(palabras(c.texto)) }));
let revisados = 0;
for (const c of criterios(viejo)) {
  if (filtro && !new RegExp(filtro).test(c.seccion)) continue;
  revisados++;
  const p = [...new Set(palabras(c.texto))];
  if (!p.length) continue;
  let mejor = { score: 0 };
  for (const a of actuales) {
    const score = p.filter((w) => a.set.has(w)).length / p.length;
    if (score > mejor.score) mejor = { score, a };
  }
  if (mejor.score < UMBRAL) {
    console.log(`\n[${mejor.score.toFixed(2)}] ${c.seccion}\n  VIEJO:  ${c.texto.slice(0, 220)}`);
    console.log(`  MEJOR:  ${mejor.a ? `${mejor.a.seccion} :: ${mejor.a.texto.slice(0, 160)}` : "(ninguna)"}`);
  }
}
console.log(`\nRevisados: ${revisados} criterios de ${archivo} en ${commit}.`);
