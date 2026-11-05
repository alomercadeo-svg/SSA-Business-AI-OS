/**
 * Cerrar y reabrir una conversación (F35, tramo D de S8), del lado del hilo.
 * Sin código de servidor: lo importa el hilo, que es `"use client"`. La regla
 * (el seguimiento de hoy o vencido pide el próximo) vive en la ruta,
 * `app/api/v1/conversations/[id]/route.ts`.
 */

export type EstadoDeConversacion = "open" | "closed";

export const AVISO_DE_FALLA_DE_ESTADO = "No se pudo cambiar el estado de la conversación.";
export const PEDIDO_DE_SEGUIMIENTO = "Antes de cerrar, elegí el próximo seguimiento.";

export const avisoDeCambio = (estado: EstadoDeConversacion) => (estado === "closed" ? "Conversación cerrada" : "Conversación reabierta");

export type ResultadoDelCambio =
  | { tipo: "cambiado"; estado: EstadoDeConversacion }
  | { tipo: "pide_seguimiento"; fecha: string | null }
  | { tipo: "fallo" };

/** Lo que dice la respuesta de la ruta. Todo lo que no es un cambio claro es una falla. */
export function resultadoDelCambio(status: number, cuerpo: unknown): ResultadoDelCambio {
  const c = (cuerpo ?? {}) as { status?: unknown; code?: unknown; fecha?: unknown };
  if (status === 200 && (c.status === "open" || c.status === "closed")) return { tipo: "cambiado", estado: c.status };
  if (status === 409 && c.code === "pide_seguimiento") return { tipo: "pide_seguimiento", fecha: typeof c.fecha === "string" ? c.fecha : null };
  return { tipo: "fallo" };
}

export async function cambiarEstadoDeConversacion(id: string, estado: EstadoDeConversacion): Promise<ResultadoDelCambio> {
  try {
    const res = await fetch(`/api/v1/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    return resultadoDelCambio(res.status, await res.json().catch(() => null));
  } catch {
    return { tipo: "fallo" };
  }
}
