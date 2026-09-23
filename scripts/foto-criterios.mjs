#!/usr/bin/env node
/**
 * La foto de los criterios de aceptación del plano, y su regeneración.
 *
 * **Por qué existe.** En `584226f` (21/09/2026), la conciliación de los dos
 * planos en `docs/requerimientos-fase1.md` perdió criterios en silencio: "El
 * estado de cada integración se actualiza en tiempo real", entre otros. Nada lo
 * detectó durante un día. Ver `docs/auditoria-conciliacion.md`.
 *
 * **Qué protege.** `docs/criterios-foto.json` es una instantánea de cada línea
 * de criterio del plano, con la ruta completa de encabezados que lleva a ella.
 * `docs/plano-criterios.test.ts` falla si una aparición de la foto ya no está
 * en el plano **en la misma ruta** y no figura en `docs/criterios-bajas.json`
 * como reescrita (con el texto nuevo, que sí tiene que estar), dada de baja
 * (con su motivo) o movida (con la ruta nueva, donde tiene que estar). Se
 * cuentan apariciones, no textos: borrar una de dos copias también falla. Mira
 * de hoy en adelante; lo perdido antes lo busca la auditoría.
 *
 * **Qué es una línea de criterio.** Cada línea no vacía de un bloque que
 * empieza con `- [ ]`: la línea misma, sus sub-viñetas y sus párrafos de
 * continuación con sangría. Se compara el texto exacto, con los espacios
 * normalizados. Exacto a propósito: sacar "y estado" de un criterio es
 * justamente la clase de pérdida que pasó, y una comparación aproximada la
 * dejaría pasar.
 *
 * Uso:
 *   node scripts/foto-criterios.mjs              informa qué cambió contra la foto
 *   node scripts/foto-criterios.mjs --escribir   regenera la foto, solo si cada
 *                                                línea que se fue o se movió está
 *                                                en las bajas
 *   node scripts/foto-criterios.mjs --foto-de <commit> --plano-de <commit>
 *        compara el plano de un commit contra la foto armada con los planos de
 *        otro. Es el caso de prueba histórico: ebc9702 contra 584226f.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PLANO = "docs/requerimientos-fase1.md";
export const FOTO = "docs/criterios-foto.json";
export const BAJAS = "docs/criterios-bajas.json";
/** Los dos planos que existían antes de la conciliación de `584226f`. */
export const PLANOS_ORIGINALES = ["docs/requerimientos-fase1.md", "docs/requerimientos-bloques-2-3-4.md"];

const normalizar = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Cada línea no vacía de cada bloque de criterio, con la sección donde está y
 * la ruta de encabezados (niveles 2 a 4) que lleva hasta ella. La ruta es lo
 * que distingue "F6b dentro del Bloque 1" de "F6b dentro del apéndice".
 */
export function extraerCriterios(texto) {
  const salida = [];
  const ruta = [];
  let enBloque = false;
  for (const linea of texto.split("\n")) {
    const h = linea.match(/^(#{2,4}) (.+)/);
    if (h) {
      ruta.length = h[1].length - 2;
      ruta.push(h[2].trim());
      enBloque = false;
      continue;
    }
    if (/^\s*- \[ \]/.test(linea)) {
      enBloque = true;
    } else if (linea.trim() === "") {
      continue; // una línea en blanco no corta el bloque; lo corta lo que venga sin sangría
    } else if (!/^\s/.test(linea)) {
      enBloque = false;
    }
    if (enBloque) {
      const r = ruta.filter(Boolean);
      salida.push({ seccion: r[r.length - 1] ?? "", ruta: r, texto: normalizar(linea) });
    }
  }
  return salida;
}

/** Una aparición se identifica por su texto y su ruta completa. */
export const clave = (c) => `${c.texto}\u0000${(c.ruta ?? []).join("\u0000")}`;
const mismaRuta = (a = [], b = []) => a.length === b.length && a.every((h, i) => normalizar(h) === normalizar(b[i]));

/** Resta de multiconjuntos: las apariciones de `a` que `b` no cubre, según `llave`. */
export function restar(a, b, llave = clave) {
  const quedan = new Map();
  for (const x of b) quedan.set(llave(x), (quedan.get(llave(x)) ?? 0) + 1);
  return a.filter((x) => {
    const n = quedan.get(llave(x)) ?? 0;
    if (!n) return true;
    quedan.set(llave(x), n - 1);
    return false;
  });
}

/**
 * Compara la foto contra el plano por **apariciones**: texto y ruta completa
 * de encabezados, contando cuántas veces está cada una. Un conjunto de textos
 * no alcanza: no ve la copia borrada de un texto duplicado, ni la línea que se
 * muda de funcionalidad o al apéndice del plan B (ver `8d69af7`).
 *
 * Cada aparición de la foto que ya no está en su lugar se explica con una
 * entrada de las bajas, y cada entrada explica **una sola** aparición:
 *
 * - `reescrito`: el texto `nuevo` tiene que estar en el plano.
 * - `baja`: alcanza con el motivo.
 * - `movido`: el mismo texto tiene que estar en `ruta`, la ruta nueva.
 *
 * `desde` (la ruta vieja) es optativo y elige cuál de las copias se explica.
 *
 * Devuelve `faltantes` (se fue y no hay explicación), `mudanzas` (el mismo
 * texto está en otra ruta y no hay explicación), `reescriturasRotas`,
 * `movidasRotas` y `nuevas` (apariciones del plano que la foto no tiene, que
 * incluyen el destino de toda mudanza hasta que se regenera la foto).
 */
export function compararCriterios(foto, planoTexto, bajas = []) {
  const actuales = extraerCriterios(planoTexto);
  const textosActuales = new Set(actuales.map((c) => c.texto));
  const idos = restar(foto, actuales);
  const llegados = restar(actuales, foto);
  const pendientes = bajas.filter((b) => String(b.motivo ?? "").trim());

  const faltantes = [];
  const mudanzas = [];
  const reescriturasRotas = [];
  const movidasRotas = [];
  for (const c of idos) {
    const i = pendientes.findIndex((b) => normalizar(b.texto ?? "") === c.texto && (!b.desde || mismaRuta(b.desde, c.ruta)));
    const destino = llegados.find((x) => x.texto === c.texto && !x.usado);
    if (i < 0) {
      if (destino) {
        destino.usado = true;
        mudanzas.push({ ...c, rutaNueva: destino.ruta });
      } else {
        faltantes.push(c);
      }
      continue;
    }
    const [b] = pendientes.splice(i, 1);
    if (b.destino === "reescrito") {
      if (!textosActuales.has(normalizar(b.nuevo ?? ""))) reescriturasRotas.push({ ...c, nuevo: b.nuevo });
    } else if (b.destino === "movido") {
      const aca = llegados.find((x) => x.texto === c.texto && !x.usado && mismaRuta(x.ruta, b.ruta));
      if (aca) aca.usado = true;
      else movidasRotas.push({ ...c, rutaDeclarada: b.ruta });
    }
  }
  const nuevas = llegados.map(({ usado, ...x }) => x);
  return { faltantes, mudanzas, reescriturasRotas, movidasRotas, nuevas };
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** La foto que habrían tenido los planos de un commit, si ya hubiera existido. */
export function fotoDeCommit(commit) {
  return PLANOS_ORIGINALES.flatMap((archivo) => {
    try {
      return extraerCriterios(git(["show", `${commit}:${archivo}`]));
    } catch {
      return [];
    }
  });
}

export const leerJson = (ruta, porDefecto) => (existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : porDefecto);

const donde = (ruta) => ruta.join(" > ");

/** Lo que impide regenerar la foto: todo lo que se fue o se movió sin explicación válida. */
export const sinExplicar = (r) => r.faltantes.length + r.mudanzas.length + r.reescriturasRotas.length + r.movidasRotas.length;

function informar({ faltantes, mudanzas, reescriturasRotas, movidasRotas, nuevas }) {
  for (const c of faltantes) console.log(`FALTA   [${donde(c.ruta)}] ${c.texto.slice(0, 200)}`);
  for (const c of mudanzas) console.log(`MUDADA  [${donde(c.ruta)}] -> [${donde(c.rutaNueva)}] ${c.texto.slice(0, 160)}`);
  for (const c of reescriturasRotas) console.log(`REESCRITURA ROTA [${donde(c.ruta)}] el texto nuevo no está: ${String(c.nuevo).slice(0, 160)}`);
  for (const c of movidasRotas) console.log(`MOVIDA ROTA [${donde(c.ruta)}] no está en [${donde(c.rutaDeclarada ?? [])}]: ${c.texto.slice(0, 160)}`);
  console.log(
    `\nFaltantes sin explicar: ${faltantes.length}. Mudanzas sin explicar: ${mudanzas.length}. ` +
      `Reescrituras rotas: ${reescriturasRotas.length}. Movidas rotas: ${movidasRotas.length}. ` +
      `Apariciones nuevas sin foto: ${nuevas.length}.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const fotoDe = arg("--foto-de");
  const planoDe = arg("--plano-de");

  if (fotoDe && planoDe) {
    const r = compararCriterios(fotoDeCommit(fotoDe), git(["show", `${planoDe}:${PLANO}`]));
    console.log(`Foto de ${fotoDe} (los dos planos originales) contra el plano de ${planoDe}:\n`);
    informar(r);
    process.exit(sinExplicar(r) ? 1 : 0);
  }

  const foto = leerJson(FOTO, null);
  const plano = readFileSync(PLANO, "utf8");
  const bajas = leerJson(BAJAS, []);
  const escribir = process.argv.includes("--escribir");

  if (!foto) {
    if (!escribir) {
      console.log(`No hay foto todavía. Correr con --escribir para crearla.`);
      process.exit(1);
    }
  } else {
    const r = compararCriterios(foto, plano, bajas);
    informar(r);
    if (sinExplicar(r)) {
      console.log(`\nNo se regenera la foto. Cada línea que se fue o se movió tiene que estar en ${BAJAS}:`);
      console.log(`  { "texto": "<la línea vieja, tal cual>", "destino": "reescrito" | "baja" | "movido",`);
      console.log(`    "nuevo": "<el texto nuevo, si es reescrito>", "ruta": ["<la ruta nueva, si es movido>"],`);
      console.log(`    "desde": ["<la ruta vieja, optativa: elige entre copias>"], "motivo": "<por qué>", "fecha": "AAAA-MM-DD" }`);
      console.log(`Cada entrada explica una sola aparición.`);
      process.exit(1);
    }
    if (!escribir) process.exit(0);
  }
  const nueva = extraerCriterios(plano);
  writeFileSync(FOTO, JSON.stringify(nueva, null, 2) + "\n");
  console.log(`Foto escrita: ${nueva.length} líneas de criterio en ${FOTO}.`);
}
