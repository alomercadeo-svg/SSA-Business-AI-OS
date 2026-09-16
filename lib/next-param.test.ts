import { describe, it, expect } from "vitest";
import { destinoSeguro, DESTINO_POR_DEFECTO } from "./next-param";

/**
 * El parámetro `next` decide a dónde va el usuario después de autenticarse, y
 * sale de la URL: lo controla quien arma el link. Si se cuela un destino
 * externo, la pantalla de login queda como redirector abierto y sirve para un
 * phishing creíble, porque el usuario ve el dominio real hasta el último paso.
 *
 * Cada caso de acá abajo se verificó con `new URL(valor, origen)` en el
 * navegador: los que se rechazan resuelven a un host externo de verdad, no son
 * hipótesis. Y es el mismo parseo que hace la implementación, que es el punto:
 * la regla no es una lista de trucos prohibidos, es "que el origen no cambie".
 *
 * Los caracteres de control se arman con `String.fromCharCode` en vez de
 * escribirlos escapados: un fuente con controles adentro deja de ser legible y
 * git lo marca como binario, con lo que el diff desaparece de la revisión.
 */
const ctrl = (codigo: number) => String.fromCharCode(codigo);

describe("destinoSeguro", () => {
  it("deja pasar una ruta interna", () => {
    expect(destinoSeguro("/dashboard")).toBe("/dashboard");
    expect(destinoSeguro("/invite/abc-123")).toBe("/invite/abc-123");
  });

  it("conserva el query string y el fragmento", () => {
    expect(destinoSeguro("/dashboard/settings?tab=team")).toBe(
      "/dashboard/settings?tab=team"
    );
    expect(destinoSeguro("/dashboard/settings?tab=team&x=1")).toBe(
      "/dashboard/settings?tab=team&x=1"
    );
    expect(destinoSeguro("/dashboard/settings#seccion")).toBe(
      "/dashboard/settings#seccion"
    );
    expect(destinoSeguro("/dashboard/settings?tab=team#seccion")).toBe(
      "/dashboard/settings?tab=team#seccion"
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
    // El bypass que sobrevivía a las dos reglas anteriores: una sola barra al
    // principio, pero el navegador normaliza la barra invertida a barra y
    // termina resolviendo http://malo.com/.
    expect(destinoSeguro("/\\malo.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("/\\/malo.com")).toBe(DESTINO_POR_DEFECTO);
  });

  it("rechaza los caracteres de control que el navegador usa para armar un //", () => {
    // El navegador descarta tabulador, salto de línea y retorno de carro de la
    // URL, así que `/<tab>/malo.com` termina siendo `//malo.com`.
    expect(destinoSeguro(`/${ctrl(9)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(10)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(`/${ctrl(13)}/malo.com`)).toBe(DESTINO_POR_DEFECTO);
  });

  /**
   * Estos tres los rechazaba la versión anterior y **esta los acepta**, a
   * propósito: normalizados se quedan en nuestro origen, así que son rutas
   * internas y redirigir ahí no lleva a ninguna parte peligrosa. Que se
   * rechazaran antes no era una propiedad de seguridad, era que la lista de
   * prohibiciones cortaba de más.
   *
   * Van como test para que quede escrito que la diferencia se revisó, y no
   * pase por un descuido al reemplazar el filtro.
   */
  it("acepta lo que normaliza a una ruta interna, aunque parezca raro", () => {
    expect(destinoSeguro("/algo/\\malo.com")).toBe("/algo//malo.com");
    expect(destinoSeguro(`/${ctrl(0)}malo.com`)).toBe("/%00malo.com");
    expect(destinoSeguro(`/${ctrl(0x85)}malo.com`)).toBe("/%C2%85malo.com");
  });
});
