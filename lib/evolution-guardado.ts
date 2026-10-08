/**
 * El guardado de los avisos de mensaje de Evolution (F27), y lo de F25 y F26
 * que necesita mensajes guardados: el identificador crudo y el modo, el
 * teléfono o la marca de "sin resolver", el identificador de cada mensaje, la
 * reconciliación automática y el toque de click-to-WhatsApp.
 *
 * ── LA FORMA DEL AVISO, ARMADA DESDE EL CÓDIGO DE EVOLUTION 2.3.7 ────────────
 *
 * No hay un aviso real: el número no se vincula hasta el Bloque 4. La forma
 * sale de `whatsapp.baileys.service.ts` de la etiqueta `2.3.7` (huella de git
 * `60e857fc…`, idéntica a la del repositorio público, verificado el
 * 08/10/2026), y la de la clave, de Baileys 7.0.0-rc.9
 * (`src/Utils/decode-wa-message.ts`). Llegada real: se comprueba en la puesta
 * en marcha del número.
 *
 *   - `messages.upsert` trae UN objeto (1483); `messages.set`, la
 *     sincronización de historial, trae una LISTA (1049-1052). Las dos con la
 *     forma de `prepareMessage` (4652-4704).
 *   - `key`: `remoteJid`, `fromMe`, `id`, `remoteJidAlt`, `addressingMode`.
 *     En modo `lid`, `remoteJidAlt` es el teléfono; en modo `pn`, `remoteJid`
 *     es el teléfono y `remoteJidAlt` el `@lid` (Baileys ~85-107 y ~196-207).
 *   - Cuando `remoteJid` es `@lid` y hay `remoteJidAlt`, Evolution pisa
 *     `remoteJid` con el teléfono (1478-1479) y el `@lid` no viaja en ningún
 *     otro campo. Solo en `messages.upsert`: en `messages.set` no lo hace.
 *   - `messageTimestamp` en SEGUNDOS. `messageType` sale de `getContentType`,
 *     con `extendedTextMessage` pasado a `conversation` (4678-4682).
 *   - `contextInfo` del mensaje, entero, en la raíz (4665): `stanzaId` es el
 *     mensaje citado y `externalAdReply` el anuncio de click-to-WhatsApp.
 *   - Lo escrito desde el teléfono llega como `messages.upsert` con
 *     `fromMe = true`. Lo enviado por la API NO vuelve como `messages.upsert`
 *     (`emitOwnEvents: false`, 658): vuelve como `send.message`, con el mismo
 *     `key.id` que la respuesta del envío (2545, 2557).
 *   - Los adjuntos no traen el archivo: `base64: false` en la instancia
 *     (`scripts/setup-evolution-channel.mjs:446`). Se bajan en F28.
 *
 * ── LAS VÍAS AUTOMÁTICAS DE RECONCILIACIÓN, EN LA FORMA QUE EXISTE ───────────
 *
 * Reconciliar es saber que un `@lid` sin teléfono y un teléfono son la misma
 * persona. Eso pide un aviso que traiga los dos. Con 2.3.7 el único que puede
 * es un mensaje en modo `pn`: `remoteJid` con el teléfono y `remoteJidAlt` con
 * el `@lid`. El caso que describe `docs/investigacion-evolution-api.md:790-791`
 * (un `@lid` con `remoteJidAlt` = teléfono) no sirve: Evolution pisa el `@lid`
 * antes de avisar. Los avisos de contacto traen solo `{ remoteJid, pushName,
 * profilePicUrl, instanceId }` (1496-1506, 819, 861, 909): se procesan con la
 * misma regla por si algún día traen el otro identificador, pero en 2.3.7 no
 * aportan un camino propio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { identidadDeClave, telefonoDeJid, type ClaveEvolution } from "./identidad-whatsapp";
import { upsertContactForSender } from "./inbox-sync";
import { messagePreview } from "./message-preview";
import { aplicarToque, toqueDe } from "./atribucion";
import { guardarMensajes, type MensajeParaGuardar, type TipoDeMensaje } from "./mensajes-guardado";

export interface MensajeEvolution {
  key?: ClaveEvolution & { id?: string | null; fromMe?: boolean | null };
  pushName?: string | null;
  message?: Record<string, unknown> | null;
  messageType?: string | null;
  messageTimestamp?: number | string | { low?: number } | null;
  contextInfo?: {
    stanzaId?: string | null;
    externalAdReply?: {
      sourceId?: string | null;
      sourceUrl?: string | null;
      sourceType?: string | null;
      ctwaClid?: string | null;
    } | null;
  } | null;
}

export interface CanalEvolutionParaGuardar {
  id: string;
  workspace_id: string;
  platform: string;
}

/** Eventos de Evolution que traen mensajes. El nombre llega con puntos o con guiones bajos. */
export function normalizarEvento(evento: string): string {
  return evento.trim().toLowerCase().replace(/_/g, ".");
}
export const EVENTOS_CON_MENSAJES = new Set(["messages.upsert", "messages.set", "send.message"]);
export const EVENTOS_DE_CONTACTO = new Set(["contacts.upsert", "contacts.update"]);

const TIPOS: Record<string, TipoDeMensaje> = {
  conversation: "texto",
  extendedTextMessage: "texto",
  imageMessage: "imagen",
  audioMessage: "audio",
  pttMessage: "audio",
  videoMessage: "video",
  ptvMessage: "video",
  documentMessage: "documento",
  documentWithCaptionMessage: "documento",
  stickerMessage: "sticker",
  locationMessage: "ubicacion",
  liveLocationMessage: "ubicacion",
};

const CON_ADJUNTO = new Set(["imagen", "audio", "video", "documento", "sticker"]);

/** Segundos de Evolution a ISO. Baileys a veces manda un Long (`{ low, high }`). */
export function fechaDeEvolution(ts: MensajeEvolution["messageTimestamp"]): string {
  const segundos =
    typeof ts === "number" ? ts : typeof ts === "string" ? Number(ts) : typeof ts?.low === "number" ? ts.low : NaN;
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000).toISOString() : new Date().toISOString();
}

function textoDe(m: MensajeEvolution): string | null {
  const msg = (m.message ?? {}) as Record<string, any>;
  const t =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    msg.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    null;
  return typeof t === "string" && t.trim() ? t : null;
}

/** De un mensaje de Evolution a lo que guarda `messages`. Sin conversación todavía. */
export function traducirMensaje(m: MensajeEvolution): Omit<MensajeParaGuardar, "conversationId"> & {
  tipoOriginal: string;
} {
  const tipoOriginal = m.messageType ?? "desconocido";
  const tipo = TIPOS[tipoOriginal] ?? "otro";
  const crudo = (m.message ?? {}) as Record<string, any>;
  const adjunto = CON_ADJUNTO.has(tipo)
    ? [
        {
          type: tipoOriginal,
          mimetype: crudo[tipoOriginal]?.mimetype ?? null,
          fileName: crudo[tipoOriginal]?.fileName ?? null,
        },
      ]
    : null;
  return {
    direction: m.key?.fromMe ? "outbound" : "inbound",
    platformMessageId: m.key?.id ?? null,
    text: textoDe(m),
    attachments: adjunto,
    messageType: tipo,
    quotedMessageId: m.contextInfo?.stanzaId ?? null,
    remoteJid: identidadDeClave(m.key).rawJid,
    createdAt: fechaDeEvolution(m.messageTimestamp),
    tipoOriginal,
  };
}

type Supa = SupabaseClient;

async function contactoPorIdentificador(supabase: Supa, canalId: string, columna: "platform_sender_id" | "raw_jid", valor: string) {
  const { data } = await supabase
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", canalId)
    .eq(columna, valor)
    .maybeSingle();
  return (data as { contact_id?: string } | null)?.contact_id ?? null;
}

/**
 * Vías automáticas 1 y 2 de F26: si la clave trae un teléfono y además el
 * `@lid` de una identidad guardada sin teléfono, se reconcilia. Si el teléfono
 * ya es de otro contacto, `reconciliar_telefono` no escribe y devuelve
 * `conflicto`: mostrar esa sugerencia es de F29.
 */
export async function reconciliarDesdeClave(
  supabase: Supa,
  canal: CanalEvolutionParaGuardar,
  clave: ClaveEvolution,
  via: "mensaje" | "aviso_evolution",
): Promise<{ contactId: string; resultado: string } | null> {
  const telefono = telefonoDeJid(clave.remoteJid) ?? telefonoDeJid(clave.remoteJidAlt);
  const lid = [clave.remoteJidAlt, clave.remoteJid].find((j) => typeof j === "string" && j.endsWith("@lid"));
  if (!telefono || !lid) return null;
  const contactId = await contactoPorIdentificador(supabase, canal.id, "raw_jid", lid);
  if (!contactId) return null;
  const { data, error } = await supabase.rpc("reconciliar_telefono", {
    p_contacto: contactId,
    p_telefono: telefono,
    p_via: via,
  });
  if (error) throw new Error(`reconciliar_telefono: ${error.message}`);
  return { contactId, resultado: String((data as { resultado?: string } | null)?.resultado ?? "") };
}

/**
 * Guarda los mensajes de un aviso. Tira si algo no se pudo escribir: el
 * receptor libera el reclamo y responde 500, y Evolution reintenta (hasta 10
 * veces, `docs/investigacion-evolution-api.md:240`).
 */
export async function guardarMensajesDeEvolution(
  supabase: Supa,
  canal: CanalEvolutionParaGuardar,
  evento: string,
  mensajes: readonly MensajeEvolution[],
): Promise<{ guardados: number; salteados: number }> {
  const historial = normalizarEvento(evento) === "messages.set";
  let guardados = 0;
  let salteados = 0;
  let ultimoEntrante: string | null = null;

  for (const m of mensajes) {
    const identidad = identidadDeClave(m.key);
    if (identidad.tipo !== "persona" || !identidad.rawJid || !m.key?.id) {
      salteados++;
      continue;
    }
    const fila = traducirMensaje(m);
    const entrante = fila.direction === "inbound";
    const ahora = new Date().toISOString();

    // El contacto: por su identificador en el canal; si no, por el `@lid` que
    // trae al lado (vía 1); si no, nuevo.
    let contactId = await contactoPorIdentificador(supabase, canal.id, "platform_sender_id", identidad.rawJid);
    if (!contactId) {
      const reconciliado = await reconciliarDesdeClave(supabase, canal, m.key, "mensaje");
      contactId = reconciliado?.contactId ?? null;
    }
    let existia = Boolean(contactId);
    if (!contactId) {
      const nombre = !m.key.fromMe && m.pushName?.trim() ? m.pushName.trim() : identidad.telefono ?? identidad.rawJid;
      const creado = await upsertContactForSender({
        supabase,
        channel: canal,
        senderId: identidad.rawJid,
        senderName: nombre,
        senderPicture: null,
        senderUsername: null,
        interactionAt: ahora,
      });
      if (!creado) throw new Error("no se pudo crear el contacto");
      contactId = creado.contactId;
      existia = creado.existed;
      if (!existia) {
        await supabase
          .from("contact_channels")
          .update({ addressing_mode: identidad.addressingMode })
          .eq("channel_id", canal.id)
          .eq("platform_sender_id", identidad.rawJid);
        const { error: errTel } = await supabase
          .from("contacts")
          .update(identidad.telefono ? { phone: identidad.telefono, phone_resolved: true } : { phone_resolved: false })
          .eq("id", contactId);
        if (errTel) throw new Error(`contacts: ${errTel.message}`);
      }
    }

    const preview = messagePreview(fila.text ?? (fila.messageType !== "texto" ? `[${fila.messageType}]` : null));
    const { data: conv } = await supabase
      .from("conversations")
      .upsert(
        {
          workspace_id: canal.workspace_id,
          channel_id: canal.id,
          contact_id: contactId,
          platform: canal.platform,
          status: "open",
          last_message_at: fila.createdAt,
          last_message_preview: preview,
          // WhatsApp no tiene importación del historial (§4.7: el número es
          // nuevo): lo que hay es lo que entra. La bandeja no tiene que
          // mostrarle el aviso de «historial sin importar».
          historial_estado: "completo",
          ...(entrante && !historial ? { unread_count: 1 } : {}),
        },
        { onConflict: "channel_id,contact_id" },
      )
      .select("id")
      .single();
    const conversationId = (conv as { id?: string } | null)?.id;
    if (!conversationId) throw new Error("no se pudo guardar la conversación");
    if (existia && entrante && !historial) {
      await supabase.rpc("increment_unread", { conv_id: conversationId, preview });
    }

    const { tipoOriginal: _t, ...mensaje } = fila;
    const { error } = await guardarMensajes(supabase, [{ ...mensaje, conversationId }]);
    if (error) throw new Error(`messages: ${error.message}`);
    guardados++;

    // F25: el toque de un anuncio de click-to-WhatsApp. `first_click` no se
    // pisa nunca (lo frena además un trigger de la 00029).
    const ad = m.contextInfo?.externalAdReply;
    if (entrante && ad) {
      const toque = toqueDe({
        url: ad.sourceUrl ?? null,
        adId: ad.sourceId ?? null,
        ctwaClid: ad.ctwaClid ?? null,
        sourceType: ad.sourceType ?? null,
        canal: "whatsapp",
        cuando: fila.createdAt,
      });
      if (toque) {
        const { data: actual } = await supabase.from("contacts").select("attribution").eq("id", contactId).maybeSingle();
        await supabase
          .from("contacts")
          .update({ attribution: aplicarToque((actual as { attribution?: unknown } | null)?.attribution as never, toque) })
          .eq("id", contactId);
      }
    }

    if (entrante && !historial) ultimoEntrante = ahora;
  }

  if (ultimoEntrante) {
    await supabase.from("channels").update({ last_inbound_at: ultimoEntrante }).eq("id", canal.id);
  }
  return { guardados, salteados };
}

/** Avisos de contacto (`contacts.upsert` y `contacts.update`): solo la vía 2. */
export async function procesarAvisoDeContacto(
  supabase: Supa,
  canal: CanalEvolutionParaGuardar,
  data: unknown,
): Promise<number> {
  const lista = (Array.isArray(data) ? data : data && typeof data === "object" ? [data] : []) as ClaveEvolution[];
  let reconciliados = 0;
  for (const c of lista) {
    const r = await reconciliarDesdeClave(supabase, canal, c, "aviso_evolution");
    if (r?.resultado === "resuelto") reconciliados++;
  }
  return reconciliados;
}
