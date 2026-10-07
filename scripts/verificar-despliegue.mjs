#!/usr/bin/env node
/**
 * Sube la rama y verifica que lo subido se desplegó.
 *
 *   node scripts/verificar-despliegue.mjs
 *   node scripts/verificar-despliegue.mjs --sin-verificar-antes   # solo emergencias, ver abajo
 *
 * **Por qué existe.** El 05/10/2026 se subió `8c05383` y producción no cambió de
 * build: el despliegue había fallado en Railway por el script `prepare`, y la
 * única señal fue esperar ocho minutos mirando el identificador del build a
 * mano. Subir no es desplegar. Ver `docs/estado-fase1.md`, "Incidente del
 * despliegue".
 *
 * **Qué hace.**
 * 1. Lee el identificador del build que sirve producción, en el HTML de
 *    `/login` (`"b":"…"`, que Next escribe escapado dentro de un script). Si
 *    `/login` no responde 200 o no se encuentra el identificador, **no sube**.
 * 2. Corre `git push`. Si falla, sale con 1 sin esperar. Si no había nada para
 *    subir, lo dice y espera igual: así se corre el control negativo.
 * 3. Vuelve a leer cada 10 segundos. Sale con 0 cuando el identificador cambió
 *    y `/login` responde 200. Sale con 1 si en 5 minutos no cambió.
 *
 * **EL LÍMITE, Y HAY QUE SABERLO.** El identificador del build no dice qué
 * commit sirve producción. El script detecta **"no se desplegó nada nuevo"**,
 * que es lo que pasó el 05/10. **No detecta "se desplegó otro commit"**: si
 * había un despliegue anterior en curso y termina mientras el script espera, el
 * identificador cambia igual y el script da verde. Para saber qué commit está
 * activo hace falta la API de Railway, con un token que hoy no tenemos. Por eso
 * el historial de despliegues de Railway se sigue mirando al cerrar: es lo
 * único que muestra un despliegue fallido, su causa y el commit de cada uno.
 *
 * **SALIDA DE EMERGENCIA: `--sin-verificar-antes`.** Para cuando producción
 * está caída y hace falta subir un arreglo urgente: ahí `/login` no responde, y
 * la regla de no subir sin lectura previa trabaría justo el arreglo.
 * - Si la lectura previa falla, sube igual y avisa que no hubo lectura previa.
 * - Sigue leyendo `/login` cada 10 segundos, hasta 5 minutos, solo para ver si
 *   vuelve a responder 200 con un identificador.
 * - **Nunca da verde.** Sin lectura previa no hay con qué comparar, así que no
 *   puede afirmar que lo que responde es lo subido. Si producción vuelve, sale
 *   con 2 ("no concluyente"); si no vuelve, sale con 1.
 * - **Obliga a mirar el historial de despliegues de Railway**, y lo dice al
 *   terminar en cualquiera de los dos casos.
 * - Si la lectura previa funciona, el parámetro no cambia nada.
 *
 * Códigos de salida: 0 desplegado, 1 no desplegado o no se pudo subir, 2 no
 * concluyente (solo con `--sin-verificar-antes`).
 */
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const URL_LOGIN = "https://app.alomercadeo.com/login";
export const INTERVALO_MS = 10_000;
export const PLAZO_MS = 5 * 60_000;
export const PARAMETRO_EMERGENCIA = "--sin-verificar-antes";

const MIRAR_RAILWAY =
  "Mirá el historial de despliegues de Railway: es lo único que muestra un despliegue fallido y qué commit quedó activo.";

/**
 * El identificador del build en el HTML de una página de Next. Aparece como
 * `\"b\":\"…\"` dentro de `self.__next_f.push(...)`, y se acepta también sin
 * escapar por si Next cambia la forma.
 */
export function extraerIdentificador(html) {
  const m = /\\?"b\\?":\\?"([A-Za-z0-9_-]+)\\?"/.exec(html ?? "");
  return m ? m[1] : null;
}

/** Lee `/login` y devuelve el estado HTTP y el identificador, sin tirar. */
export async function leerBuild(url = URL_LOGIN, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { cache: "no-store", redirect: "manual" });
    const html = await res.text();
    return { status: res.status, id: extraerIdentificador(html) };
  } catch (err) {
    return { status: 0, id: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const describir = (l) =>
  l.status === 0 ? `sin respuesta (${l.error ?? "error de red"})` : `HTTP ${l.status}, build ${l.id ?? "no encontrado"}`;

const valida = (l) => l.status === 200 && Boolean(l.id);

/**
 * La lógica entera, con todo lo de afuera inyectado para poder probarla sin
 * red, sin git y sin esperar cinco minutos.
 */
export async function verificarDespliegue({
  leer,
  subir,
  esperar,
  ahora,
  log,
  sinVerificarAntes = false,
  intervaloMs = INTERVALO_MS,
  plazoMs = PLAZO_MS,
}) {
  const antes = await leer();
  let emergencia = false;
  if (valida(antes)) {
    log(`Antes de subir: ${describir(antes)}.`);
  } else if (!sinVerificarAntes) {
    log(`No se pudo leer el build antes de subir: ${describir(antes)}. No se subió nada.`);
    log(`Si producción está caída y hace falta subir un arreglo urgente, existe ${PARAMETRO_EMERGENCIA}.`);
    return 1;
  } else {
    emergencia = true;
    log(`ATENCIÓN: no hubo lectura previa (${describir(antes)}). Se sube igual por ${PARAMETRO_EMERGENCIA}.`);
    log("Sin lectura previa no se puede comprobar que el build cambió: este resultado nunca es verde.");
  }

  const subida = await subir();
  if (!subida.ok) {
    log("git push falló: no hay nada nuevo que esperar.");
    return 1;
  }
  if (subida.nadaParaSubir) {
    log("No había nada para subir. Se espera igual: si el build cambia, es otro despliegue.");
  }

  const inicio = ahora();
  while (ahora() - inicio < plazoMs) {
    await esperar(intervaloMs);
    const actual = await leer();
    const segundos = Math.round((ahora() - inicio) / 1000);
    log(`${segundos} s: ${describir(actual)}.`);
    if (emergencia) {
      if (valida(actual)) {
        log(`Producción responde con el build ${actual.id}, pero sin lectura previa no se sabe si es lo subido.`);
        log(`NO CONCLUYENTE. ${MIRAR_RAILWAY}`);
        return 2;
      }
    } else if (valida(actual) && actual.id !== antes.id) {
      log(`Desplegado: el build pasó de ${antes.id} a ${actual.id} y /login responde 200.`);
      log("Esto no dice qué commit quedó activo: eso está en el historial de Railway.");
      return 0;
    }
  }

  if (emergencia) {
    log(`Producción no volvió a responder en ${Math.round(plazoMs / 60000)} minutos. ${MIRAR_RAILWAY}`);
  } else {
    log(
      `Lo subido no está desplegado: en ${Math.round(plazoMs / 60000)} minutos el build siguió en ${antes.id}. ${MIRAR_RAILWAY}`,
    );
  }
  return 1;
}

/** `git push` real. Mira antes si había algo para subir. */
function subirConGit() {
  let nadaParaSubir = false;
  try {
    nadaParaSubir =
      execFileSync("git", ["rev-list", "--count", "@{u}..HEAD"], { encoding: "utf8" }).trim() === "0";
  } catch {
    // Sin rama remota todavía: que `git push` decida y lo diga.
  }
  const r = spawnSync("git", ["push"], { stdio: "inherit" });
  return { ok: r.status === 0, nadaParaSubir };
}

const horaCostaRica = () =>
  new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Costa_Rica",
  }).format(new Date());

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const codigo = await verificarDespliegue({
    leer: () => leerBuild(),
    subir: async () => subirConGit(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    ahora: () => Date.now(),
    log: (m) => console.log(`[${horaCostaRica()}] ${m}`),
    sinVerificarAntes: process.argv.includes(PARAMETRO_EMERGENCIA),
  });
  process.exit(codigo);
}
