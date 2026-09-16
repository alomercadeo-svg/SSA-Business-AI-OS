import { describe, it, expect } from "vitest";
import { destinoSeguro, DESTINO_POR_DEFECTO } from "./next-param";

/**
 * El parámetro `next` decide a dónde va el usuario después de autenticarse, y
 * sale de la URL: lo controla quien arma el link. Si se cuela un destino
 * externo, la pantalla de login queda como redirector abierto y sirve para un
 * phishing creíble, porque el usuario ve el dominio real hasta el último paso.
 *
 * Los destinos externos de acá abajo salieron de probar `new URL(valor, origin)`
 * en el navegador: cada uno de los que se rechazan resuelve a un host externo
 * de verdad, no son hipótesis.
 *
 * Los caracteres de control se arman con `String.fromCharCode` en vez de
 * escribirlos escapados: un fuente con controles adentro deja de ser legible y
 * las herramientas empiezan a tratarlo como binario.
 */
const ctrl = (codigo: number) => String.fromCharCode(codigo);

describe("destinoSeguro", () => {
  it("deja pasar una ruta interna", () => {
    expect(destinoSeguro("/dashboard")).toBe("/dashboard");
    expect(destinoSeguro("/invite/abc-123")).toBe("/invite/abc-123");
    expect(destinoSeguro("/dashboard/settings?tab=team")).toBe(
      "/dashboard/settings?tab=team"
    );
  });

  it("cae al destino por defecto cuando no hay parámetro", () => {
    expect(destinoSeguro(null)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(undefined)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("")).toBe(DESTINO_POR_DEFECTO);
  });

  it("rechaza una URL absoluta", () => {
    expect(destinoSeguro("https://malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("http://malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("javascript:alert(1)")).toBe(DESTINO_POR_DEFECTO);
  });

  it("rechaza una URL relativa al protocolo", () => {
    // Empieza con barra, así que un filtro que solo pide "que empiece con /" la
    // deja pasar. El navegador la resuelve como http://malo.com/.
    expect(destinoSeguro("//malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("//malo.com/algo?a=1")).toBe(DESTINO_POR_DEFECTO);
  });

  it("rechaza el disfraz con barra invertida", () => {
    // El bypass que sobrevive a las dos reglas anteriores: una sola barra al
    // principio, pero el navegador normaliza la barra invertida a barra y
    // termina resolviendo http://malo.com/.
    expect(destinoSeguro("/\\malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("/\\/malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("/algo/\\malo.com")).toBe(DESTINO_POR_DEFECTO);
  });

  it("rechaza caracteres de control, que el navegador descarta de la URL", () => {
    // Sirven para partir un `//` en dos y esquivar la regla anterior.
    expect(destinoSeguro(`/${ctrl(9)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(10)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(13)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(0)}malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(0x85)}malo.com`)).toBe(DESTINO_POR_DEFECTO);
  });
});
