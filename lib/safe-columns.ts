/**
 * Columnas permitidas para consultas que cruzan al cliente.
 *
 * REGLA DEL PROYECTO: ninguna consulta que alimente un Client Component o una
 * respuesta de API puede usar `select("*")` sobre `workspaces` ni `channels`.
 * Hay que enumerar columnas, y estas son las listas canónicas.
 *
 * Las dos tablas guardan secretos en columnas:
 *   - `workspaces.webhook_secret` y `channels.webhook_secret` son el secreto
 *     HMAC con el que se valida la firma de los webhooks de Zernio. Quien lo
 *     tenga puede forjar eventos entrantes firmados.
 *   - `workspaces.late_api_key_encrypted` y `workspaces.ai_api_key` son las
 *     claves en texto plano que la migración 00018 movió a Vault. Se borran en
 *     00021; hasta entonces un `*` las sigue trayendo.
 *
 * `select("*")` es peligroso acá por una razón que no es obvia: con Next, las
 * props de un Client Component se serializan en el HTML, así que una fila
 * "solo leída en el servidor" termina en el navegador con todo lo que trae.
 *
 * El único consumidor legítimo de `webhook_secret` es `lib/zernio-webhook.ts`,
 * que valida firmas del lado del servidor y nunca devuelve el valor.
 *
 * `lib/safe-columns.test.ts` hace cumplir esta regla de forma automática.
 */

/** Columnas de `workspaces` que pueden viajar al cliente. Sin los tres secretos. */
export const WORKSPACE_PUBLIC_COLUMNS =
  "id, name, slug, ai_provider, global_keywords, unassigned_leads_visible_to_members, created_at, updated_at";

/** Columnas de `channels` que pueden viajar al cliente. Sin `webhook_secret`. */
export const CHANNEL_PUBLIC_COLUMNS =
  "id, workspace_id, platform, provider, instance_name, late_account_id, username, display_name, profile_picture, webhook_id, is_active, last_comment_cursor, comment_rules, created_at, updated_at";

/**
 * Columnas de secretos por tabla: PROHIBIDAS fuera del allowlist.
 *
 * Agregar una entrada acá alcanza para que quede protegida: el test prohíbe su
 * nombre fuera del allowlist, y si la tabla es nueva también prohíbe el
 * `select("*")` sobre ella, porque `SENSITIVE_TABLES` sale de las claves de acá.
 */
export const SECRET_COLUMNS: Record<string, readonly string[]> = {
  workspaces: ["webhook_secret", "late_api_key_encrypted", "ai_api_key"],
  channels: ["webhook_secret"],
};

/**
 * Columnas SEGURAS que igual parecen secretos por el nombre.
 *
 * El test lee `supabase/migrations/` y falla ante cualquier columna nueva que
 * termine en `_secret`, `_token`, `_key` o `_password` y no esté registrada.
 * Una columna que solo parece un secreto se declara acá, con el motivo, para
 * que la decisión quede escrita en vez de perderse en una revisión.
 *
 * Está vacío a propósito: hoy ninguna columna del esquema cae en este caso.
 */
export const SAFE_LOOKING_COLUMNS: Record<string, Readonly<Record<string, string>>> = {};

/** Tablas sobre las que está prohibido `select("*")` fuera del allowlist. */
export const SENSITIVE_TABLES = Object.keys(SECRET_COLUMNS);

/**
 * Palabras que delatan a una columna con un secreto adentro. `safe-columns.test.ts`
 * las busca en las migraciones.
 *
 * Se comparan como segmentos separados por guion bajo, no como sufijo. El
 * motivo es concreto: `late_api_key_encrypted`, la columna que originó todo
 * este problema, **no termina** en `_key` sino en `_encrypted`, así que una
 * regla de sufijo la dejaba pasar. Con segmentos, `late_api_key_encrypted` da
 * positivo por su segmento `key`, y `global_keywords` no, porque su segmento es
 * `keywords`. Comprobado sobre las 210 columnas del esquema: la versión por
 * segmento encuentra las cuatro columnas de secretos conocidas y no agrega
 * ningún falso positivo; la de sufijo se perdía una.
 */
export const SECRET_NAME_WORDS = ["secret", "token", "key", "password"] as const;

/** true si el nombre de la columna tiene alguna de esas palabras como segmento. */
export function nombreParecesSecreto(columna: string): boolean {
  const segmentos = columna.toLowerCase().split("_");
  return SECRET_NAME_WORDS.some((w) => segmentos.includes(w));
}
