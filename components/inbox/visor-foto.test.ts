import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { VisorDeFoto } from "./visor-foto";

/**
 * F44, criterio 4, el error de las 18:50 del 05/11/2026: «X» está dentro del
 * fondo del visor, y los dos cierran al tocarlos. Sin cortar la propagación,
 * un toque en «X» cerraba dos veces. Se prueba sobre el árbol que devuelve el
 * componente, llamando a los `onClick` como lo haría React al subir el evento:
 * primero el del botón y, si no cortó la propagación, el del fondo.
 */
type Props = { onClick?: (e: { stopPropagation(): void }) => void; children?: unknown; "aria-label"?: string };

function hijos(el: ReactElement<Props>): ReactElement<Props>[] {
  const c = el.props.children;
  return (Array.isArray(c) ? c : [c]).filter((x): x is ReactElement<Props> => isValidElement(x));
}

function tocar(fondo: ReactElement<Props>, objetivo: ReactElement<Props>) {
  let cortada = false;
  const evento = { stopPropagation: () => { cortada = true; } };
  objetivo.props.onClick?.(evento);
  if (!cortada && objetivo !== fondo) fondo.props.onClick?.(evento);
}

describe("el botón «X» del visor (F44)", () => {
  it("tocar «X» cierra una sola vez: no sube al fondo", () => {
    const onCerrar = vi.fn();
    const fondo = VisorDeFoto({ url: "https://x/y.jpg", onCerrar }) as ReactElement<Props>;
    const x = hijos(fondo).find((h) => h.props["aria-label"] === "Cerrar")!;
    expect(x).toBeTruthy();
    tocar(fondo, x);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("control: tocar el fondo, fuera de la foto, también cierra, una vez", () => {
    const onCerrar = vi.fn();
    const fondo = VisorDeFoto({ url: "https://x/y.jpg", onCerrar }) as ReactElement<Props>;
    tocar(fondo, fondo);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
