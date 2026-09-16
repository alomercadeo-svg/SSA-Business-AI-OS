import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CHANNEL_PUBLIC_COLUMNS,
  SAFE_LOOKING_COLUMNS,
  SECRET_COLUMNS,
  nombreParecesSecreto,
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
  "app/api/webhooks/late/route.test.ts":
    "tests de la firma: arma canales de mentira y prueba el secret heredado del canal; los valores son inventados",
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

/**
 * Dirección contraria: las reglas de arriba protegen las columnas que ya
 * conocemos, no la regla. Si el Bloque 2 agrega una columna con un secreto en
 * otra tabla, nada de lo anterior se entera.
 *
 * Esto lee `supabase/migrations/` y falla ante cualquier columna cuyo nombre
 * contenga `secret`, `token`, `key` o `password` como segmento y no esté
 * registrada, ni
 * como prohibida (`SECRET_COLUMNS`) ni como segura (`SAFE_LOOKING_COLUMNS`).
 * El mensaje dice qué migración la introdujo.
 */
describe("columnas nuevas con pinta de secreto", () => {
  const DIR_MIGRACIONES = join(RAIZ, "supabase", "migrations");

  interface ColumnaHallada {
    tabla: string;
    columna: string;
    migracion: string;
  }

  /** Quita los comentarios de línea: un `--` puede mencionar una columna que ya no existe. */
  function sinComentarios(sql: string): string {
    return sql
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
  }

  /**
   * Columnas que introduce cada migración, con la tabla a la que pertenecen.
   *
   * Solo mira dos lugares: el cuerpo de un `create table` y las cláusulas
   * `add column`. Deja afuera los `declare` de los bloques `DO $$`, cuyas
   * variables locales (`v_key text;`) se parecen mucho a una columna.
   *
   * Aplica los `rename column` en orden: `openai_api_key` nació en la 00007 y
   * la 00008 lo renombró a `ai_api_key`. Sin esto, el test reclamaría para
   * siempre por una columna que ya no existe con ese nombre.
   */
  function columnasIntroducidas(): ColumnaHallada[] {
    const archivos = readdirSync(DIR_MIGRACIONES)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();

    const halladas: ColumnaHallada[] = [];
    const renombres = new Map<string, string>(); // "tabla.vieja" -> "nueva"

    for (const archivo of archivos) {
      const sql = sinComentarios(readFileSync(join(DIR_MIGRACIONES, archivo), "utf8"));

      // create table <tabla> ( ... );
      const creates = sql.matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
      );
      for (const m of creates) {
        const tabla = m[1].toLowerCase();
        for (const linea of m[2].split("\n")) {
          const col = linea.match(
            /^\s*["`]?(\w+)["`]?\s+(text|uuid|jsonb|json|boolean|bool|integer|int|bigint|timestamptz|timestamp|numeric|date)\b/i,
          );
          if (col) halladas.push({ tabla, columna: col[1].toLowerCase(), migracion: archivo });
        }
      }

      // alter table <tabla> add column [if not exists] <columna>
      const adds = sql.matchAll(
        /alter\s+table\s+(?:only\s+)?["`]?(\w+)["`]?[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?/gi,
      );
      for (const m of adds) {
        halladas.push({
          tabla: m[1].toLowerCase(),
          columna: m[2].toLowerCase(),
          migracion: archivo,
        });
      }

      // alter table <tabla> rename column <vieja> to <nueva>
      const renames = sql.matchAll(
        /alter\s+table\s+["`]?(\w+)["`]?\s+rename\s+column\s+["`]?(\w+)["`]?\s+to\s+["`]?(\w+)["`]?/gi,
      );
      for (const m of renames) {
        renombres.set(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`, m[3].toLowerCase());
      }
    }

    // Una columna puede renombrarse más de una vez; se sigue la cadena.
    return halladas.map((h) => {
      let nombre = h.columna;
      const vistos = new Set<string>();
      while (renombres.has(`${h.tabla}.${nombre}`) && !vistos.has(nombre)) {
        vistos.add(nombre);
        nombre = renombres.get(`${h.tabla}.${nombre}`)!;
      }
      return { ...h, columna: nombre };
    });
  }

  it("toda columna que parece un secreto está registrada como prohibida o como segura", () => {
    const sinRegistrar: string[] = [];

    for (const { tabla, columna, migracion } of columnasIntroducidas()) {
      if (!nombreParecesSecreto(columna)) continue;

      const prohibida = (SECRET_COLUMNS[tabla] ?? []).includes(columna);
      const segura = Boolean(SAFE_LOOKING_COLUMNS[tabla]?.[columna]);

      if (!prohibida && !segura) {
        sinRegistrar.push(`${tabla}.${columna} (la introduce ${migracion})`);
      }
    }

    expect(
      [...new Set(sinRegistrar)],
      "Hay columnas con pinta de secreto sin registrar en lib/safe-columns.ts.\n" +
        "Si guarda un secreto, agregala a SECRET_COLUMNS: queda prohibida fuera del\n" +
        "allowlist y, si su tabla es nueva, también se prohíbe select(*) sobre ella.\n" +
        "Si solo lo parece, agregala a SAFE_LOOKING_COLUMNS con el motivo.\n" +
        [...new Set(sinRegistrar)].join("\n"),
    ).toEqual([]);
  });

  // Si el detector deja de encontrar columnas, los dos tests de arriba pasarían
  // en verde sin revisar nada. Esto comprueba que sigue leyendo el esquema.
  it("el detector encuentra las columnas de secretos que ya conocemos", () => {
    const encontradas = columnasIntroducidas()
      .filter((c) => nombreParecesSecreto(c.columna))
      .map((c) => `${c.tabla}.${c.columna}`);

    expect(encontradas).toContain("workspaces.webhook_secret");
    expect(encontradas).toContain("channels.webhook_secret");
    expect(encontradas).toContain("workspaces.late_api_key_encrypted");
    // Nace como openai_api_key en la 00007 y la 00008 lo renombra: si la cadena
    // de renombres se rompiera, acá aparecería el nombre viejo.
    expect(encontradas).toContain("workspaces.ai_api_key");
    expect(encontradas).not.toContain("workspaces.openai_api_key");
  });

  it("toda entrada de SAFE_LOOKING_COLUMNS tiene un motivo escrito", () => {
    for (const [tabla, columnas] of Object.entries(SAFE_LOOKING_COLUMNS)) {
      for (const [columna, motivo] of Object.entries(columnas)) {
        expect(
          motivo.length,
          `${tabla}.${columna} está declarada segura sin motivo`,
        ).toBeGreaterThan(20);
      }
    }
  });
});
