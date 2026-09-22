/**
 * Procesamiento de los eventos de Evolution, después del acuse.
 *
 * ESTE MÓDULO ES UN STUB A PROPÓSITO, y es la frontera entre el Bloque 2 y el
 * Bloque 3.
 *
 * El Bloque 2 construye la cañería: el receptor autentica el aviso, controla
 * que no esté repetido, responde 200 y llama a esta función. El Bloque 3 (F27,
 * guardado de mensajes entrantes) le pone el cuerpo adentro: resolver el
 * contacto, guardar el mensaje, bajar el adjunto, actualizar la conversación.
 *
 * La frontera está en una sola función para que el Bloque 3 no tenga que tocar
 * la ruta. Lo que hoy está probado del receptor —el orden del acuse, la
 * autenticación, la idempotencia, las alertas— sigue probado sin cambios.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CONSECUENCIA QUE HAY QUE TENER PRESENTE                                   │
 * │                                                                           │
 * │ Mientras esta función no guarde nada, cada mensaje que llegue se DESCARTA │
 * │ después de acusar 200. No es un error y no dispara ninguna alerta: para   │
 * │ Evolution la entrega salió bien y no la reintenta.                        │
 * │                                                                           │
 * │ Por eso el número de WhatsApp NO se vincula hasta que F27 esté construido │
 * │ y probado. Si se vincula antes, los mensajes reales de los leads se       │
 * │ pierden de la peor forma: en silencio y con acuse de éxito. El único      │
 * │ síntoma serían conversaciones que nunca existieron.                       │
 * │                                                                           │
 * │ Ver docs/requerimientos-fase1.md §4.7 y el Flujo 4, paso 5.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaveMensaje } from "@/lib/evolution-webhook";

export interface MensajeEntrante {
  key?: ClaveMensaje;
  messageType?: string;
  /** Unix en SEGUNDOS, no milisegundos. La conversión la hace F27 al guardar. */
  messageTimestamp?: number;
}

export interface EventoEvolution {
  supabase: SupabaseClient;
  canal: { id: string; workspace_id: string; platform: string };
  /** `messages.upsert`, `messages.set`, `connection.update`, etc. */
  evento: string;
  instancia: string;
  /** Ya filtrados por idempotencia: acá no llegan repetidos. */
  mensajes: MensajeEntrante[];
}

/**
 * Procesa un evento ya autenticado y sin duplicados.
 *
 * Hoy solo registra un resumen. El resumen es deliberadamente pobre en datos:
 * el cuerpo del aviso de Evolution incluye la API key de la instancia, que
 * autoriza mandar mensajes y borrarla, así que ni este log ni ningún otro del
 * camino escriben el payload crudo. Lo que se registra —evento, instancia,
 * cantidad y tipos— alcanza para responder "¿está entrando algo?" sin ser un
 * canal de fuga.
 */
export async function procesarEventoEvolution(evento: EventoEvolution): Promise<void> {
  const tipos = [...new Set(evento.mensajes.map((m) => m.messageType ?? "desconocido"))];

  console.log(
    `[evolution] evento=${evento.evento} instancia=${evento.instancia} ` +
    `canal=${evento.canal.id} mensajes=${evento.mensajes.length}` +
    (tipos.length > 0 ? ` tipos=${tipos.join(",")}` : "") +
    ` — NO se guarda nada: F27 todavía no está construido.`
  );
}
