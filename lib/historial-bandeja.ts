/**
 * F35, criterio del teléfono, decidido en la revisión del 06/11/2026: en el
 * ancho del teléfono, abrir una conversación suma una entrada al historial, y
 * volver (el gesto, el botón del navegador o «← Conversaciones») lleva a la
 * lista y no fuera de la bandeja. En la computadora la bandeja sigue sin sumar
 * entradas (`replaceState`).
 *
 * La entrada lleva la marca `MARCA_HILO`. Next.js 16.1.6 parcha `pushState` y
 * le copia a la entrada su estado interno (`__NA` y el árbol), así que volver a
 * la entrada anterior la dibuja Next con el árbol guardado, sin recargar
 * (verificado en `node_modules/next/dist/client/components/app-router.js`,
 * `copyNextJsInternalHistoryState` y `onPopState`). La marca no la copia: la
 * entrada del visor de foto (`lib/visor-foto.ts`) no la tiene, y por eso
 * cerrar el visor vuelve a la entrada del hilo, que sí la tiene, y el hilo
 * sigue abierto.
 *
 * Nunca vuelve atrás dos veces por un mismo pedido: es el error de la «X» del
 * 05/11/2026, que sacaba al usuario de la bandeja.
 */
export const MARCA_HILO = "bandejaHilo";

export interface VentanaDeLaBandeja {
  history: {
    readonly state: unknown;
    pushState(datos: unknown, titulo: string, url?: string): void;
    replaceState(datos: unknown, titulo: string, url?: string): void;
    back(): void;
  };
  addEventListener(tipo: string, fn: (e: Event) => void): void;
  removeEventListener(tipo: string, fn: (e: Event) => void): void;
}

export function conectarHiloEnTelefono(w: VentanaDeLaBandeja, alVolverALaLista: () => void) {
  const enElHilo = () => {
    const s = w.history.state;
    return !!s && typeof s === "object" && (s as Record<string, unknown>)[MARCA_HILO] === true;
  };
  let volviendo = false;
  const alPopstate = () => {
    volviendo = false;
    if (!enElHilo()) alVolverALaLista();
  };
  w.addEventListener("popstate", alPopstate);
  return {
    /** Abre una conversación: suma una entrada, o reemplaza si ya estaba en un hilo. */
    abrir(url: string) {
      if (enElHilo()) w.history.replaceState({ [MARCA_HILO]: true }, "", url);
      else w.history.pushState({ [MARCA_HILO]: true }, "", url);
    },
    /** «← Conversaciones»: vuelve atrás una sola vez; sin entrada propia, va directo a la lista. */
    volver() {
      if (!enElHilo()) {
        alVolverALaLista();
        return;
      }
      if (volviendo) return;
      volviendo = true;
      w.history.back();
    },
    desconectar() {
      w.removeEventListener("popstate", alPopstate);
    },
  };
}

/** El ancho del teléfono: por debajo de `md` (768 px) de Tailwind 4. */
export function esAnchoDeTelefono(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767.98px)").matches;
}
