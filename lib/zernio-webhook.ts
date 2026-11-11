/**
 * Zernio webhook auto-registration.
 *
 * Zernflow must register its own `/api/webhooks/late` endpoint in Zernio so that
 * inbound events (DMs, comments) are delivered to the Inbox. Zernio exposes a
 * single webhook per profile/API key, so this is idempotent and operates at the
 * workspace level (the secret lives on `workspaces.webhook_secret`).
 */

import { getWorkspaceSecret, setWorkspaceSecret, SECRET_NAMES } from "./vault";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";

/** Name used to identify Zernflow's webhook among a profile's webhooks. */
export const WEBHOOK_NAME = "Zernflow";

/**
 * Los eventos a los que se suscribe el webhook.
 *
 * ── POR QUÉ ES UNA CONSTANTE Y NO UNA LISTA EN CADA LLAMADOR ────────────────
 *
 * Estaba cableada en los dos lugares que llaman a `ensureWebhookRegistered`,
 * con el mismo contenido copiado. Eso es una trampa activa, no una fealdad:
 * `ensureWebhookRegistered` **reescribe la lista completa** cuando decide
 * actualizar, así que un llamador con una lista desactualizada le borra los
 * eventos a la suscripción sin avisar y sin error, la próxima vez que un sync
 * dispare un update por cualquier otro motivo.
 *
 * ── `message.sent`: POR QUÉ ESTÁ ACÁ, MEDIDO EL 21/09/2026 ──────────────────
 *
 * Porque el negocio responde desde el celular, y sin este evento esos mensajes
 * no llegan a la base en tiempo real.
 *
 * Medido, no supuesto: se suscribió el evento y se mandaron dos mensajes
 * salientes, uno desde la bandeja y otro escrito desde la app de Instagram.
 * **Los dos produjeron entrega de webhook.** El de la bandeja es el control
 * positivo: sin él, la ausencia del otro no se habría podido atribuir a
 * Instagram.
 *
 * El aviso trae `message.id` (interno) y `message.platformMessageId` (de
 * plataforma), igual que `message.received`, y el de plataforma coincide con el
 * `id` del listado con delta de 0 ms. O sea que la clave de idempotencia de F27
 * sirve también para los echos, venga el mensaje de donde venga.
 *
 * **Hoy el receptor descarta este evento** (`app/api/webhooks/late/route.ts`,
 * el filtro por tipo). Se registra igual porque F27 lo va a necesitar, y porque
 * descubrir la suscripción el día que se construya F27 es más caro que dejarla
 * puesta ahora: las entregas quedan registradas en el log de Zernio desde ya.
 */
export const WEBHOOK_EVENTS = ["message.received", "comment.received", "message.sent"] as const;

/**
 * Events Zernflow needs delivered to its webhook.
 *
 * Derivado de `WEBHOOK_EVENTS` y no escrito a mano: cuando `63834ac` sumó
 * `message.sent` a la lista, este tipo quedó con los dos eventos viejos y el
 * build de producción falló el 22/09/2026. Los tests no lo vieron porque Vitest
 * no chequea tipos. Una sola fuente, igual que la lista.
 */
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface EnsureWebhookOptions {
  /** Public base URL of this Zernflow deployment (e.g. NEXT_PUBLIC_APP_URL). */
  appUrl: string;
  /** Workspace-level HMAC secret used to verify webhook signatures. */
  secret: string;
  /** Events to subscribe to (at least one). */
  events: WebhookEvent[];
}

export interface EnsureWebhookResult {
  action: "created" | "updated" | "unchanged";
}

/** Minimal shape of a Zernio webhook entry (subset of the SDK's Webhook type). */
interface ZernioWebhook {
  _id?: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
}

function webhookUrl(appUrl: string): string {
  // trim() guards against whitespace smuggled in via the env var — a trailing
  // newline in NEXT_PUBLIC_APP_URL once registered a webhook with a "\n" in
  // the URL, silently failing every delivery (#10).
  return `${appUrl.trim().replace(/\/$/, "")}/api/webhooks/late`;
}

/** Normalizes a URL to origin+pathname, dropping query string and trailing slash. */
function normalizePath(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return u.replace(/\?.*$/, "").replace(/\/$/, "");
  }
}

/** True when two webhook URLs share the same origin+path, ignoring query string. */
function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && normalizePath(a) === normalizePath(b);
}

/**
 * Ensures Zernflow's webhook is registered in Zernio and up to date.
 *
 * - No webhook found → create it.
 * - Found but URL differs or an event is missing → update it.
 * - Found and correct → no-op.
 *
 * Identifying "our" webhook: match by path (ignoring any query string, since a
 * webhook registered by hand may carry an SSO bypass token in the URL) or by
 * name. Never adopt anything else: Zernio allows up to 10 webhooks per account,
 * so an unmatched entry belongs to another integration the user owns and
 * rewriting it would silently break that integration.
 */
/**
 * Deuda de §15 (ítem 7 de la sesión de cierre, 10/11/2026): un servidor de
 * desarrollo conectado a la cuenta de producción podía registrar el aviso
 * contra `http://localhost:3000` (el respaldo cuando falta
 * `NEXT_PUBLIC_APP_URL`) y la bandeja dejaba de recibir sin ningún síntoma.
 * Propuesta de §15, aplicada: solo una dirección https que no sea local.
 */
export function direccionPublica(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") return false;
    return !(host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host === "0.0.0.0");
  } catch {
    return false;
  }
}

export async function ensureWebhookRegistered(
  zernio: Zernio,
  opts: EnsureWebhookOptions,
): Promise<EnsureWebhookResult> {
  const url = webhookUrl(opts.appUrl);
  if (!direccionPublica(url)) {
    throw new Error("No se registra el aviso de Zernio: la dirección tiene que ser https y pública (revisá NEXT_PUBLIC_APP_URL).");
  }

  const res = await zernio.webhooks.getWebhookSettings();
  const webhooks = (res?.data?.webhooks ?? []) as ZernioWebhook[];
  const mine = webhooks.find((w) => samePath(w.url, url) || w.name === WEBHOOK_NAME);

  if (!mine) {
    await zernio.webhooks.createWebhookSettings({
      body: { name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "created" };
  }

  const eventsOk = opts.events.every((e) => mine.events?.includes(e));
  // Zernio's GET returns the stored secret, so drift is detectable. Without
  // this check a secret rotated locally (e.g. the workspace column arriving
  // after the webhook was first registered) never reaches Zernio and every
  // delivery fails signature verification from then on.
  const secretOk = (mine.secret || "") === opts.secret;
  if (mine.url !== url || !eventsOk || !secretOk) {
    await zernio.webhooks.updateWebhookSettings({
      body: { _id: mine._id!, name: WEBHOOK_NAME, url, secret: opts.secret, events: opts.events },
    });
    return { action: "updated" };
  }

  return { action: "unchanged" };
}

/** Generates a random 32-byte secret as a 64-char hex string. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Returns the workspace's webhook secret, generating and persisting one the first
 * time it is needed. The same secret is used both to register the webhook in Zernio
 * and to verify inbound signatures, so it must be stable per workspace.
 */
export async function getOrCreateWorkspaceWebhookSecret(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  // 1a (ítem 4 de la sesión de cierre): el secreto vive en Vault. Un Member lo
  // podía leer en `workspaces.webhook_secret` con su sesión (§15 del plano).
  const enVault = await getWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.zernioWebhook);
  if (enVault) return enVault;

  const { data } = await supabase
    .from("workspaces")
    .select("webhook_secret")
    .eq("id", workspaceId)
    .single();

  // Uno que todavía está en la columna se copia a Vault con el MISMO valor:
  // rotarlo obligaría a registrar otra vez el aviso en Zernio (lo que pasó el
  // 22/09/2026).
  const existing = (data as { webhook_secret?: string | null } | null)?.webhook_secret;
  const secret = existing || generateWebhookSecret();
  const { error } = await setWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.zernioWebhook, secret);
  if (error) throw new Error("No se pudo guardar el secreto de firma de Zernio en Vault.");
  return secret;
}

/**
 * Verifies an inbound webhook's HMAC-SHA256 signature (x-late-signature header)
 * against the shared secret using a constant-time comparison.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

/** Minimal channel shape needed to resolve the webhook secret. */
export interface ChannelSecretRef {
  workspace_id: string;
  webhook_secret?: string | null;
}

/**
 * Resolves the secret used to verify a webhook signature, preferring the
 * workspace-level secret and falling back to the legacy per-channel secret
 * during the transition. Returns null when neither is configured.
 */
export async function resolveWebhookSecret(
  supabase: SupabaseClient,
  channel: ChannelSecretRef,
): Promise<string | null> {
  // 1a: primero Vault. La columna queda como respaldo mientras dura el paso 1
  // (y para los espacios fantasma de los verificadores, que la escriben).
  const enVault = await getWorkspaceSecret(supabase, channel.workspace_id, SECRET_NAMES.zernioWebhook);
  if (enVault) return enVault;

  const { data } = await supabase
    .from("workspaces")
    .select("webhook_secret")
    .eq("id", channel.workspace_id)
    .single();

  const workspaceSecret = (data as { webhook_secret?: string | null } | null)?.webhook_secret;
  return workspaceSecret || channel.webhook_secret || null;
}
