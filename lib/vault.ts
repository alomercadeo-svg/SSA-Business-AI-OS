/**
 * Acceso a Supabase Vault.
 *
 * Único punto del código que lee o escribe API keys. Antes vivían en texto
 * plano en `workspaces.late_api_key_encrypted` y `workspaces.ai_api_key`: la
 * columna decía "encrypted" pero el valor no estaba encriptado, y el código lo
 * pasaba directo al cliente de la API.
 *
 * El aislamiento por workspace lo garantizan las funciones RPC
 * (`00018_vault_setup.sql`), no este módulo: el nombre del secret en Vault
 * siempre se arma como `ws:<workspace_id>:<nombre>` del lado de la base, así
 * que desde acá no se puede nombrar el secret de otro workspace.
 *
 * Quién puede leer: `service_role` (webhooks, cron, motor de flujos) y los
 * Owner/Admin del workspace. Un Member recibe un error de permisos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Nombres de secret que usa el sistema. Uno por integración. */
export const SECRET_NAMES = {
  /** API key de Zernio: Instagram y WhatsApp. */
  zernio: "zernio_api_key",
  /** API key del AI Gateway para el nodo AI Response. */
  aiGateway: "ai_gateway_api_key",
  /** `AUTHENTICATION_API_KEY` del despliegue de Evolution: la clave global del servidor. */
  evolutionApiKey: "evolution_api_key",
  /** Secreto `jwt_key` con el que Evolution firma cada entrega de webhook. */
  evolutionWebhookSecret: "evolution_webhook_secret",
  /** El secreto anterior, aceptado solo durante la ventana de rotación. */
  evolutionWebhookSecretPrevious: "evolution_webhook_secret_previous",
  /** Clave de Resend, para el correo saliente (F23). Se carga desde integraciones (F24). */
  resend: "resend_api_key",
  /** Claves de los proveedores de IA (F24). Se cargan acá; el cableado es de la Fase 2. */
  openai: "openai_api_key",
  anthropic: "anthropic_api_key",
  google: "google_api_key",
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES] | string;

/**
 * Nombre del secret que guarda el token de una instancia de Evolution.
 *
 * POR QUÉ ESTE ES POR CANAL Y EL SECRETO DEL WEBHOOK ES POR WORKSPACE.
 * La asimetría no es obvia y conviene tenerla escrita, porque la tentación de
 * unificarlos es real.
 *
 * El secreto del webhook prueba UNA sola cosa: que el evento vino de nuestro
 * despliegue de Evolution. Hay un solo despliegue, así que dos instancias
 * firmando con el mismo secreto es correcto, y por workspace alcanza.
 *
 * El token de la instancia es otra cosa: Evolution lo genera por instancia y
 * autoriza operar ESA instancia, o sea mandar mensajes, leer conversaciones y
 * borrarla. Guardarlo como secret de workspace lo rompe en silencio, porque el
 * nombrado de la 00018 es `ws:<workspace_id>:<nombre>` y la segunda instancia
 * pisaría el token de la primera. El día que el negocio quiera dos números,
 * ventas y soporte, el de soporte se queda con el token de ventas y nadie se
 * entera hasta que un envío sale por el número equivocado.
 *
 * Con el id del canal en el nombre, el aislamiento sale gratis: la 00018 arma
 * `ws:<workspace_id>:evolution_instance_token:<channel_id>` sin que haya que
 * tocar ninguna de sus tres funciones.
 */
export function evolutionInstanceTokenName(channelId: string): SecretName {
  return `evolution_instance_token:${channelId}`;
}

// ── Caché ───────────────────────────────────────────────────────────────────

/**
 * El motor de flujos resuelve la API key hasta tres veces por ejecución
 * (`engine.ts` en sendMessage, commentReply y privateReply), y el procesador de
 * secuencias una vez por contacto. Sin caché, cada una es un round-trip a la
 * base sobre el camino caliente de un webhook, que tiene 5 segundos de
 * presupuesto antes de que Zernio aborte la entrega.
 *
 * TTL corto a propósito: el precio de una key rotada es, como mucho, un minuto
 * de fallos, y `setWorkspaceSecret` invalida la entrada al guardar. En memoria
 * del proceso, así que no cruza instancias ni sobrevive a un redeploy.
 */
const TTL_MS = 60_000;

type CacheEntry = { value: string | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function cacheKey(workspaceId: string, name: SecretName): string {
  return `${workspaceId}:${name}`;
}

/** Descarta lo cacheado de un workspace: un secret puntual o todos. */
export function invalidateWorkspaceSecret(workspaceId: string, name?: SecretName): void {
  if (name) {
    cache.delete(cacheKey(workspaceId, name));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) cache.delete(key);
  }
}

/** Solo para tests: vacía la caché entera. */
export function __clearSecretCache(): void {
  cache.clear();
}

// ── Lectura y escritura ─────────────────────────────────────────────────────

/**
 * Lee un secret del workspace. Devuelve null cuando no está configurado.
 *
 * Un error de permisos o de red también devuelve null, con un log sin el valor:
 * los llamadores son webhooks y trabajos de fondo que ya tratan la ausencia de
 * clave como "no puedo enviar" y no deben tirarse abajo por esto.
 */
export async function getWorkspaceSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName
): Promise<string | null> {
  const key = cacheKey(workspaceId, name);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const { data, error } = await supabase.rpc("read_secret", {
    secret_name: name,
    workspace_id: workspaceId,
  });

  if (error) {
    // error.message puede traer el nombre del secret y el workspace, nunca el valor.
    console.error(`[vault] no se pudo leer "${name}" del workspace ${workspaceId}:`, error.message);
    return null;
  }

  const value = (data as string | null) ?? null;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Guarda o actualiza un secret del workspace e invalida la caché.
 * Devuelve el error para que la UI pueda mostrarlo; no lanza.
 */
export async function setWorkspaceSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName,
  value: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("store_secret", {
    secret_name: name,
    secret_value: value,
    workspace_id: workspaceId,
  });

  invalidateWorkspaceSecret(workspaceId, name);

  if (error) {
    console.error(`[vault] no se pudo guardar "${name}" del workspace ${workspaceId}:`, error.message);
    return { error: error.message };
  }
  return { error: null };
}

/** Elimina un secret del workspace e invalida la caché. */
export async function deleteWorkspaceSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("delete_secret", {
    secret_name: name,
    workspace_id: workspaceId,
  });

  invalidateWorkspaceSecret(workspaceId, name);

  if (error) {
    console.error(`[vault] no se pudo eliminar "${name}" del workspace ${workspaceId}:`, error.message);
    return { error: error.message };
  }
  return { error: null };
}

// ── Atajos por integración ──────────────────────────────────────────────────

/**
 * API key de Zernio del workspace, o null si no está configurada.
 * Reemplaza a `select late_api_key_encrypted from workspaces`.
 */
export function getZernioApiKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  return getWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.zernio);
}

/**
 * API key del AI Gateway del workspace, o null si no está configurada.
 *
 * Sin fallback al entorno a propósito: este módulo se importa también desde
 * componentes de cliente (por el mapa de nombres), y leer `process.env` acá
 * mezclaría una preocupación de servidor. El fallback de self-hosting a
 * `AI_GATEWAY_API_KEY` lo aplica el nodo de IA, que es el único que lo usa.
 */
export function getAiGatewayKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  return getWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.aiGateway);
}

/** true si el secret está configurado. No devuelve el valor. */
export async function hasWorkspaceSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName
): Promise<boolean> {
  return (await getWorkspaceSecret(supabase, workspaceId, name)) !== null;
}
