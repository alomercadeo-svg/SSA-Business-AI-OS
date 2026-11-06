/**
 * La guardia de las políticas que repite `bandeja_busca_con_acceso` (00045,
 * retrabajo de F35 del 04/11/2026, pedida por Marcos).
 *
 * Esa función se saltea la seguridad por filas de `messages`,
 * `conversations`, `contacts` y `contact_channels`: llama a
 * `can_see_conversation` y `can_see_contact` y repite a mano las condiciones
 * de `deleted_at`. Si una migración posterior cambia una política de esas
 * tablas, la función puede quedar comprobando otra cosa que la regla. Esto
 * devuelve las migraciones posteriores a `desde` que crean, cambian o borran
 * una política de esas tablas sin la línea «revisado contra
 * bandeja_busca_con_acceso» (en un comentario: lo que se pide es que quien la
 * cambie la mire y lo diga).
 *
 * Desde el 06/11/2026 (pendiente (d) del 05/11): antes alcanzaba nombrar la
 * función en cualquier lado del archivo, y un comentario copiado de otra
 * migración la satisfacía sin que nadie la hubiera mirado.
 *
 * Solo lo usa `lib/guardia-politicas.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FUNCION_DE_BUSQUEDA = "bandeja_busca_con_acceso";

const TABLAS = ["messages", "conversations", "contacts", "contact_channels"];
const SENTENCIA = new RegExp(
  String.raw`\b(create|alter|drop)\s+policy\b[\s\S]*?\bon\s+(public\.)?(${TABLAS.join("|")})\b`,
  "i",
);

/** Sin comentarios de línea ni cuerpos `$$…$$`: lo que queda son sentencias. */
const sinComentarios = (sql: string) => sql.replace(/\$\$[\s\S]*?\$\$/g, "$$$$").replace(/--.*$/gm, "");

export function politicasSinMencionar(dir: string, desde: number, funcion = FUNCION_DE_BUSQUEDA): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && Number.parseInt(f, 10) > desde)
    .sort()
    .filter((f) => {
      const sql = readFileSync(join(dir, f), "utf8");
      const tocaPoliticas = sinComentarios(sql)
        .split(";")
        .some((sentencia) => SENTENCIA.test(sentencia));
      return tocaPoliticas && !new RegExp(String.raw`revisado contra ${funcion}\b`, "i").test(sql);
    });
}
