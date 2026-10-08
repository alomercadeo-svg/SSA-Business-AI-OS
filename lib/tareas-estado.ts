/**
 * La prueba de vida de las tareas periódicas (§14, «Vigilancia por ausencia»),
 * leída de `tareas_estado` (00032).
 *
 * La marca que se MUESTRA es `ultimo_ok_at`, la de la última corrida que
 * terminó bien. `ultima_ejecucion_at` la escribe `reservar_tarea` al tomar la
 * tarea, antes de hacer nada, así que también se mueve en una corrida que
 * después falla: mostrarla haría que una vigilancia rota se viera viva.
 */

/** Pasados estos minutos sin una corrida buena, la marca se muestra en rojo. */
export const MINUTOS_PARA_VENCER = 30;

export interface FilaDeTarea {
  ultima_ejecucion_at?: string | null;
  ultimo_ok_at?: string | null;
}

export function marcaVisible(fila: FilaDeTarea | null | undefined): string | null {
  return fila?.ultimo_ok_at ?? null;
}

export function marcaVencida(fila: FilaDeTarea | null | undefined, ahora: Date = new Date()): boolean {
  const marca = marcaVisible(fila);
  if (!marca) return true;
  return ahora.getTime() - new Date(marca).getTime() > MINUTOS_PARA_VENCER * 60_000;
}
