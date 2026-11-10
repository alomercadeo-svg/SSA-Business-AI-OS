import { describe, it, expect, vi } from "vitest";
import { crearAvisoDeReconexion } from "./reconexion-realtime";

describe("B del 09/11: volver a pedir la lista cuando Realtime se reconecta", () => {
  it("la primera suscripción no pide nada (la lista ya vino con la página)", () => {
    const pedir = vi.fn();
    const aviso = crearAvisoDeReconexion(pedir);
    aviso("SUBSCRIBED");
    expect(pedir).not.toHaveBeenCalled();
  });

  it("suscripta, cortada y suscripta de nuevo: pide una vez", () => {
    const pedir = vi.fn();
    const aviso = crearAvisoDeReconexion(pedir);
    aviso("SUBSCRIBED");
    aviso("CLOSED");
    aviso("SUBSCRIBED");
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("error y tiempo agotado también cuentan como corte", () => {
    for (const corte of ["CHANNEL_ERROR", "TIMED_OUT"]) {
      const pedir = vi.fn();
      const aviso = crearAvisoDeReconexion(pedir);
      aviso("SUBSCRIBED");
      aviso(corte);
      aviso("SUBSCRIBED");
      expect(pedir, corte).toHaveBeenCalledTimes(1);
    }
  });

  it("varios cortes seguidos antes de volver: un solo pedido", () => {
    const pedir = vi.fn();
    const aviso = crearAvisoDeReconexion(pedir);
    aviso("SUBSCRIBED");
    aviso("TIMED_OUT");
    aviso("CHANNEL_ERROR");
    aviso("SUBSCRIBED");
    aviso("SUBSCRIBED");
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});
