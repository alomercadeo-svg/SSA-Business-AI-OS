/**
 * Validación del parámetro `next` de las pantallas de autenticación.
 *
 * `next` sale de la URL, así que lo controla quien arma el link. Sin validar,
 * `/login?next=https://sitio-falso.com` convierte la pantalla de login en un
 * redirector abierto: el usuario ve el dominio real, se autentica, y termina en
 * otro lado. Es la base de un phishing creíble.
 *
 * Solo se acepta una ruta interna. Tres reglas, y las tres hacen falta:
 *
 *   1. Tiene que empezar con `/`. Corta `https://malo.com`.
 *   2. No puede empezar con `//`. Corta `//malo.com`, que es una URL
 *      protocol-relative: el navegador la resuelve como host externo.
 *   3. No puede contener barra invertida ni caracteres de control. Esta es la
 *      que no es obvia. **El navegador normaliza la barra invertida a barra**,
 *      así que `/\malo.com` empieza con una sola `/`, pasa las dos reglas
 *      anteriores, y el navegador lo resuelve igual a `http://malo.com/`.
 *      Comprobado en el navegador, no es una hipótesis. Los caracteres de
 *      control entran por el mismo motivo: el navegador los descarta de la URL,
 *      así que sirven para partir un `//` en dos y esquivar la regla 2.
 *
 * `app/auth/callback/route.ts` aplica las dos primeras sobre el mismo
 * parámetro. Ese camino es del servidor y termina en un `NextResponse.redirect`
 * con un origin fijo adelante, así que no tiene el mismo problema.
 */

export const DESTINO_POR_DEFECTO = "/dashboard";

/**
 * Barra invertida y caracteres de control, que el navegador descarta o traduce.
 *
 * `\p{Cc}` es la categoría Unicode de los controles (C0 y C1). Se usa eso y no
 * un rango numérico a propósito: escribir el rango obliga a meter caracteres de
 * control escapados en el fuente, que es justo lo que vuelve ilegible un
 * archivo y hace que las herramientas lo traten como binario.
 */
const CARACTERES_PROHIBIDOS = /[\\\p{Cc}]/u;

/** Devuelve el destino si es una ruta interna; si no, el destino por defecto. */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_POR_DEFECTO;
  if (!next.startsWith("/")) return DESTINO_POR_DEFECTO;
  if (next.startsWith("//")) return DESTINO_POR_DEFECTO;
  if (CARACTERES_PROHIBIDOS.test(next)) return DESTINO_POR_DEFECTO;
  return next;
}
