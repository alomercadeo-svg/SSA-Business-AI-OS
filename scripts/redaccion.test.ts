import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Sin `@ts-expect-error`: con `allowJs`, TypeScript infiere los tipos del
// .mjs, y la directiva sobrante era un error que solo `tsc` veía. Lo encontró
// la compuerta de tipos el 22/09/2026 (`scripts/compuerta-cierre.test.ts`).
import { redactar, filtrarSalida, protegerSalida } from "./redaccion.mjs";

/**
 * La redacción de secretos en la salida de los scripts.
 *
 * Existe porque el 21/09/2026 una consulta a `GET /v1/webhooks/settings`
 * imprimió el secreto de firma del webhook en la terminal. Ese endpoint lo
 * devuelve en texto plano junto con la configuración.
 *
 * El test no es una formalidad alrededor de una función de cuatro líneas: el
 * tercer bloque es un guardián estático sobre los scripts del repo. Sin él, la
 * protección dura hasta que alguien escriba el próximo script que consulte ese
 * endpoint sin saber lo que devuelve, que es exactamente cómo pasó la primera
 * vez.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const SECRETO = "8923728c72e766d5f18cf9773aa5e178f828d91e6e3f5a30cd77715f2296694b";

describe("redactar", () => {
  it("muestra longitud y los últimos cuatro, nunca el valor", () => {
    const salida = redactar(SECRETO);
    expect(salida).toBe("(64 caracteres, termina en 694b)");
    expect(salida).not.toContain(SECRETO);
    expect(salida).not.toContain(SECRETO.slice(0, 8));
  });

  it("no filtra nada de un valor corto, donde cuatro caracteres serían demasiados", () => {
    expect(redactar("abc123")).toBe("(6 caracteres, oculto)");
  });

  it("tolera vacío, nulo y lo que no sea texto", () => {
    expect(redactar("")).toBe("(vacío)");
    expect(redactar(null)).toBe("(vacío)");
    expect(redactar(undefined)).toBe("(vacío)");
  });
});

describe("filtrarSalida", () => {
  it("reemplaza el secreto cuando viene suelto", () => {
    const salida = filtrarSalida(`el secreto es ${SECRETO} y nada más`, [SECRETO]);
    expect(salida).not.toContain(SECRETO);
    expect(salida).toContain("termina en 694b");
  });

  /**
   * Este es el caso que importa y el que motivó que el filtro trabaje sobre el
   * texto final y no sobre el objeto: serializado adentro de un JSON, ninguna
   * comprobación por nombre de campo lo encontraría.
   */
  it("lo reemplaza también anidado adentro de un JSON volcado entero", () => {
    const respuesta = JSON.stringify({
      webhooks: [{ _id: "abc", name: "Zernflow", secret: SECRETO, events: ["message.received"] }],
    });
    const salida = filtrarSalida(respuesta, [SECRETO]);
    expect(salida).not.toContain(SECRETO);
    expect(salida).toContain("message.received");
  });

  it("reemplaza todas las apariciones, no solo la primera", () => {
    const salida = filtrarSalida(`${SECRETO} y otra vez ${SECRETO}`, [SECRETO]);
    expect(salida).not.toContain(SECRETO);
  });

  it("maneja varios secretos a la vez", () => {
    const otro = "zrk_clave_de_api_de_prueba_1234567890";
    const salida = filtrarSalida(`${SECRETO} y ${otro}`, [SECRETO, otro]);
    expect(salida).not.toContain(SECRETO);
    expect(salida).not.toContain(otro);
  });

  /**
   * Un secreto de dos o tres caracteres convertiría el filtro en un destructor
   * de texto común: reemplazaría esas letras en cualquier palabra. Se ignora,
   * porque un valor así no es un secreto que valga la pena proteger y el daño
   * de "proteger" sería peor.
   */
  it("ignora valores demasiado cortos en vez de arruinar el texto", () => {
    expect(filtrarSalida("un texto cualquiera", ["un"])).toBe("un texto cualquiera");
  });
});

describe("protegerSalida", () => {
  const originales = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  afterEach(() => Object.assign(console, originales));

  it("redacta lo que pasa por console.log aunque quien lo llama no sepa que hay un secreto", () => {
    const capturado: string[] = [];
    console.log = vi.fn((...args: unknown[]) => capturado.push(args.join(" ")));

    protegerSalida([SECRETO]);
    console.log(`volcado: ${JSON.stringify({ secret: SECRETO })}`);

    expect(capturado.join("\n")).not.toContain(SECRETO);
    expect(capturado.join("\n")).toContain("termina en 694b");
  });

  /**
   * La ventana que cierra `sumarSecreto`: la clave de la API se conoce al
   * arrancar, pero el secreto del webhook aparece recién en la respuesta que hay
   * que proteger. Si solo se pudieran declarar los secretos de entrada, ese
   * valor quedaría afuera del filtro justo en el momento en que se lee.
   */
  it("protege también un secreto que aparece a mitad de camino", () => {
    const capturado: string[] = [];
    console.log = vi.fn((...args: unknown[]) => capturado.push(args.join(" ")));

    const sumarSecreto = protegerSalida([]);
    sumarSecreto(SECRETO);
    console.log(`ahora sí: ${SECRETO}`);

    expect(capturado.join("\n")).not.toContain(SECRETO);
  });

  it("redacta también en console.error, que es donde van los fallos con detalle", () => {
    const capturado: string[] = [];
    console.error = vi.fn((...args: unknown[]) => capturado.push(args.join(" ")));

    protegerSalida([SECRETO]);
    console.error(`falló con ${SECRETO}`);

    expect(capturado.join("\n")).not.toContain(SECRETO);
  });
});

/**
 * El guardián: que la protección no dependa de que alguien se acuerde.
 *
 * `GET /v1/webhooks/settings` devuelve el secreto de firma en texto plano. Todo
 * script que consulte ese endpoint tiene que instalar el filtro de salida. Esta
 * comprobación es estática a propósito: no necesita red, ni claves, ni que el
 * script corra, así que falla en `npm test` el día que alguien agregue el
 * próximo script sin el filtro.
 */
/**
 * Una línea que imprime el campo `secret` sin pasarlo por `redactar`.
 *
 * Mostrar `redactar(w.secret)` es el uso correcto y tiene que pasar; imprimir
 * `w.secret` pelado es la filtración. La primera versión de esta regla marcaba
 * las dos y daba rojo sobre código correcto.
 *
 * **Aflojar una regla hasta que el código pase es exactamente lo que no hay que
 * hacer**, así que la regla nueva se prueba con casos propios, abajo, en vez de
 * confiar en que quedó bien porque el repo está en verde.
 */
function imprimeSecretoCrudo(linea: string): boolean {
  if (!/console\.(log|error|warn|info)/.test(linea)) return false;
  if (!/\.secret\b/.test(linea)) return false;
  return !/redactar\s*\(/.test(linea);
}

describe("la regla que detecta secretos impresos", () => {
  it("marca el campo impreso pelado", () => {
    expect(imprimeSecretoCrudo("  console.log(`secreto: ${w.secret}`);")).toBe(true);
    expect(imprimeSecretoCrudo("  console.error(mio.secret);")).toBe(true);
  });

  it("no marca el campo pasado por redactar", () => {
    expect(imprimeSecretoCrudo("  console.log(`secreto ${redactar(w.secret)}`);")).toBe(false);
  });

  it("no marca líneas que no imprimen", () => {
    expect(imprimeSecretoCrudo("  const s = mio.secret;")).toBe(false);
    expect(imprimeSecretoCrudo("  if (despues.secret !== mio.secret) return 1;")).toBe(false);
  });
});

describe("los scripts que leen la configuración de webhooks redactan su salida", () => {
  const ENDPOINTS_QUE_DEVUELVEN_SECRETOS = ["webhooks/settings"];

  const scripts = readdirSync(AQUI)
    // El propio módulo de redacción nombra el endpoint en su comentario y se
    // aprobaría a sí mismo trivialmente.
    .filter((f) => f.endsWith(".mjs") && f !== "redaccion.mjs")
    .map((f) => ({ nombre: f, fuente: readFileSync(resolve(AQUI, f), "utf8") }));

  it("hay scripts para revisar, o esta comprobación no dice nada", () => {
    // El control positivo del guardián: si el directorio cambiara de lugar,
    // la lista quedaría vacía y todo lo de abajo pasaría trivialmente.
    expect(scripts.length).toBeGreaterThan(0);
  });

  for (const { nombre, fuente } of scripts) {
    const consulta = ENDPOINTS_QUE_DEVUELVEN_SECRETOS.some((e) => fuente.includes(e));
    if (!consulta) continue;

    it(`${nombre} instala protegerSalida`, () => {
      expect(fuente).toContain("protegerSalida");
    });

    it(`${nombre} no imprime el campo secret sin redactar`, () => {
      expect(fuente.split("\n").filter(imprimeSecretoCrudo)).toEqual([]);
    });
  }
});
