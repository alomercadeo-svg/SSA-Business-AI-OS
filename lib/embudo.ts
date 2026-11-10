/**
 * El Embudo (10/11/2026): pantalla fuera del plano, decidida por Marcos para
 * la entrega; criterios a escribir después. Solo lectura: no se arrastran
 * tarjetas ni se cambia la etapa (eso escribe y lleva historial de cambios).
 *
 * Sin React ni nada de servidor: lo usa `app/(dashboard)/dashboard/embudo`.
 */
import type { PipelineStage } from "./types/database";

/** Las etapas de `00030_contacto_estado_comercial.sql` (líneas 41 a 54), en su orden. Un test las compara con la migración. */
export const ETAPAS_DEL_EMBUDO: PipelineStage[] = [
  "1. Nuevo contacto",
  "2. Le escribí",
  "3. Respondió",
  "4. ¿Es mi cliente?",
  "5. Le ofrecí una cita",
  "6. Agendó",
  "7. Confirmó asistencia",
  "8. No llegó",
  "9. Reagendó",
  "11. Seguimiento intensivo",
  "12. En espera de pago",
  "13. ¡Cerrada!",
  "14. Repesca",
];

export type FiltroDeEmbudo = "todos" | "abierto" | "ganado" | "perdido";
const FILTROS: FiltroDeEmbudo[] = ["todos", "abierto", "ganado", "perdido"];

/** El filtro de la dirección (`?estado=`): Todos por defecto y ante cualquier valor desconocido. */
export function filtroDeEmbudo(v: string | string[] | undefined): FiltroDeEmbudo {
  const crudo = Array.isArray(v) ? v[0] : v;
  return FILTROS.includes(crudo as FiltroDeEmbudo) ? (crudo as FiltroDeEmbudo) : "todos";
}

export interface ContactoDelEmbudo {
  id: string;
  display_name: string | null;
  pipeline_stage: string;
  deal_status: string | null;
  deal_value: number | string | null;
  deal_currency: string | null;
  deal_closed_at: string | null;
}

export interface ColumnaDelEmbudo {
  etapa: string;
  contactos: ContactoDelEmbudo[];
  /** Una suma por moneda, nunca mezcladas; solo valores mayores que cero. */
  sumas: { moneda: string; total: number }[];
}

export const SIN_MONEDA = "Sin moneda";

export function armarEmbudo(contactos: ContactoDelEmbudo[], filtro: FiltroDeEmbudo) {
  const cantidades = { todos: contactos.length, abierto: 0, ganado: 0, perdido: 0 };
  for (const c of contactos) {
    if (c.deal_status === "abierto" || c.deal_status === "ganado" || c.deal_status === "perdido") cantidades[c.deal_status]++;
  }
  const visibles = filtro === "todos" ? contactos : contactos.filter((c) => c.deal_status === filtro);
  const columnas: ColumnaDelEmbudo[] = ETAPAS_DEL_EMBUDO.map((etapa) => {
    const deLaEtapa = visibles.filter((c) => c.pipeline_stage === etapa);
    const porMoneda = new Map<string, number>();
    for (const c of deLaEtapa) {
      const valor = Number(c.deal_value ?? 0);
      if (!(valor > 0)) continue;
      const moneda = c.deal_currency || SIN_MONEDA;
      porMoneda.set(moneda, (porMoneda.get(moneda) ?? 0) + valor);
    }
    const sumas = [...porMoneda].map(([moneda, total]) => ({ moneda, total: Math.round(total * 100) / 100 })).sort((a, b) => a.moneda.localeCompare(b.moneda));
    return { etapa, contactos: deLaEtapa, sumas };
  });
  return { vacio: contactos.length === 0, cantidades, columnas };
}
