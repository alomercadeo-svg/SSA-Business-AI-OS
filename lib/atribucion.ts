/**
 * Atribución de origen del contacto (F25): `contacts.attribution`, con
 * `first_click` y `last_click`.
 *
 * Esto arma el "toque" a partir de lo que trae una interacción y decide cómo
 * queda la atribución. **Hoy no lo llama ningún camino**: el primer llamador es
 * F27, con el aviso de Evolution de un contacto que llega por un anuncio de
 * click-to-WhatsApp (`contextInfo.externalAdReply`). Si Zernio manda la
 * referencia del anuncio en Instagram no está verificado.
 *
 * Las reglas:
 *   - `first_click` se escribe una sola vez. La base lo hace cumplir con un
 *     trigger (00029), que rechaza sobrescribirlo; acá se evita llegar.
 *   - `last_click` se actualiza en cada interacción que traiga parámetros de
 *     seguimiento. Una interacción sin parámetros no toca nada: no es un clic.
 *   - En una fusión de contactos (F26), `first_click` queda el más viejo y
 *     `last_click` el más nuevo. Eso lo hace la función SQL
 *     `fusionar_contactos` (00031), en la misma operación que la fusión.
 */
import type { Json } from "@/lib/types/database";

export interface Toque {
  /** De dónde: `meta`, `google`, el dominio de la URL… */
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  /** Identificador del anuncio, si lo trae (click-to-WhatsApp, Meta). */
  ad_id?: string;
  /** El identificador de clic de click-to-WhatsApp, si viene. */
  ctwa_clid?: string;
  referral_url?: string;
  /** Canal por donde llegó: `whatsapp`, `instagram`. */
  channel?: string;
  /** Cuándo ocurrió el toque, ISO 8601. */
  captured_at: string;
}

export interface Atribucion {
  first_click?: Toque;
  last_click?: Toque;
}

const UTM = ["source", "medium", "campaign", "content", "term"] as const;

/**
 * Arma un toque con lo que haya. Devuelve null si no trae ningún parámetro de
 * seguimiento: una interacción común no es un clic de origen.
 */
export function toqueDe(datos: {
  utm?: Partial<Record<(typeof UTM)[number], string | null | undefined>>;
  url?: string | null;
  adId?: string | null;
  ctwaClid?: string | null;
  sourceType?: string | null;
  canal?: string | null;
  cuando: string;
}): Toque | null {
  const t: Toque = { captured_at: datos.cuando };
  const deUrl = parametrosDeUrl(datos.url);
  for (const k of UTM) {
    const v = datos.utm?.[k] ?? deUrl[`utm_${k}`];
    if (v && String(v).trim()) t[k] = String(v).trim();
  }
  if (datos.adId?.trim()) t.ad_id = datos.adId.trim();
  if (datos.ctwaClid?.trim()) t.ctwa_clid = datos.ctwaClid.trim();
  if (datos.url?.trim()) t.referral_url = datos.url.trim();
  if (!t.source && datos.sourceType?.trim()) t.source = datos.sourceType.trim();

  const traeAlgo = UTM.some((k) => t[k]) || t.ad_id || t.ctwa_clid || t.referral_url;
  if (!traeAlgo) return null;
  if (datos.canal) t.channel = datos.canal;
  return t;
}

function parametrosDeUrl(url: string | null | undefined): Record<string, string> {
  if (!url) return {};
  try {
    return Object.fromEntries(new URL(url).searchParams.entries());
  } catch {
    return {};
  }
}

function comoAtribucion(valor: Json | Atribucion | null | undefined): Atribucion {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Atribucion) : {};
}

/** Cómo queda la atribución después de un toque. Sin toque, igual que antes. */
export function aplicarToque(actual: Json | Atribucion | null | undefined, toque: Toque | null): Atribucion {
  const a = comoAtribucion(actual);
  if (!toque) return a;
  return { ...a, first_click: a.first_click ?? toque, last_click: toque };
}
