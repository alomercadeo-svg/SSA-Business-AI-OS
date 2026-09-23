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
 * de criterio del plano. `docs/plano-criterios.test.ts` falla si una línea de
 * la foto ya no está en el plano y no figura en `docs/criterios-bajas.json`
 * como reescrita (con el texto nuevo, que sí tiene que estar) o dada de baja
 * (con su motivo). Mira de hoy en adelante; lo perdido antes lo busca la
 * auditoría.
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
 *                                                línea que se fue está en las bajas
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

/** Cada línea no vacía de cada bloque de criterio, con la sección donde está. */
export function extraerCriterios(texto) {
  const salida = [];
  let seccion = "";
  let enBloque = false;
  for (const linea of texto.split("\n")) {
    const h = linea.match(/^#{2,4} (.+)/);
    if (h) {
      seccion = h[1].trim();
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
    if (enBloque) salida.push({ seccion, texto: normalizar(linea) });
  }
  return salida;
}

/**
 * Compara la foto contra el plano. `faltantes` son líneas de la foto que no
 * están en el plano y no se explican en las bajas; `reescriturasRotas`, bajas
 * de tipo reescrito cuyo texto nuevo tampoco está; `nuevas`, líneas del plano
 * que la foto todavía no tiene.
 */
export function compararCriterios(foto, planoTexto, bajas = []) {
  const actuales = new Set(extraerCriterios(planoTexto).map((c) => c.texto));
  const explicadas = new Map(bajas.map((b) => [normalizar(b.texto), b]));
  const enFoto = new Set(foto.map((c) => c.texto));
  const faltantes = [];
  const reescriturasRotas = [];
  for (const c of foto) {
    if (actuales.has(c.texto)) continue;
    const b = explicadas.get(c.texto);
    if (!b || !String(b.motivo ?? "").trim()) {
      faltantes.push(c);
    } else if (b.destino === "reescrito" && !actuales.has(normalizar(b.nuevo ?? ""))) {
      reescriturasRotas.push({ ...c, nuevo: b.nuevo });
    }
  }
  const nuevas = [...actuales].filter((t) => !enFoto.has(t));
  return { faltantes, reescriturasRotas, nuevas };
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

function informar({ faltantes, reescriturasRotas, nuevas }) {
  for (const c of faltantes) console.log(`FALTA   [${c.seccion}] ${c.texto.slice(0, 200)}`);
  for (const c of reescriturasRotas) console.log(`REESCRITURA ROTA [${c.seccion}] el texto nuevo no está: ${String(c.nuevo).slice(0, 160)}`);
  console.log(`\nFaltantes sin explicar: ${faltantes.length}. Reescrituras rotas: ${reescriturasRotas.length}. Líneas nuevas sin foto: ${nuevas.length}.`);
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
    process.exit(r.faltantes.length ? 1 : 0);
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
    if (r.faltantes.length || r.reescriturasRotas.length) {
      console.log(`\nNo se regenera la foto. Cada línea que se fue tiene que estar en ${BAJAS}:`);
      console.log(`  { "texto": "<la línea vieja, tal cual>", "destino": "reescrito" | "baja",`);
      console.log(`    "nuevo": "<el texto nuevo, si es reescrito>", "motivo": "<por qué>", "fecha": "AAAA-MM-DD" }`);
      process.exit(1);
    }
    if (!escribir) process.exit(0);
  }
  const nueva = extraerCriterios(plano);
  writeFileSync(FOTO, JSON.stringify(nueva, null, 2) + "\n");
  console.log(`Foto escrita: ${nueva.length} líneas de criterio en ${FOTO}.`);
}
