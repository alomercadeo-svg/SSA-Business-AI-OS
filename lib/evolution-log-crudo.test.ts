import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Ningún log escribe el cuerpo crudo de un aviso de Evolution.
 *
 * ── POR QUÉ ESTO ES UN TEST Y NO UNA REGLA ESCRITA ──────────────────────────
 *
 * El token de la instancia viaja en `apikey`, dentro del cuerpo de **cada**
 * aviso, y autoriza mandar mensajes, leer conversaciones y borrar la instancia.
 *
 * Durante meses el plano dijo que `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false`
 * evitaba eso. **Es falso, medido el 17/09/2026:** `emit()` pone `apikey` sin
 * ninguna condición en la 2.3.7, y con la variable en `false` `fetchInstances`
 * devuelve igual el token. O sea que no hay forma de apagarlo del lado de
 * Evolution, y **no loguear el cuerpo dejó de ser higiene para ser la única
 * defensa que ese token tiene**.
 *
 * Una defensa que consiste en que alguien se acuerde ya falló una vez en este
 * proyecto: el secreto de firma de Zernio se imprimió en pantalla porque el
 * endpoint lo devuelve sin avisar y quien lo consultó no lo sabía. La misma
 * forma de falla, con otro secreto.
 *
 * Por eso F21 no se da por cumplida con la lectura de un humano: se da por
 * cumplida con esto en verde.
 *
 * ── QUÉ ATRAPA ──────────────────────────────────────────────────────────────
 *
 * Un `console.*` en el camino de Evolution que reciba el cuerpo entero: la
 * cadena cruda, el objeto parseado, o cualquiera de los dos serializado.
 *
 * ── QUÉ NO ATRAPA, Y POR QUÉ SE ELIGIÓ ASÍ ──────────────────────────────────
 *
 * No atrapa un log que arme la fuga campo por campo —`console.log(p.apikey)`—
 * ni uno que pase el cuerpo a un servicio de registro externo. Lo primero sería
 * deliberado y lo segundo no existe hoy en este proyecto.
 *
 * Y **sí deja pasar los logs de metadatos**, que son los que el código tiene
 * hoy y los que queremos conservar: `evento.mensajes.length` es un conteo y
 * `error.message` es el texto de una excepción. Una regla que marcara cualquier
 * mención del objeto daría rojo sobre código correcto, que es como se afloja un
 * guardián hasta volverlo inútil. La regla nueva se prueba con casos propios
 * más abajo, en vez de darse por buena porque el repo está en verde.
 */

const RAIZ = process.cwd();

/** El camino de Evolution: donde el cuerpo crudo existe como variable. */
const ARCHIVOS = [
  "app/api/webhooks/evolution/route.ts",
  "lib/evolution-processor.ts",
  "lib/evolution-webhook.ts",
];

/**
 * Nombres que en estos archivos SON el cuerpo del aviso.
 *
 * Va por nombre y no por tipo porque esto es análisis de texto, no de tipos. Es
 * un compromiso consciente: alcanza para la regresión realista, que es alguien
 * agregando un `console.log(payload)` para depurar y olvidándoselo.
 */
const NOMBRES_DEL_CUERPO = ["body", "payload", "cuerpo", "rawBody", "crudo"];

/** Extrae cada llamada a console.*, incluidas las que ocupan varias líneas. */
export function llamadasAConsole(fuente: string): string[] {
  const llamadas: string[] = [];
  const re = /console\.(log|error|warn|info|debug)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fuente)) !== null) {
    let i = m.index + m[0].length;
    let nivel = 1;
    while (i < fuente.length && nivel > 0) {
      if (fuente[i] === "(") nivel++;
      else if (fuente[i] === ")") nivel--;
      i++;
    }
    llamadas.push(fuente.slice(m.index, i));
  }
  return llamadas;
}

/**
 * ¿Esta llamada entrega el cuerpo entero?
 *
 * Verdadero si menciona un nombre del cuerpo **como palabra suelta**, o si
 * serializa cualquier cosa. `evento.mensajes.length` no lo activa porque
 * `mensajes` no está en la lista y no hay serialización; `error.message`
 * tampoco.
 */
export function entregaElCuerpo(llamada: string): boolean {
  if (/JSON\s*\.\s*stringify\s*\(/.test(llamada)) return true;
  return NOMBRES_DEL_CUERPO.some((n) => new RegExp(`\\b${n}\\b`).test(llamada));
}

describe("la regla que detecta un log del cuerpo crudo", () => {
  it("marca el cuerpo pasado entero", () => {
    expect(entregaElCuerpo("console.log(payload)")).toBe(true);
    expect(entregaElCuerpo('console.error("[evolution] aviso:", body)')).toBe(true);
    expect(entregaElCuerpo("console.warn(`crudo: ${cuerpo}`)")).toBe(true);
  });

  it("marca el cuerpo serializado, que es la forma en que suele colarse", () => {
    expect(entregaElCuerpo("console.log(JSON.stringify(evento))")).toBe(true);
  });

  it("NO marca los logs de metadatos, que son los que hay que conservar", () => {
    expect(entregaElCuerpo("console.log(`mensajes=${evento.mensajes.length}`)")).toBe(false);
    expect(entregaElCuerpo('console.error("[evolution] fallo:", error.message)')).toBe(false);
    expect(entregaElCuerpo("console.error(`instancia desconocida: ${instancia}`)")).toBe(false);
  });

  it("encuentra una llamada que ocupa varias líneas", () => {
    const fuente = 'console.error(\n  "[evolution] x: " +\n  `y=${payload}`\n);';
    const llamadas = llamadasAConsole(fuente);
    expect(llamadas).toHaveLength(1);
    expect(entregaElCuerpo(llamadas[0])).toBe(true);
  });
});

describe("ningún log escribe el cuerpo crudo de un aviso de Evolution", () => {
  /**
   * El control positivo del guardián: si los archivos se movieran de lugar,
   * la lista quedaría vacía y todo lo de abajo pasaría en verde sin mirar nada.
   */
  it("los archivos del camino de Evolution existen y tienen logs", () => {
    let total = 0;
    for (const rel of ARCHIVOS) {
      const ruta = resolve(RAIZ, rel);
      expect(existsSync(ruta), `no se encontró ${rel}`).toBe(true);
      total += llamadasAConsole(readFileSync(ruta, "utf8")).length;
    }
    expect(total, "ningún archivo del camino tiene logs: la regla no mide nada").toBeGreaterThan(0);
  });

  for (const rel of ARCHIVOS) {
    it(`${rel} no entrega el cuerpo a ningún log`, () => {
      const fuente = readFileSync(resolve(RAIZ, rel), "utf8");
      const culpables = llamadasAConsole(fuente).filter(entregaElCuerpo);

      expect(
        culpables.map((c) => c.replace(/\s+/g, " ").slice(0, 120)),
        `${rel} escribe el cuerpo de un aviso de Evolution en un log.\n` +
          `Ese cuerpo trae \`apikey\`, el token de la instancia, que autoriza mandar ` +
          `mensajes y borrarla. No hay forma de que Evolution deje de mandarlo, así ` +
          `que no loguearlo es la única defensa. Registrá los campos que necesites ` +
          `por separado: tipo de evento, instancia, cantidad de mensajes.`
      ).toEqual([]);
    });
  }
});
