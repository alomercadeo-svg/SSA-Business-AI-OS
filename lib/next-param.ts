/**
 * Validación del parámetro `next` de las pantallas de autenticación.
 *
 * `next` sale de la URL, así que lo controla quien arma el link. Sin validar,
 * `/login?next=https://sitio-falso.com` convierte la pantalla de login en un
 * redirector abierto: el usuario ve el dominio real, se autentica, y termina en
 * otro lado. Es la base de un phishing creíble.
 *
 * POR QUÉ NO ES UNA LISTA DE PROHIBICIONES
 *
 * La primera versión enumeraba lo malo: que no empiece con `https://`, que no
 * empiece con `//`, que no tenga barra invertida, que no tenga caracteres de
 * control. Cada regla nació de un bypass que alguien nombró, y la cuarta
 * apareció después de las otras tres. Siempre hay un quinto.
 *
 * Esta versión hace lo contrario: **parsea con el mismo normalizador que usa el
 * navegador** y acepta solo si el resultado se queda en el mismo origen. Un
 * truco nuevo tiene que sobrevivir a esa normalización para servir de algo, y
 * si la sobrevive, `url.origin` lo delata. No hay lista que mantener.
 *
 * El origen es un centinela y no el real a propósito: lo único que importa es
 * si el destino se queda donde estaba o se va a otro lado, y eso no depende de
 * cuál sea el origen. Así la función no necesita `window`, que no existe
 * durante el render del servidor.
 *
 * Lo que devuelve es la ruta **ya normalizada**, no el texto original: si el
 * navegador va a interpretar `/a/\b` como `/a//b`, eso es lo que se usa.
 */

export const DESTINO_POR_DEFECTO = "/dashboard";

/** Origen de referencia. No se resuelve a ningún lado: `.invalid` está reservado. */
const ORIGEN_DE_REFERENCIA = "http://interno.invalid";

/**
 * Devuelve la ruta interna a la que ir, o el destino por defecto.
 *
 * Acepta cualquier cosa que resuelva dentro del mismo origen y conserva query
 * string y fragmento. Rechaza todo lo demás, incluido lo que ni siquiera
 * parsea.
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_POR_DEFECTO;

  try {
    const url = new URL(next, ORIGEN_DE_REFERENCIA);
    if (url.origin !== ORIGEN_DE_REFERENCIA) return DESTINO_POR_DEFECTO;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DESTINO_POR_DEFECTO;
  }
}
