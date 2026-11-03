/**
 * El hilo con los mensajes anteriores a los últimos 200 (F35, tramo A de S8).
 *
 * El hilo trae los últimos 200 y, con «Ver mensajes anteriores», los 200 de
 * antes, hasta el primero guardado. El orden es el de la base al revés: hora
 * del más viejo al más nuevo, y el id para desempatar (el historial importado
 * tiene mensajes con la misma hora).
 *
 * Lo usa el hilo, que es `"use client"`: no importa nada de servidor.
 */

type DelHilo = { id: string; created_at: string };

const esOptimista = (m: DelHilo) => m.id.startsWith("optimistic-");

/** Del más viejo al más nuevo, como la base al revés. */
export function compararDelHilo(a: DelHilo, b: DelHilo): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/** Los anteriores, arriba, sin repetir los que ya estaban. */
export function sumarAnteriores<T extends DelHilo>(actuales: T[], anteriores: T[]): T[] {
  const ya = new Set(actuales.map((m) => m.id));
  return [...anteriores.filter((m) => !ya.has(m.id)).sort(compararDelHilo), ...actuales];
}

/**
 * El refresco de Realtime trae otra vez los últimos 200. Se conservan los
 * anteriores ya cargados (los más viejos que el primero de los frescos) y los
 * optimistas que todavía no confirmó el servidor.
 */
export function refrescarHilo<T extends DelHilo>(actuales: T[], frescos: T[]): T[] {
  const optimistas = actuales.filter(esOptimista);
  if (frescos.length === 0) return [...actuales.filter((m) => !esOptimista(m)), ...optimistas];
  const primero = frescos[0];
  const ids = new Set(frescos.map((m) => m.id));
  const anteriores = actuales.filter((m) => !esOptimista(m) && !ids.has(m.id) && compararDelHilo(m, primero) < 0);
  return [...anteriores, ...frescos, ...optimistas];
}
