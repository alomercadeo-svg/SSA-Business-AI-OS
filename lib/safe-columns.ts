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
  "id, workspace_id, platform, late_account_id, username, display_name, profile_picture, webhook_id, is_active, last_comment_cursor, comment_rules, created_at, updated_at";

/**
 * Columnas de secretos por tabla. Es la lista que el test usa para detectar
 * filtraciones, así que agregar un secreto nuevo acá lo protege solo.
 */
export const SECRET_COLUMNS: Record<string, readonly string[]> = {
  workspaces: ["webhook_secret", "late_api_key_encrypted", "ai_api_key"],
  channels: ["webhook_secret"],
};

/** Tablas sobre las que está prohibido `select("*")` fuera del allowlist. */
export const SENSITIVE_TABLES = Object.keys(SECRET_COLUMNS);
