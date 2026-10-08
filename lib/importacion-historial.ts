/**
 * La importación del historial de Instagram (criterio de F27): las
 * conversaciones hasta el final del listado de Zernio y, por cada una, todos
 * sus mensajes.
 *
 * Sin esto, el día que la bandeja lee de la base, las conversaciones viejas se
 * ven vacías: "¿qué se veía antes que deje de verse?".
 *
 * ── CÓMO SE RETOMA, Y CÓMO SE SABE QUÉ QUEDÓ A MEDIO TRAER ───────────────────
 *
 * Corre en `after()`, y un redespliegue o un error de Zernio la pueden cortar.
 * Cada página de mensajes se guarda apenas llega, y la conversación pasa a
 * `historial_estado = 'completo'` RECIÉN con la última. Lo que se cortó queda
 * `pendiente`; volver a sincronizar retoma solo las que no están `completo`, y
 * la restricción única de `messages` evita duplicar lo que ya había entrado.
 * La unicidad evita duplicados; lo que evita los hilos a medio traer sin
 * aviso es esta marca, que además ve la bandeja.
 *
 * ── LOS TOPES ───────────────────────────────────────────────────────────────
 *
 * De seguridad, no de trabajo: 50 páginas de 100 mensajes por conversación
 * (5.000). Si una conversación los pasa, queda `incompleto`, y eso se ve
 * distinto de `completo`. Las conversaciones tienen su propio tope en
 * `lib/inbox-sync.ts`, también por encima del máximo documentado de Zernio.
 *
 * ── UNA SOLA A LA VEZ ───────────────────────────────────────────────────────
 *
 * `reservar_tarea` (00032) toma la importación del espacio por 30 minutos. Un
 * segundo «Sincronizar» mientras corre no arranca otra. Si el proceso murió sin
 * liberarla, a los 30 minutos se puede volver a tomar.
 *
 * Las llamadas van en serie, de a una. Ante un 429 se espera y se reintenta dos
 * veces; si sigue, se corta la corrida y lo que falta queda `pendiente`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapearMensajesDeZernio, TAMANO_DE_PAGINA, type ClienteDeMensajes } from "./zernio-message-map";
import { guardarMensajes, tipoPorAdjuntos, type AdjuntoCrudo } from "./mensajes-guardado";
import type { BackfillChannel } from "./inbox-sync";

export const TOPE_DE_PAGINAS_POR_CONVERSACION = 50;
export const MINUTOS_DE_RESERVA = 30;

export interface ResultadoDeMensajes {
  completas: number;
  incompletas: number;
  noDisponibles: number;
  conError: number;
  mensajes: number;
  cortadaPorLimite: boolean;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function estadoHttp(err: unknown): number | null {
  const s = (err as { statusCode?: unknown; status?: unknown } | null)?.statusCode ?? (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

class LimiteDeZernio extends Error {}

async function conReintento<T>(fn: () => Promise<T>, esperaMs: number): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (estadoHttp(err) !== 429) throw err;
      if (intento >= 2) throw new LimiteDeZernio("Zernio respondió 429 tres veces seguidas");
      await esperar(esperaMs * (intento + 1));
    }
  }
}

/**
 * Trae y guarda los mensajes de las conversaciones que no están completas.
 * `supabase` tiene que ser el cliente de servicio.
 */
export async function importarMensajes({
  supabase,
  zernio,
  channels,
  esperaAnte429Ms = 30_000,
}: {
  supabase: SupabaseClient;
  zernio: ClienteDeMensajes;
  channels: BackfillChannel[];
  esperaAnte429Ms?: number;
}): Promise<ResultadoDeMensajes> {
  const r: ResultadoDeMensajes = { completas: 0, incompletas: 0, noDisponibles: 0, conError: 0, mensajes: 0, cortadaPorLimite: false };

  for (const canal of channels) {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, late_conversation_id, contact_id")
      .eq("channel_id", canal.id)
      .in("historial_estado", ["pendiente", "incompleto"])
      .not("late_conversation_id", "is", null);
    const { data: identidades } = await supabase
      .from("contact_channels")
      .select("contact_id, platform_sender_id")
      .eq("channel_id", canal.id);
    const remitente = new Map(
      ((identidades ?? []) as Array<{ contact_id: string; platform_sender_id: string }>).map((i) => [i.contact_id, i.platform_sender_id]),
    );

    for (const conv of (convs ?? []) as Array<{ id: string; late_conversation_id: string; contact_id: string }>) {
      let cursor: string | undefined;
      let terminada = false;
      try {
        for (let pagina = 0; pagina < TOPE_DE_PAGINAS_POR_CONVERSACION; pagina++) {
          const res = await conReintento(
            () =>
              zernio.messages.getInboxConversationMessages({
                path: { conversationId: conv.late_conversation_id },
                query: { accountId: canal.late_account_id, sortOrder: "desc", limit: TAMANO_DE_PAGINA, cursor },
              }),
            esperaAnte429Ms,
          );
          // Una respuesta sin lista NO es "no hay más mensajes": marcaría
          // completa una conversación que no se trajo. Se trata como error y
          // la conversación queda `pendiente`.
          const crudos = res.data?.messages;
          if (!Array.isArray(crudos)) {
            const e = (res as { error?: unknown; response?: { status?: number } }) ?? {};
            throw Object.assign(new Error("Zernio respondió sin lista de mensajes"), {
              statusCode: e.response?.status ?? null,
            });
          }
          const filas = mapearMensajesDeZernio(crudos, conv.id).filter((m) => m.platform_message_id);
          const { error } = await guardarMensajes(
            supabase,
            filas.map((m) => ({
              conversationId: conv.id,
              direction: m.direction,
              platformMessageId: m.platform_message_id,
              text: m.text,
              attachments: (m.attachments as AdjuntoCrudo[] | null) ?? null,
              messageType: tipoPorAdjuntos(m.attachments as AdjuntoCrudo[] | null),
              quotedMessageId: null,
              remoteJid: remitente.get(conv.contact_id) ?? null,
              createdAt: m.created_at,
            })),
          );
          if (error) throw new Error(`messages: ${error.message}`);
          r.mensajes += filas.length;

          const pag = res.data?.pagination;
          if (!pag?.hasMore || !pag.nextCursor) {
            terminada = true;
            break;
          }
          cursor = pag.nextCursor;
        }
        await supabase
          .from("conversations")
          .update({ historial_estado: terminada ? "completo" : "incompleto", historial_importado_at: new Date().toISOString() })
          .eq("id", conv.id);
        if (terminada) r.completas++;
        else r.incompletas++;
      } catch (err) {
        if (err instanceof LimiteDeZernio) {
          r.cortadaPorLimite = true;
          return r;
        }
        if (estadoHttp(err) === 404) {
          await supabase.from("conversations").update({ historial_estado: "no_disponible" }).eq("id", conv.id);
          r.noDisponibles++;
          continue;
        }
        // Queda `pendiente`: la próxima sincronización la retoma.
        r.conError++;
        console.error(
          `[importacion] conversación ${conv.id}: ${err instanceof Error ? err.message : "error"}`,
        );
      }
    }
  }
  return r;
}

/** Toma la importación del espacio. false si ya hay una corriendo. */
export async function reservarImportacion(supabase: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("reservar_tarea", {
    p_clave: claveDeImportacion(workspaceId),
    p_workspace_id: workspaceId,
    p_minutos: MINUTOS_DE_RESERVA,
  });
  if (error) throw new Error(`reservar_tarea: ${error.message}`);
  return data === true;
}

export function claveDeImportacion(workspaceId: string): string {
  return `importacion_historial:${workspaceId}`;
}

/** Libera la reserva y deja el resultado, para el recuento y la pantalla. */
export async function terminarImportacion(
  supabase: SupabaseClient,
  workspaceId: string,
  resultado: Record<string, unknown>,
  error: string | null,
): Promise<void> {
  const ahora = new Date().toISOString();
  await supabase
    .from("tareas_estado")
    .update({
      ocupada_hasta: null,
      resultado,
      ultimo_error: error,
      updated_at: ahora,
      ...(error ? {} : { ultimo_ok_at: ahora }),
    })
    .eq("clave", claveDeImportacion(workspaceId));
}
