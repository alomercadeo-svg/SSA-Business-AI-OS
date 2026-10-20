/**
 * Lo que la ficha de contacto (F30) calcula sin la base: horas en la zona del
 * negocio, las conversaciones agrupadas por canal y el origen en una línea.
 *
 * Lo usan componentes de cliente (las notas, «Editar datos»): no puede
 * importar nada de servidor. Por eso la etiqueta del canal (`etiquetaDeCanal`,
 * de `lib/auditoria.ts`, que usa el cliente de servicio) la pasa la página.
 *
 * LA HORA. La ficha del fork mostraba «Last active» en UTC (anotado el
 * 19/10/2026): `toLocaleDateString([], …)` corre en el servidor, que está en
 * UTC. Acá la zona va explícita: la del negocio es la de Costa Rica (§14).
 */
import type { Toque } from "./atribucion";

export const ZONA_DEL_NEGOCIO = "America/Costa_Rica";

/** «20 oct 2026, 14:40», en la hora de Costa Rica. */
export function horaDelNegocio(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ZONA_DEL_NEGOCIO,
  }).format(new Date(iso));
}

/**
 * Una fecha sin hora (`next_followup_date`, tipo `date`): se muestra tal cual,
 * sin pasarla por ninguna zona, que la correría un día.
 */
export function fechaSinHora(fecha: string | null | undefined): string {
  if (!fecha) return "Sin fecha";
  const [a, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(a, m - 1, d)),
  );
}

export interface CanalDeConversacion {
  id: string;
  platform: string | null;
  username: string | null;
  display_name: string | null;
  instance_name: string | null;
}

export interface ConversacionDeFicha {
  id: string;
  channel_id: string;
  status: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  channels: CanalDeConversacion | null;
}

export interface GrupoDeCanal {
  canalId: string;
  etiqueta: string;
  platform: string | null;
  conversaciones: ConversacionDeFicha[];
}

/**
 * F29 y F30: la ficha muestra las conversaciones agrupadas por canal (la
 * cuenta del negocio por donde entraron), el grupo con la más reciente primero.
 */
export function agruparPorCanal(
  conversaciones: ConversacionDeFicha[],
  etiquetar: (canal: CanalDeConversacion) => string,
): GrupoDeCanal[] {
  const grupos = new Map<string, GrupoDeCanal>();
  const ordenadas = [...conversaciones].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  for (const c of ordenadas) {
    let g = grupos.get(c.channel_id);
    if (!g) {
      g = {
        canalId: c.channel_id,
        etiqueta: c.channels ? etiquetar(c.channels) : "Canal",
        platform: c.channels?.platform ?? null,
        conversaciones: [],
      };
      grupos.set(c.channel_id, g);
    }
    g.conversaciones.push(c);
  }
  return [...grupos.values()];
}

/** El origen de un toque en una línea: «meta / cpc · campaña verano · 3 oct 2026». */
export function textoDeToque(t: Toque | null | undefined): string {
  if (!t) return "Sin datos";
  const partes = [
    [t.source, t.medium].filter(Boolean).join(" / "),
    t.campaign ? `campaña ${t.campaign}` : "",
    t.ad_id ? `anuncio ${t.ad_id}` : "",
    t.channel ?? "",
  ].filter(Boolean);
  const cuando = t.captured_at ? horaDelNegocio(t.captured_at) : "";
  return [partes.join(" · ") || "Sin parámetros", cuando].filter(Boolean).join(" · ");
}

export const TEXTO_DE_TEMPERATURA: Record<string, string> = { frio: "Frío", tibio: "Tibio", caliente: "Caliente" };

const TEXTO_DE_TIPO: Record<string, string> = {
  texto: "Mensaje",
  imagen: "Foto",
  audio: "Audio",
  video: "Video",
  documento: "Documento",
  sticker: "Sticker",
  ubicacion: "Ubicación",
  otro: "Adjunto",
};

/**
 * La línea de una conversación en la ficha. Un mensaje sin texto (un video,
 * una foto) deja el resumen guardado vacío: entonces se muestra el tipo del
 * último mensaje. «Sin mensajes» solo cuando no hay ninguno. Antes decía «Sin
 * mensajes» con 18 mensajes guardados (lectura de Marcos del 20/10/2026).
 */
export function resumenDeConversacion(resumen: string | null | undefined, tipoDelUltimo: string | null | undefined): string {
  if (resumen && resumen.trim()) return resumen;
  if (!tipoDelUltimo) return "Sin mensajes";
  return TEXTO_DE_TIPO[tipoDelUltimo] ?? "Adjunto";
}

/** El enlace de una conversación de la ficha: abre ese hilo en la bandeja. */
export function enlaceAlHilo(conversacionId: string): string {
  return `/dashboard/inbox?conversacion=${encodeURIComponent(conversacionId)}`;
}
