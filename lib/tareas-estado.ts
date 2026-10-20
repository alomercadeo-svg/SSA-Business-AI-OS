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

export function marcaVencida(
  fila: FilaDeTarea | null | undefined,
  ahora: Date = new Date(),
  minutosParaVencer: number = MINUTOS_PARA_VENCER,
): boolean {
  const marca = marcaVisible(fila);
  if (!marca) return true;
  return ahora.getTime() - new Date(marca).getTime() > minutosParaVencer * 60_000;
}

/**
 * F30. La purga corre una vez por día, así que su marca no puede vencer a los
 * 30 minutos: se pone en rojo a las 25 horas, una hora de margen sobre las 24
 * entre corridas (`HORAS_ENTRE_PURGAS`, `lib/purga.ts`).
 */
export const HORAS_PARA_VENCER_LA_PURGA = 25;

/** «hace 12 min», «hace 3 h», «hace 3 días». Una marca futura cuenta como recién. */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const minutos = Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return "hace menos de 1 min";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}

/**
 * La marca visible del reintento de adjuntos de F28 (fila `reintento_adjuntos`,
 * sin espacio), con la misma regla que la vigilancia: manda `ultimo_ok_at`, y
 * en rojo a los `MINUTOS_PARA_VENCER`. Si el reintento deja de correr, los
 * adjuntos fallidos quedan `fallido` y nadie se entera: esto es lo que lo hace
 * visible (§14, «Vigilancia por ausencia»).
 */
export function textoDelReintento(
  fila: (FilaDeTarea & { ultimo_error?: string | null }) | null | undefined,
  ahora: Date = new Date(),
): { titulo: string; vencida: boolean; error: string | null } {
  const marca = marcaVisible(fila);
  const vencida = marcaVencida(fila, ahora);
  return {
    titulo: marca
      ? `Último reintento de archivos adjuntos: ${haceCuanto(marca, ahora)}`
      : "El reintento de archivos adjuntos todavía no corrió nunca.",
    vencida,
    error: vencida ? (fila?.ultimo_error ?? null) : null,
  };
}

/**
 * F30. La marca visible de la purga diaria (fila `purga_eliminados:<espacio>`).
 * Si la purga deja de correr, lo eliminado no se borra nunca y los archivos se
 * acumulan, sin que nadie lo vea: esto lo hace visible (§14).
 */
export function textoDeLaPurga(
  fila: (FilaDeTarea & { ultimo_error?: string | null }) | null | undefined,
  ahora: Date = new Date(),
): { titulo: string; vencida: boolean; error: string | null } {
  const marca = marcaVisible(fila);
  const vencida = marcaVencida(fila, ahora, HORAS_PARA_VENCER_LA_PURGA * 60);
  return {
    titulo: marca
      ? `Última purga de eliminados: ${haceCuanto(marca, ahora)}`
      : "La purga de eliminados todavía no corrió nunca.",
    vencida,
    error: vencida ? (fila?.ultimo_error ?? null) : null,
  };
}
