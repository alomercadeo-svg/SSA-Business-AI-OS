import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CHANNEL_PUBLIC_COLUMNS,
  SECRET_COLUMNS,
  SENSITIVE_TABLES,
  WORKSPACE_PUBLIC_COLUMNS,
} from "./safe-columns";

/**
 * Hace cumplir la regla del proyecto: ninguna consulta que alimente un Client
 * Component o una respuesta de API puede usar select("*") sobre `workspaces` ni
 * `channels`, y los nombres de las columnas de secretos solo pueden aparecer en
 * los archivos del allowlist.
 *
 * Es un test estático: lee el código fuente, no necesita base ni servidor. El
 * fork ya usa este patrón en platforms.test.ts, que lee los archivos de
 * migración del disco.
 *
 * Por qué dos reglas y no una: prohibir solo `select("*")` deja pasar un
 * `select("id, webhook_secret")` explícito. Prohibir solo el nombre de la
 * columna deja pasar el `*`, que la trae sin nombrarla. Hacen falta las dos.
 *
 * Esto es la segunda línea de defensa. La primera es el tipo: los Client
 * Components tipan sus props con un `Omit` que excluye las columnas de
 * secretos, así que el compilador rechaza volver a traerlas. Este test cubre lo
 * que el tipo no ve, como una respuesta de API armada con
 * `NextResponse.json(filas)`.
 */

const RAIZ = join(__dirname, "..");
const CARPETAS = ["app", "lib", "components"];

/**
 * Este archivo se excluye del barrido, y no por allowlist: sus mensajes de error
 * y sus comentarios contienen los patrones prohibidos como ejemplo. Es la
 * especificación de la regla, no una implementación que consulte la base.
 */
const ESTE_TEST = "lib/safe-columns.test.ts";

/**
 * Archivos que sí pueden nombrar o traer las columnas de secretos, con el
 * motivo. Todo lo que esté acá corre solo en el servidor y nunca devuelve el
 * valor en una respuesta.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/zernio-webhook.ts":
    "único consumidor legítimo: valida la firma HMAC de los webhooks entrantes",
  "lib/zernio-webhook.test.ts":
    "tests de la validación de firma: usa el nombre de la columna en sus fixtures",
  "lib/types/database.ts":
    "definición de los tipos de las tablas: refleja el esquema real de la base",
  "lib/safe-columns.ts":
    "define la regla: es el único lugar donde se enumeran las columnas de secretos",
  "lib/vault.ts":
    "documenta en su encabezado de qué columnas se migraron las claves a Vault",
  "components/sidebar.tsx":
    "las excluye con Omit para que el compilador impida volver a traerlas",
  "app/(dashboard)/dashboard/channels/channels-view.tsx":
    "las excluye con Omit para que el compilador impida volver a traerlas",
  "app/(dashboard)/dashboard/growth/growth-view.tsx":
    "las excluye con Omit para que el compilador impida volver a traerlas",
  "app/api/webhooks/late/route.ts":
    "necesita la fila completa del canal para resolver el secreto de la firma; nunca la devuelve",
};

function archivosFuente(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada.startsWith(".")) continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(entrada)) salida.push(ruta);
    }
  };
  for (const carpeta of CARPETAS) recorrer(join(RAIZ, carpeta));
  return salida;
}

/** Ruta relativa con separadores de POSIX, para que el allowlist sea portable. */
function clave(ruta: string): string {
  return relative(RAIZ, ruta).split(/[\\/]/).join("/");
}

describe("columnas de secretos", () => {
  // Regla 1: ni `.from("tabla").select("*")` ni un select relacional `tabla(*)`.
  it("ninguna consulta usa select(*) sobre workspaces o channels", () => {
    const infracciones: string[] = [];

    for (const ruta of archivosFuente()) {
      const k = clave(ruta);
      if (k === ESTE_TEST || ALLOWLIST[k]) continue;
      const src = readFileSync(ruta, "utf8");

      for (const tabla of SENSITIVE_TABLES) {
        // .from("channels") ... .select("*")  (permite saltos de línea y comentarios)
        const directo = new RegExp(
          `\\.from\\(\\s*["'\`]${tabla}["'\`]\\s*\\)[\\s\\S]{0,400}?\\.select\\(\\s*["'\`]\\s*\\*\\s*["'\`]([^)]*)\\)`,
          "g",
        );
        for (const m of src.matchAll(directo)) {
          // `select("*", { count: "exact", head: true })` es el idioma de
          // Supabase para contar: con head:true PostgREST no devuelve cuerpo,
          // así que no hay fila que pueda filtrarse.
          if (/head\s*:\s*true/.test(m[1])) continue;
          infracciones.push(`${k}: .from("${tabla}") con .select("*")`);
        }

        // select("... channels(*) ...") — relacional embebido
        const relacional = new RegExp(`${tabla}\\s*\\(\\s*\\*\\s*\\)`);
        if (relacional.test(src)) {
          infracciones.push(`${k}: select relacional ${tabla}(*)`);
        }
      }
    }

    expect(
      infracciones,
      "Enumerá columnas con WORKSPACE_PUBLIC_COLUMNS o CHANNEL_PUBLIC_COLUMNS " +
        "(lib/safe-columns.ts). Si el archivo corre solo en el servidor y necesita " +
        "el secreto, agregalo al ALLOWLIST de este test con el motivo.\n" +
        infracciones.join("\n"),
    ).toEqual([]);
  });

  // Regla 2: el nombre de la columna tampoco puede aparecer suelto. Cubre el
  // caso de un select explícito que incluya el secreto a propósito.
  it("los nombres de las columnas de secretos solo aparecen en el allowlist", () => {
    const infracciones: string[] = [];
    const secretos = [...new Set(Object.values(SECRET_COLUMNS).flat())];

    for (const ruta of archivosFuente()) {
      const k = clave(ruta);
      if (k === ESTE_TEST || ALLOWLIST[k]) continue;
      const src = readFileSync(ruta, "utf8");
      for (const columna of secretos) {
        if (src.includes(columna)) infracciones.push(`${k}: nombra "${columna}"`);
      }
    }

    expect(
      infracciones,
      "Una columna de secreto no puede nombrarse fuera del allowlist de este test.\n" +
        infracciones.join("\n"),
    ).toEqual([]);
  });

  // Sin esto, alguien podría "arreglar" una infracción agregando el secreto a la
  // lista de columnas públicas, que es el único lugar donde el test lo permite.
  it("las listas de columnas públicas no incluyen ningún secreto", () => {
    const pares: Array<[string, string, readonly string[]]> = [
      ["WORKSPACE_PUBLIC_COLUMNS", WORKSPACE_PUBLIC_COLUMNS, SECRET_COLUMNS.workspaces],
      ["CHANNEL_PUBLIC_COLUMNS", CHANNEL_PUBLIC_COLUMNS, SECRET_COLUMNS.channels],
    ];

    for (const [nombre, lista, secretos] of pares) {
      const columnas = lista.split(",").map((c) => c.trim());
      for (const secreto of secretos) {
        expect(columnas, `${nombre} incluye "${secreto}"`).not.toContain(secreto);
      }
    }
  });

  // El allowlist es una excepción a una regla de seguridad: que no se vuelva un
  // cajón donde cae todo sin que nadie lo note.
  it("cada entrada del allowlist existe y tiene un motivo escrito", () => {
    const existentes = new Set(archivosFuente().map(clave));
    for (const [ruta, motivo] of Object.entries(ALLOWLIST)) {
      expect(existentes.has(ruta), `el allowlist nombra ${ruta}, que no existe`).toBe(true);
      expect(motivo.length, `${ruta} está en el allowlist sin motivo`).toBeGreaterThan(20);
    }
  });
});
