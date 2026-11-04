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
