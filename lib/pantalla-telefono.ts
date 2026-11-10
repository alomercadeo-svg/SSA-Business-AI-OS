/**
 * Retrabajo del ítem 4 del plan maestro (06/11/2026), lo que vio Marcos en el
 * iPhone. Dos cálculos puros; los componentes que los usan son
 * `components/marco-de-la-app.tsx` y `components/inbox/message-thread.tsx`.
 */

/** Lo que importa de `window.visualViewport`. */
export interface VistaVisible {
  height: number;
  offsetTop: number;
  scale: number;
}

/**
 * Punto c: con el teclado abierto, Safari en iPhone achica la parte visible
 * de la página y la corre hacia arriba, sin achicar la página; un marco de
 * `h-dvh` queda más alto que lo que se ve y el encabezado sale de la vista.
 * Esto devuelve el alto visible y lo corrido, para que el marco de la app
 * cubra justo lo que se ve.
 *
 * Con la página agrandada a mano (`scale` distinto de 1) no se toca nada: el
 * agrandado es de la persona (accesibilidad), y seguirlo achicaría la página
 * bajo sus dedos. Sin `visualViewport`, tampoco.
 *
 * Que Safari se comporte así es lo que describe la especificación de
 * `visualViewport` (alto y corrimiento de la parte visible); que el teclado
 * lo dispare en iPhone **no está verificado en documentación de Apple**: lo
 * prueba Marcos en el teléfono.
 */
export function ajusteAlTeclado(v: VistaVisible | null | undefined): { alto: number; arriba: number } | null {
  if (!v) return null;
  if (!(v.height > 0) || !Number.isFinite(v.height)) return null;
  if (Math.abs(v.scale - 1) > 0.01) return null;
  return { alto: v.height, arriba: Math.max(0, v.offsetTop || 0) };
}

/**
 * A del 09/11/2026: cuánto vale un gesto de la persona (tocar, la rueda, el
 * teclado, el puntero) para que un desplazamiento cuente como suyo. Cada
 * desplazamiento dentro de esa ventana la estira, así la inercia del dedo
 * sigue contando.
 */
export const VENTANA_DEL_GESTO_MS = 1000;

/**
 * A del 09/11/2026: «pegado al final» cambia solo por un desplazamiento de la
 * persona. Uno que dispara el navegador (al crecer el hilo, o el que sigue a
 * un `scrollTop` puesto por el código) no lo cambia: en el WebKit de
 * Playwright, uno así llegó a 319 px del final antes de que el observador de
 * tamaño bajara el hilo, y lo dejó despegado (`verify-hilo-telefono`).
 */
export function pegadoTrasDesplazar(p: { pegado: boolean; alFinal: boolean; msDesdeElGesto: number }): {
  pegado: boolean;
  deLaPersona: boolean;
} {
  if (!(p.msDesdeElGesto <= VENTANA_DEL_GESTO_MS)) return { pegado: p.pegado, deLaPersona: false };
  return { pegado: p.alFinal, deLaPersona: true };
}

/** Punto b: si el hilo está pegado al último mensaje (a menos de `margen` px). */
export function estaAlFinal(m: { scrollTop: number; scrollHeight: number; clientHeight: number }, margen = 80): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= margen;
}

/**
 * Segundo retrabajo del ítem 4 (06/11/2026), punto b: volver del panel del
 * contacto deja el chat donde estaba. Se guarda al abrir el panel como
 * «pegado al final» o «a tantos px del final» (no como `scrollTop`: si llegó
 * un mensaje mientras tanto, el final se movió), y se repone al volver.
 */
export interface LugarDelHilo {
  pegado: boolean;
  desdeElFinal: number;
}

export function lugarDelHilo(m: { scrollTop: number; scrollHeight: number; clientHeight: number }): LugarDelHilo {
  return { pegado: estaAlFinal(m), desdeElFinal: Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop) };
}

export function scrollParaVolver(l: LugarDelHilo, m: { scrollHeight: number; clientHeight: number }): number {
  const final = Math.max(0, m.scrollHeight - m.clientHeight);
  return l.pegado ? final : Math.max(0, final - l.desdeElFinal);
}
