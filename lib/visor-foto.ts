/**
 * F44, criterio 4: la foto del hilo a pantalla completa, y cómo se cierra.
 *
 * El gesto de volver del teléfono (y el botón «atrás» del navegador) es un
 * `popstate`. Por eso, al abrir, se suma una entrada al historial con
 * `pushState`, y volver la saca y cierra el visor. «X» y Escape no cierran
 * directo: vuelven en el historial, así la entrada no queda colgada y el
 * siguiente «atrás» no se gasta en nada.
 *
 * Ojo: en desarrollo, React monta dos veces los efectos y suma dos entradas;
 * en producción, una.
 */
export interface VentanaDelVisor {
  history: { pushState(datos: unknown, titulo: string): void; back(): void };
  addEventListener(tipo: string, fn: (e: Event) => void): void;
  removeEventListener(tipo: string, fn: (e: Event) => void): void;
}

export function conectarVisor(w: VentanaDelVisor, alCerrar: () => void): { cerrar(): void; desconectar(): void } {
  const alVolver = () => alCerrar();
  const alTeclear = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") w.history.back();
  };
  w.history.pushState({ visorDeFoto: true }, "");
  w.addEventListener("popstate", alVolver);
  w.addEventListener("keydown", alTeclear);
  return {
    cerrar: () => w.history.back(),
    desconectar: () => {
      w.removeEventListener("popstate", alVolver);
      w.removeEventListener("keydown", alTeclear);
    },
  };
}
