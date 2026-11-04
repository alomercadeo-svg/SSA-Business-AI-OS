import { describe, it, expect } from "vitest";
import { SIN_FILTROS, pedidoDeUna, queHacerConElAviso } from "./filtros-bandeja";

/**
 * Realtime con filtros (F35, tramo B). Sin filtros queda exactamente como en
 * el tramo A: la que no estaba cargada se pide sola; la cargada se fusiona, o
 * sale si cambió de pestaña. Con filtros, también la cargada se vuelve a
 * pedir, con los mismos filtros: un mensaje nuevo puede hacer que deje de
 * cumplirlos (por ejemplo, «Fecha del último mensaje»), y si no vuelve, sale.
 */

const conFiltro = { ...SIN_FILTROS, canal: ["whatsapp" as const] };

describe("queHacerConElAviso", () => {
  it("sin filtros, como en el tramo A", () => {
    expect(queHacerConElAviso({ cargada: false, esDeOtraPestana: false, filtros: SIN_FILTROS })).toBe("pedir");
    expect(queHacerConElAviso({ cargada: true, esDeOtraPestana: false, filtros: SIN_FILTROS })).toBe("fusionar");
    expect(queHacerConElAviso({ cargada: true, esDeOtraPestana: true, filtros: SIN_FILTROS })).toBe("sacar");
  });

  it("con filtros, la cargada se vuelve a pedir con los filtros", () => {
    expect(queHacerConElAviso({ cargada: true, esDeOtraPestana: false, filtros: conFiltro })).toBe("pedir");
  });

  it("con filtros, la que no estaba cargada se pide (y aparece solo si los cumple)", () => {
    expect(queHacerConElAviso({ cargada: false, esDeOtraPestana: false, filtros: conFiltro })).toBe("pedir");
  });

  it("con filtros, la que cambió de pestaña sale igual", () => {
    expect(queHacerConElAviso({ cargada: true, esDeOtraPestana: true, filtros: conFiltro })).toBe("sacar");
  });
});

describe("pedidoDeUna", () => {
  it("lleva la pestaña, lo buscado, los filtros y el id", () => {
    const url = new URL(`http://x${pedidoDeUna("open", "ana lopez", { ...SIN_FILTROS, canal: ["whatsapp"], seguimiento: "hoy" }, "c7")}`);
    expect(url.pathname).toBe("/api/v1/conversations");
    expect(Object.fromEntries(url.searchParams)).toEqual({ estado: "open", q: "ana lopez", canal: "whatsapp", seguimiento: "hoy", id: "c7" });
  });

  it("sin filtros, solo pestaña, búsqueda e id", () => {
    const url = new URL(`http://x${pedidoDeUna("all", "", SIN_FILTROS, "c7")}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ estado: "all", q: "", id: "c7" });
  });
});
