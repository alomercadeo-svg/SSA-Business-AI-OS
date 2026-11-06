/**
 * F35, criterio del teléfono (agregado el 05/11/2026, aprobado tal cual el
 * 06/11): las tres columnas de la bandeja según el ancho. Por debajo de `md`
 * (768 px) se ve una sola columna por vez: la lista, o el hilo de la
 * conversación abierta; el panel del contacto se abre encima, a pantalla
 * completa. Desde `md` en adelante, las tres como siempre.
 *
 * Son clases y no un cálculo del ancho en JavaScript: el servidor dibuja la
 * página sin saber el ancho, y con clases no hay salto al cargar.
 */
import { cn } from "@/lib/utils";

/** La lista. En el teléfono, a todo el ancho y oculta con un hilo abierto. */
export function clasesDeLaLista(hayHilo: boolean): string {
  return cn("min-h-0 w-full md:block md:w-80 md:flex-shrink-0", hayHilo ? "hidden" : "block");
}

/**
 * El hilo. `min-w-0`: un nombre largo no ensancha la columna (S8, tramo 9). En
 * el teléfono se ve solo con una conversación abierta.
 */
export function clasesDelHilo(hayHilo: boolean): string {
  return cn("min-h-0 min-w-0 flex-1 flex-col md:flex", hayHilo ? "flex" : "hidden");
}

/**
 * El panel del contacto. `enCompu`: el botón de mostrarlo en la computadora
 * (abierto por defecto). `enTelefono`: abierto en el teléfono (cerrado por
 * defecto), encima del hilo y a pantalla completa.
 */
export function clasesDelPanel({ enCompu, enTelefono }: { enCompu: boolean; enTelefono: boolean }): string {
  return cn(
    enTelefono ? "fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto" : "hidden",
    enCompu ? "md:flex" : "md:hidden",
  );
}
