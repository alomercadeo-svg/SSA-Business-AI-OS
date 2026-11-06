import { describe, it, expect, vi } from "vitest";
import { conectarVisor } from "./visor-foto";

/**
 * F44, criterio 4: la foto a pantalla completa se cierra con «X», con Escape y
 * con el gesto de volver del teléfono. El gesto de volver es un `popstate`:
 * al abrir se suma una entrada al historial, y volver la saca y cierra el
 * visor. «X» y Escape hacen lo mismo que volver, para no dejar la entrada.
 */
function ventanaFalsa() {
  const eventos = new EventTarget();
  const history = { pushState: vi.fn(), back: vi.fn(() => eventos.dispatchEvent(new Event("popstate"))) };
  return {
    history,
    addEventListener: eventos.addEventListener.bind(eventos),
    removeEventListener: eventos.removeEventListener.bind(eventos),
    disparar: (e: Event) => eventos.dispatchEvent(e),
  };
}

function tecla(key: string) {
  const e = new Event("keydown") as Event & { key: string };
  e.key = key;
  return e;
}

describe("el visor de fotos (F44)", () => {
  it("al abrir suma una entrada al historial, una sola", () => {
    const w = ventanaFalsa();
    conectarVisor(w, vi.fn());
    expect(w.history.pushState).toHaveBeenCalledTimes(1);
  });

  it("el gesto de volver (popstate) lo cierra", () => {
    const w = ventanaFalsa();
    const cerrar = vi.fn();
    conectarVisor(w, cerrar);
    w.disparar(new Event("popstate"));
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("«X» vuelve en el historial, y eso lo cierra", () => {
    const w = ventanaFalsa();
    const cerrar = vi.fn();
    conectarVisor(w, cerrar).cerrar();
    expect(w.history.back).toHaveBeenCalledTimes(1);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("Escape lo cierra igual que «X»; otra tecla no", () => {
    const w = ventanaFalsa();
    const cerrar = vi.fn();
    conectarVisor(w, cerrar);
    w.disparar(tecla("Enter"));
    expect(cerrar).not.toHaveBeenCalled();
    w.disparar(tecla("Escape"));
    expect(w.history.back).toHaveBeenCalledTimes(1);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("desconectado, ya no escucha", () => {
    const w = ventanaFalsa();
    const cerrar = vi.fn();
    conectarVisor(w, cerrar).desconectar();
    w.disparar(new Event("popstate"));
    w.disparar(tecla("Escape"));
    expect(cerrar).not.toHaveBeenCalled();
  });
});

/**
 * El error de las 18:50 del 05/11/2026: en la foto de WhatsApp, «X» llevaba a
 * otra conversación. El clic de «X» llamaba a cerrar dos veces (el botón y el
 * fondo), y el navegador volvía atrás dos veces, fuera de la bandeja. En el
 * navegador real el `popstate` llega después, no en el mismo instante: esta
 * ventana falsa lo guarda para dispararlo cuando el test quiere.
 */
function ventanaConPopstateDemorado() {
  const eventos = new EventTarget();
  let pendientes = 0;
  const history = { pushState: vi.fn(), back: vi.fn(() => { pendientes += 1; }) };
  return {
    history,
    addEventListener: eventos.addEventListener.bind(eventos),
    removeEventListener: eventos.removeEventListener.bind(eventos),
    disparar: (e: Event) => eventos.dispatchEvent(e),
    llegaElPopstate: () => {
      while (pendientes > 0) {
        pendientes -= 1;
        eventos.dispatchEvent(new Event("popstate"));
      }
    },
  };
}

describe("el visor vuelve atrás una sola vez (el error de la «X», 05/11/2026)", () => {
  it("cerrar dos veces antes de que llegue el popstate vuelve atrás una sola vez", () => {
    const w = ventanaConPopstateDemorado();
    const cerrar = vi.fn();
    const c = conectarVisor(w, cerrar);
    c.cerrar();
    c.cerrar();
    expect(w.history.back).toHaveBeenCalledTimes(1);
    w.llegaElPopstate();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("Escape y después «X», antes del popstate: una sola vuelta", () => {
    const w = ventanaConPopstateDemorado();
    const c = conectarVisor(w, vi.fn());
    w.disparar(tecla("Escape"));
    c.cerrar();
    expect(w.history.back).toHaveBeenCalledTimes(1);
  });

  it("cerrado con el gesto de volver, un «X» tardío no vuelve atrás", () => {
    const w = ventanaConPopstateDemorado();
    const c = conectarVisor(w, vi.fn());
    w.disparar(new Event("popstate"));
    c.cerrar();
    expect(w.history.back).not.toHaveBeenCalled();
  });
});
