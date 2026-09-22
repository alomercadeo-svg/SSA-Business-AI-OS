#!/usr/bin/env node
/**
 * Commits sin subir: cuántos hay y de cuándo es el más viejo.
 *
 * **Por qué existe.** El 22/09/2026 producción y el repositorio se
 * desincronizaron dos veces el mismo día. La primera: 19 commits sin subir
 * desde el 21, entre ellos el que sumaba `message.sent` a la suscripción del
 * webhook; una rotación del secreto hizo que producción re-registrara el
 * webhook con su lista vieja y le borró ese evento, sin error y sin aviso. La
 * segunda: al subirlos, el build falló por un error de tipos que los tests no
 * chequean. Ver `docs/estado-fase1.md`.
 *
 * Se usa de dos formas:
 *
 * - Al abrir sesión, `node scripts/commits-sin-subir.mjs` informa la cantidad
 *   y la fecha del más viejo. Es lo que pide el `CLAUDE.md`.
 * - `scripts/compuerta-cierre.test.ts` importa `leerSinSubir` y `vencido`, y
 *   se pone en rojo si el más viejo tiene más de un día.
 *
 * **Por qué un día y no cero.** Con cero, el test falla apenas se commitea y
 * es ruido en medio de la sesión; un test que molesta siempre se termina
 * desactivando. Con un día se pone rojo a la mañana siguiente, que es
 * exactamente cuando un commit sin subir dejó de ser trabajo en curso.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const UN_DIA_MS = 24 * 60 * 60 * 1000;

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Lee el estado contra la rama remota que sigue la rama actual.
 *
 * Devuelve `{ upstream: null }` cuando no hay contra qué comparar: un clon
 * nuevo sin rama de seguimiento, una rama local que nunca se subió, o un
 * directorio sin git. En ese caso no hay medición, y quien lo use tiene que
 * decirlo como "no medido", nunca como "no hay commits sin subir".
 */
export function leerSinSubir(cwd = process.cwd()) {
  let upstream;
  try {
    upstream = git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    return { upstream: null, cantidad: null, masViejo: null };
  }
  const fechas = git(cwd, ["log", "--format=%ct", `${upstream}..HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((s) => Number(s) * 1000);
  return {
    upstream,
    cantidad: fechas.length,
    masViejo: fechas.length ? new Date(Math.min(...fechas)) : null,
  };
}

/** Si el commit sin subir más viejo supera el umbral. Sin commits, nunca. */
export function vencido(estado, ahoraMs = Date.now(), umbralMs = UN_DIA_MS) {
  if (!estado.masViejo) return false;
  return ahoraMs - estado.masViejo.getTime() > umbralMs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const e = leerSinSubir();
  if (!e.upstream) {
    console.log("No medido: la rama actual no sigue ninguna rama remota.");
  } else if (e.cantidad === 0) {
    console.log(`Sin commits sin subir contra ${e.upstream}.`);
  } else {
    const fecha = e.masViejo.toLocaleString("es-CR", { timeZone: "America/Costa_Rica" });
    console.log(`${e.cantidad} commit(s) sin subir contra ${e.upstream}. El más viejo es del ${fecha}`);
    if (vencido(e)) console.log("VENCIDO: el más viejo tiene más de un día. Subir o escribir por qué no.");
  }
}
