/**
 * F44, criterio 3 (ítem 5 de la sesión de cierre, 10/11/2026): «Respondió a tu
 * historia». Se guarda en `messages.respuesta_historia` (00060): el id de la
 * historia y su enlace si el aviso lo trae. No se guarda la imagen.
 *
 * La forma real, leída el 10/11/2026 en una entrega del registro de Zernio:
 * `metadata.storyReply = { storyId, storyUrl }`, con `storyUrl` del CDN de
 * Meta. Los tipos de `@zernio/node` 0.2.519 (`dist/index.d.ts:7728-7734`)
 * dicen que ese enlace vence unas 24 horas después de publicada la historia;
 * no lo medí.
 */
export interface RespuestaHistoria {
  storyId: string | null;
  storyUrl: string | null;
}

export const TEXTO_HISTORIA = "Respondió a tu historia";
export const PREFIJO_VISTA_PREVIA = "Historia: ";
/** Desde el mensaje (no desde la historia, que no tiene hora en el aviso): una cota prudente. */
export const HORAS_DEL_ENLACE = 24;

/** De lo que trae el aviso a lo que se guarda; null si no es una respuesta a una historia. */
export function respuestaHistoriaDe(storyReply: unknown): RespuestaHistoria | null {
  if (storyReply === true) return { storyId: null, storyUrl: null };
  if (!storyReply || typeof storyReply !== "object") return null;
  const s = storyReply as { storyId?: unknown; storyUrl?: unknown };
  return {
    storyId: typeof s.storyId === "string" && s.storyId ? s.storyId : null,
    storyUrl: typeof s.storyUrl === "string" && s.storyUrl ? s.storyUrl : null,
  };
}

/** «Ver historia»: solo con un enlace https y antes de que venza. */
export function enlaceDeHistoria(h: RespuestaHistoria | null | undefined, creado: string, ahora: Date): string | null {
  const url = h?.storyUrl;
  if (!url || !/^https:\/\//i.test(url)) return null;
  const edad = ahora.getTime() - new Date(creado).getTime();
  if (!(edad >= 0) || edad > HORAS_DEL_ENLACE * 3_600_000) return null;
  return url;
}
