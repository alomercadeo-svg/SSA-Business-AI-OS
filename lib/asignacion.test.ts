import { describe, expect, it } from "vitest";
import { cambiosDeAsignacion, filtroDeAsignacion, leerPedidoDeAsignacion, origenPermitido } from "./asignacion";

const UNO = "11111111-1111-4111-8111-111111111111";
const DOS = "22222222-2222-4222-8222-222222222222";

function cabeceras(h: Record<string, string>): Headers {
  return new Headers(h);
}

describe("origenPermitido: el PATCH solo se acepta desde la propia app", () => {
  const APP = "https://app.alomercadeo.com";

  it("acepta el origen de la app", () => {
    expect(origenPermitido(cabeceras({ origin: APP, host: "interno:8080" }), APP)).toBe(true);
  });

  it("acepta el origen que coincide con el host de la petición (desarrollo, otro dominio de la misma app)", () => {
    expect(origenPermitido(cabeceras({ origin: "http://localhost:3000", host: "localhost:3000" }), APP)).toBe(true);
    expect(
      origenPermitido(cabeceras({ origin: "https://otra.up.railway.app", host: "x", "x-forwarded-host": "otra.up.railway.app" }), APP),
    ).toBe(true);
  });

  it("rechaza otro sitio, aunque traiga la cookie", () => {
    expect(origenPermitido(cabeceras({ origin: "https://malicioso.example", host: "app.alomercadeo.com" }), APP)).toBe(false);
  });

  it("rechaza un subdominio hermano: SameSite=Lax no lo frena, porque es el mismo sitio", () => {
    expect(origenPermitido(cabeceras({ origin: "https://otro.alomercadeo.com", host: "app.alomercadeo.com" }), APP)).toBe(false);
  });

  it("rechaza sin Origin: un navegador siempre lo manda en un PATCH", () => {
    expect(origenPermitido(cabeceras({ host: "app.alomercadeo.com" }), APP)).toBe(false);
    expect(origenPermitido(cabeceras({ origin: "null", host: "app.alomercadeo.com" }), APP)).toBe(false);
  });
});

describe("leerPedidoDeAsignacion", () => {
  it("acepta setter, vendedor o los dos, con un id o null", () => {
    expect(leerPedidoDeAsignacion({ setter_id: UNO })).toEqual({ setter_id: UNO });
    expect(leerPedidoDeAsignacion({ vendedor_id: null })).toEqual({ vendedor_id: null });
    expect(leerPedidoDeAsignacion({ setter_id: UNO, vendedor_id: DOS })).toEqual({ setter_id: UNO, vendedor_id: DOS });
  });

  it("rechaza vacío, campos de más y valores que no son un id", () => {
    expect(leerPedidoDeAsignacion({})).toBeNull();
    expect(leerPedidoDeAsignacion(null)).toBeNull();
    expect(leerPedidoDeAsignacion([UNO])).toBeNull();
    expect(leerPedidoDeAsignacion({ setter_id: UNO, display_name: "x" })).toBeNull();
    expect(leerPedidoDeAsignacion({ setter_id: "ale" })).toBeNull();
    expect(leerPedidoDeAsignacion({ setter_id: 3 })).toBeNull();
  });
});

describe("cambiosDeAsignacion: solo lo que cambia, y los dos campos son independientes", () => {
  it("cambiar el setter no toca al vendedor", () => {
    expect(cambiosDeAsignacion({ setter_id: null, vendedor_id: DOS }, { setter_id: UNO })).toEqual({
      setter_id: { antes: null, despues: UNO },
    });
  });

  it("quitar una asignación es un cambio a null", () => {
    expect(cambiosDeAsignacion({ setter_id: UNO, vendedor_id: DOS }, { vendedor_id: null })).toEqual({
      vendedor_id: { antes: DOS, despues: null },
    });
  });

  it("pedir lo que ya está no es un cambio", () => {
    expect(cambiosDeAsignacion({ setter_id: UNO, vendedor_id: null }, { setter_id: UNO, vendedor_id: null })).toEqual({});
  });
});

describe("filtroDeAsignacion: lo que viene en la dirección", () => {
  it("un id es una persona, «sin» es sin asignar, lo demás es todos", () => {
    expect(filtroDeAsignacion(UNO)).toEqual({ tipo: "persona", id: UNO });
    expect(filtroDeAsignacion("sin")).toEqual({ tipo: "sin" });
    expect(filtroDeAsignacion([UNO, DOS])).toEqual({ tipo: "persona", id: UNO });
    expect(filtroDeAsignacion(undefined)).toEqual({ tipo: "todos" });
    expect(filtroDeAsignacion("'; drop table contacts")).toEqual({ tipo: "todos" });
  });
});
