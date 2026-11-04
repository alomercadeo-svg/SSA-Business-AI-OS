/**
 * El próximo seguimiento del panel de la bandeja (F35, tramo C de S8).
 *
 * «En 3 días», «En 7 días» y «En 14 días» se cuentan desde HOY EN LA ZONA DEL
 * NEGOCIO, `workspaces.zona_horaria`: la misma que usan los filtros de la
 * bandeja para decidir «Vence hoy» (00044 y 00046, `(ahora at time zone
 * zona)::date`). Si el selector contara en otra zona, una conversación fijada
 * «En 3 días» podría no aparecer en el «Rango de fechas» de ese día.
 *
 * El cálculo lo hace el servidor (`PATCH /api/v1/contacts/[id]` con
 * `seguimiento_en_dias`): el navegador manda el número, nunca la fecha
 * calculada. «Otra fecha» y «Quitar» mandan `next_followup_date`.
 *
 * Sin React ni nada de servidor: lo usan la ruta y el panel.
 */
import { fechaSinHora } from "./ficha";
export const DIAS_DE_SEGUIMIENTO = [3, 7, 14] as const;
export type DiasDeSeguimiento = (typeof DIAS_DE_SEGUIMIENTO)[number];

export const esDiasDeSeguimiento = (v: unknown): v is DiasDeSeguimiento =>
  typeof v === "number" && (DIAS_DE_SEGUIMIENTO as readonly number[]).includes(v);

/** Hoy, como AAAA-MM-DD, en una zona IANA. Lanza si la zona no existe. */
export function hoyEnZona(ahora: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** Una fecha AAAA-MM-DD más N días del calendario, sin pasar por ninguna zona. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Hoy en la zona, más N días. */
export function fechaEnDias(ahora: Date, zona: string, dias: number): string {
  return sumarDias(hoyEnZona(ahora, zona), dias);
}

/** Lo que se eligió en el selector: un plazo, una fecha («Otra fecha»), o vacío («Quitar»). */
export type EleccionDeSeguimiento = { dias: DiasDeSeguimiento } | { fecha: string | null };
export type ResultadoDeSeguimiento = { ok: true; fecha: string | null } | { ok: false };

/**
 * Guarda el próximo seguimiento por `PATCH /api/v1/contacts/[id]`, la misma
 * ruta de «Editar datos» de la ficha: la seguridad por filas decide qué
 * contacto se puede tocar, y queda en el historial. Un plazo viaja como número
 * y lo cuenta el servidor. Solo es un guardado si la ruta devuelve la fecha
 * que quedó.
 *
 * Pensada para usarse también desde «Cerrar» del tramo D (al cerrar con el
 * seguimiento vencido o de hoy, se pide el próximo con el mismo selector).
 */
export async function guardarSeguimiento(contactoId: string, eleccion: EleccionDeSeguimiento): Promise<ResultadoDeSeguimiento> {
  const cuerpo = "dias" in eleccion ? { seguimiento_en_dias: eleccion.dias } : { next_followup_date: eleccion.fecha };
  try {
    const res = await fetch(`/api/v1/contacts/${encodeURIComponent(contactoId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const data = (await res.json().catch(() => null)) as { next_followup_date?: string | null } | null;
    if (!res.ok || !data || !("next_followup_date" in data)) return { ok: false };
    return { ok: true, fecha: data.next_followup_date ?? null };
  } catch {
    return { ok: false };
  }
}

/** El aviso breve después de guardar, como en el prototipo. */
export function avisoDeSeguimiento(fecha: string | null): string {
  return fecha ? `Próximo seguimiento: ${fechaSinHora(fecha)}` : "Seguimiento quitado";
}
export const AVISO_DE_FALLA = "No se pudo guardar el próximo seguimiento.";
