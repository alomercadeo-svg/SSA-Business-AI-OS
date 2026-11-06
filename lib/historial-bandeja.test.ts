import { describe, it, expect, vi } from "vitest";
import { conectarHiloEnTelefono, MARCA_HILO } from "./historial-bandeja";

/**
 * F35, criterio del teléfono, decidido en la revisión del 06/11/2026: abrir una
 * conversación en el ancho del teléfono suma una entrada al historial, y
 * volver (gesto, botón del navegador o «← Conversaciones») lleva a la lista,
 * no fuera de la bandeja. Nunca atrás dos veces (el error de la «X» del
 * 05/11), y el visor de foto encima de un chat abierto sigue cerrando bien.
 *
 * Como en el navegador, el `popstate` llega después y no en el mismo instante.
 */
function ventana(estadoInicial: unknown = null) {
  const eventos = new EventTarget();
  const pila: unknown[] = [estadoInicial];
  let pendientes = 0;
  const history = {
    get state() { return pila[pila.length - 1]; },
    pushState: vi.fn((d: unknown) => { pila.push(d); }),
    replaceState: vi.fn((d: unknown) => { pila[pila.length - 1] = d; }),
    back: vi.fn(() => { pendientes += 1; }),
  };
  return {
    history,
    addEventListener: eventos.addEventListener.bind(eventos),
    removeEventListener: eventos.removeEventListener.bind(eventos),
    llegaElPopstate() {
      while (pendientes > 0) {
        pendientes -= 1;
        if (pila.length > 1) pila.pop();
        eventos.dispatchEvent(new Event("popstate"));
      }
    },
    /** Lo que hace el visor de foto (`lib/visor-foto.ts`): suma su propia entrada. */
    abreElVisor() { pila.push({ visorDeFoto: true }); },
  };
}

describe("el hilo en el teléfono y el historial (F35)", () => {
  it("abrir una conversación suma una entrada con la marca, una sola", () => {
    const w = ventana();
    conectarHiloEnTelefono(w, vi.fn()).abrir("/dashboard/inbox?conversacion=a");
    expect(w.history.pushState).toHaveBeenCalledTimes(1);
    expect((w.history.state as Record<string, unknown>)[MARCA_HILO]).toBe(true);
  });

  it("abrir otra estando ya en un hilo reemplaza la entrada, no suma otra", () => {
    const w = ventana();
    const h = conectarHiloEnTelefono(w, vi.fn());
    h.abrir("/dashboard/inbox?conversacion=a");
    h.abrir("/dashboard/inbox?conversacion=b");
    expect(w.history.pushState).toHaveBeenCalledTimes(1);
    expect(w.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it("«← Conversaciones» vuelve atrás una sola vez aunque se toque dos veces, y eso lleva a la lista", () => {
    const w = ventana();
    const alLista = vi.fn();
    const h = conectarHiloEnTelefono(w, alLista);
    h.abrir("/dashboard/inbox?conversacion=a");
    h.volver();
    h.volver();
    expect(w.history.back).toHaveBeenCalledTimes(1);
    w.llegaElPopstate();
    expect(alLista).toHaveBeenCalledTimes(1);
  });

  it("el gesto de volver desde el hilo lleva a la lista", () => {
    const w = ventana();
    const alLista = vi.fn();
    const h = conectarHiloEnTelefono(w, alLista);
    h.abrir("/dashboard/inbox?conversacion=a");
    w.history.back();
    w.llegaElPopstate();
    expect(alLista).toHaveBeenCalledTimes(1);
  });

  it("cerrar el visor de foto encima del chat no cierra el chat", () => {
    const w = ventana();
    const alLista = vi.fn();
    const h = conectarHiloEnTelefono(w, alLista);
    h.abrir("/dashboard/inbox?conversacion=a");
    w.abreElVisor();
    w.history.back();
    w.llegaElPopstate();
    expect(alLista).not.toHaveBeenCalled();
  });

  it("si el hilo no sumó entrada (vino de la ficha), «← Conversaciones» va a la lista sin volver atrás", () => {
    const w = ventana();
    const alLista = vi.fn();
    conectarHiloEnTelefono(w, alLista).volver();
    expect(w.history.back).not.toHaveBeenCalled();
    expect(alLista).toHaveBeenCalledTimes(1);
  });

  it("desconectado, ya no escucha", () => {
    const w = ventana();
    const alLista = vi.fn();
    const h = conectarHiloEnTelefono(w, alLista);
    h.abrir("/dashboard/inbox?conversacion=a");
    h.desconectar();
    w.history.back();
    w.llegaElPopstate();
    expect(alLista).not.toHaveBeenCalled();
  });
});
