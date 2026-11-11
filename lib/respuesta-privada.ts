/**
 * F40, la respuesta privada a un comentario de Instagram (ítem 6 de la sesión
 * de cierre, 10/11/2026): hasta 7 días desde el comentario y una sola vez por
 * comentario, controlado con `comment_logs` (00061: `comentado_at`, la hora
 * del comentario según el aviso, y `respuesta_privada_at`).
 *
 * Por qué columnas nuevas (verificado el 06/11/2026): `comment_logs.created_at`
 * es la hora de proceso, no la del comentario; ninguna columna registraba la
 * respuesta privada; y `dm_sent` queda en `true` aunque el envío falle.
 *
 * La regla de los 7 días y la única vez es la de Meta que cita el `CLAUDE.md`;
 * **en los tipos de `@zernio/node` 0.2.519 no figura** (búsqueda del 06/11).
 *
 * El envío reclama el comentario ANTES de llamar a Zernio (un `update` que
 * solo pasa si `respuesta_privada_at` sigue vacía): dos clics a la vez no
 * mandan dos. Si Zernio la rechaza, el reclamo se suelta.
 */
export const DIAS_PARA_RESPONDER = 7;

export interface RegistroDeComentario {
  id: string;
  workspaceId: string;
  postId: string | null;
  commentId: string;
  lateAccountId: string | null;
  /** La hora del comentario según el aviso; null en los registrados antes de la 00061. */
  comentadoAt: string | null;
  /** `comment_logs.created_at`, la hora de proceso: el respaldo si falta la otra. */
  creadoAt: string;
  respuestaPrivadaAt: string | null;
}

export type Motivo = "ya_respondido" | "vencido";

const desde = (r: RegistroDeComentario) => new Date(r.comentadoAt ?? r.creadoAt).getTime();

export function decidirRespuestaPrivada(r: RegistroDeComentario, ahora: Date): { ok: true } | { ok: false; motivo: Motivo } {
  if (r.respuestaPrivadaAt) return { ok: false, motivo: "ya_respondido" };
  if (ahora.getTime() - desde(r) > DIAS_PARA_RESPONDER * 86_400_000) return { ok: false, motivo: "vencido" };
  return { ok: true };
}

/** «Quedan N días»: redondeado para arriba, nunca negativo. */
export function diasParaResponder(r: RegistroDeComentario, ahora: Date): number {
  const resta = DIAS_PARA_RESPONDER * 86_400_000 - (ahora.getTime() - desde(r));
  return Math.max(0, Math.ceil(resta / 86_400_000));
}

export const TEXTOS: Record<Motivo, string> = {
  ya_respondido: "Ya respondiste en privado a este comentario. Instagram permite una sola respuesta privada por comentario.",
  vencido: "Pasaron más de 7 días desde el comentario: Instagram ya no permite responderle en privado.",
};

export interface DependenciasDeRespuesta {
  leer: (id: string, workspaceId: string) => Promise<RegistroDeComentario | null>;
  /** true si lo reclamó este pedido (estaba sin responder). */
  reclamar: (id: string, cuando: Date) => Promise<boolean>;
  soltar: (id: string, error: string) => Promise<void>;
  enviar: (p: { postId: string; commentId: string; accountId: string; mensaje: string }) => Promise<{ messageId?: string | null }>;
  ahora: () => Date;
}

export async function enviarRespuestaPrivada(
  id: string,
  workspaceId: string,
  mensaje: string,
  d: DependenciasDeRespuesta,
): Promise<{ status: number; motivo?: Motivo; error?: string; messageId?: string | null }> {
  const texto = mensaje.trim();
  if (!texto) return { status: 400, error: "Escribí la respuesta." };
  if (texto.length > 1000) return { status: 400, error: "La respuesta es demasiado larga (hasta 1000 caracteres)." };
  const r = await d.leer(id, workspaceId);
  if (!r) return { status: 404, error: "Ese comentario no existe." };
  if (!r.lateAccountId) return { status: 409, error: "El canal de ese comentario no está conectado a Zernio." };
  const decision = decidirRespuestaPrivada(r, d.ahora());
  if (!decision.ok) return { status: 409, motivo: decision.motivo, error: TEXTOS[decision.motivo] };
  if (!(await d.reclamar(id, d.ahora()))) return { status: 409, motivo: "ya_respondido", error: TEXTOS.ya_respondido };
  try {
    const res = await d.enviar({ postId: r.postId ?? r.commentId, commentId: r.commentId, accountId: r.lateAccountId, mensaje: texto });
    return { status: 200, messageId: res.messageId ?? null };
  } catch (e) {
    await d.soltar(id, e instanceof Error ? e.message.slice(0, 300) : "error");
    return { status: 502, error: "Instagram no aceptó la respuesta privada. No quedó enviada; podés probar de nuevo." };
  }
}
