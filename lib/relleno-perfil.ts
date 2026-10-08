/**
 * Relleno oportunista del nombre y el handle de un remitente de Instagram
 * (criterio de F27, con techo de 3 intentos).
 *
 * Al procesar un `message.received`, si el remitente tiene `profile_status =
 * 'pending'`, se relee esa sola conversación con `getInboxConversation`. Si la
 * respuesta trae `instagramProfile`:
 *   - `platform_username` con `participantUsername`;
 *   - `contacts.display_name` con `participantName`, SOLO si el nombre es de
 *     origen `provider`: un nombre `manual` no lo pisa nunca nada (F25);
 *   - `profile_status` pasa a `complete`.
 * Si no lo trae, suma un intento, y al tercero pasa a `unavailable` y no se
 * reintenta más. La señal es que venga `instagramProfile`, no la forma del
 * nombre.
 *
 * Corre en `after()`, después del acuse, porque llama a Zernio.
 *
 * Los tipos del SDK (0.2.519) no declaran `participantUsername` en esta
 * respuesta; el criterio lo nombra y el listado sí lo trae. Se lee si viene y,
 * si no viene, el handle no se toca: la ausencia nunca borra uno que ya estaba.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createZernioClient } from "./zernio-client";
import { getZernioApiKey } from "./vault";
import { handleDelProveedor } from "./inbox-sync";

export const TECHO_DE_INTENTOS = 3;

export interface ClienteDePerfil {
  messages: {
    getInboxConversation(opts: {
      path: { conversationId: string };
      query: { accountId: string };
    }): Promise<{ data?: { data?: unknown } | unknown }>;
  };
}

interface ConversacionConPerfil {
  participantName?: string | null;
  participantUsername?: string | null;
  instagramProfile?: unknown;
}

/** La respuesta viene envuelta en `data` (SDK) y a veces otra vez en `data` (API). */
function conversacionDe(respuesta: unknown): ConversacionConPerfil | null {
  const nivel1 = (respuesta as { data?: unknown } | null)?.data;
  const nivel2 = (nivel1 as { data?: unknown } | null)?.data;
  const c = (nivel2 ?? nivel1) as ConversacionConPerfil | null | undefined;
  return c && typeof c === "object" ? c : null;
}

export type ResultadoDelRelleno = "no_aplica" | "completo" | "sin_perfil" | "agotado";

export async function rellenarPerfilSiFalta(
  supabase: SupabaseClient,
  opts: {
    channel: { id: string; workspace_id: string; platform?: string | null; late_account_id?: string | null };
    senderId: string;
    conversacionDeZernio: string;
    /** Para los tests: el cliente de Zernio ya armado. */
    zernio?: ClienteDePerfil;
  },
): Promise<ResultadoDelRelleno> {
  if (opts.channel.platform !== "instagram" || !opts.channel.late_account_id) return "no_aplica";

  const { data: cc } = await supabase
    .from("contact_channels")
    .select("id, contact_id, profile_status, profile_attempts")
    .eq("channel_id", opts.channel.id)
    .eq("platform_sender_id", opts.senderId)
    .maybeSingle();
  const fila = cc as { id: string; contact_id: string; profile_status: string; profile_attempts: number } | null;
  if (!fila || fila.profile_status !== "pending") return "no_aplica";

  let zernio = opts.zernio;
  if (!zernio) {
    const clave = await getZernioApiKey(supabase, opts.channel.workspace_id);
    if (!clave) return "no_aplica";
    zernio = createZernioClient(clave) as unknown as ClienteDePerfil;
  }

  const respuesta = await zernio.messages.getInboxConversation({
    path: { conversationId: opts.conversacionDeZernio },
    query: { accountId: opts.channel.late_account_id },
  });
  const conv = conversacionDe(respuesta);

  if (!conv?.instagramProfile) {
    const intentos = (fila.profile_attempts ?? 0) + 1;
    const agotado = intentos >= TECHO_DE_INTENTOS;
    await supabase
      .from("contact_channels")
      .update({ profile_attempts: intentos, ...(agotado ? { profile_status: "unavailable" } : {}) })
      .eq("id", fila.id);
    return agotado ? "agotado" : "sin_perfil";
  }

  const handle = handleDelProveedor(conv.participantUsername);
  await supabase
    .from("contact_channels")
    .update({ profile_status: "complete", ...(handle ? { platform_username: handle } : {}) })
    .eq("id", fila.id);

  const nombre = typeof conv.participantName === "string" ? conv.participantName.trim() : "";
  if (nombre) {
    // El filtro por origen va en la misma escritura: un nombre `manual` no se
    // toca aunque alguien lo haya cambiado entre la lectura y esta línea.
    await supabase
      .from("contacts")
      .update({ display_name: nombre })
      .eq("id", fila.contact_id)
      .eq("display_name_source", "provider");
  }
  return "completo";
}
