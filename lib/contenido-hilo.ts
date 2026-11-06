/**
 * F44, criterios 1 y 2: qué compartió el lead, reconocido por el aviso, sin
 * bajar nada.
 *
 * La forma sale de tres entrantes reales del 05/11/2026 a @poderosascomunidad
 * (`lib/fixtures/zernio-adjuntos-f44.json`):
 *   - publicación: `type: "share"`, `originalType: "ig_post"`; los dos enlaces
 *     que trae (`url` y `payload.url`) son de `lookaside.fbsbx.com`.
 *   - reel: `type: "video"` (igual que un video de verdad), `originalType:
 *     "ig_reel"`, `payload.reel_video_id`, y enlaces de `www.instagram.com`.
 *     Bajarlo devuelve una página, no un archivo (estado-fase1.md, 19/10/2026).
 *   - video de la cámara: `type: "video"`, sin `originalType` y con `payload`
 *     solo con `url`, de `lookaside.fbsbx.com`. Se baja como siempre.
 *
 * Se usa al guardar (`seDescarga`, para no intentar bajar un reel) y al
 * mostrar (`GET /api/v1/messages`), así se ven bien también los ya guardados.
 *
 * EL ENLACE. Es una excepción a la regla de `app/api/v1/messages/route.ts`
 * («la dirección del proveedor no sale del servidor»), aprobada por Marcos el
 * 05/11/2026: solo https y solo los hosts de `HOSTS_DEL_ENLACE`. **Desde el
 * 06/11/2026 vale solo para los reels:** el enlace de una publicación es de
 * `lookaside.fbsbx.com` y abre solo la imagen (visto por Marcos el 05/11), y
 * el armado desde `ig_post_media_id` no abre la publicación (probado por
 * Marcos el 06/11). La publicación se muestra con su título y sin botón (F44,
 * criterio 1, reescrito ese día).
 */
export type Compartido = "publicacion" | "reel";

export const HOSTS_DEL_ENLACE = new Set(["www.instagram.com", "instagram.com"]);
const HOSTS_DE_REEL = new Set(["www.instagram.com", "instagram.com"]);

type Crudo = {
  type?: unknown;
  url?: unknown;
  originalType?: unknown;
  payload?: { url?: unknown; reel_video_id?: unknown; title?: unknown } | null;
};

function comoCrudo(a: unknown): Crudo | null {
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Crudo) : null;
}

function hostDe(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

export function clasificarCompartido(adjunto: unknown): Compartido | null {
  const a = comoCrudo(adjunto);
  if (!a) return null;
  const host = hostDe(a.url);
  if (a.originalType === "ig_reel" || a.payload?.reel_video_id != null || (host !== null && HOSTS_DE_REEL.has(host))) return "reel";
  if (a.type === "share" || a.originalType === "ig_post") return "publicacion";
  return null;
}

/** `payload.url` o `url`, solo si es https y de un host de la lista. Si no, nulo. */
export function enlaceDelCompartido(adjunto: unknown): string | null {
  const a = comoCrudo(adjunto);
  if (!a) return null;
  for (const url of [a.payload?.url, a.url]) {
    const host = hostDe(url);
    if (host !== null && HOSTS_DEL_ENLACE.has(host)) return url as string;
  }
  return null;
}

/** Largo máximo del título que viaja al navegador. Un pie de foto puede ser largo. */
export const TITULO_MAXIMO = 300;

/**
 * El título de una publicación compartida (`payload.title`, en las muestras
 * reales del 05/11/2026), con los espacios juntados y cortado en
 * `TITULO_MAXIMO` con «…». Nulo si no hay o no es texto.
 */
export function tituloDelCompartido(adjunto: unknown): string | null {
  const a = comoCrudo(adjunto);
  const t = a?.payload?.title;
  if (typeof t !== "string") return null;
  const limpio = t.replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  return limpio.length > TITULO_MAXIMO ? limpio.slice(0, TITULO_MAXIMO - 1) + "…" : limpio;
}
