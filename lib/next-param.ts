/**
 * Validación del parámetro `next` de las pantallas de autenticación.
 *
 * `next` sale de la URL, así que lo controla quien arma el link. Sin validar,
 * `/login?next=https://sitio-falso.com` convierte la pantalla de login en un
 * redirector abierto: el usuario ve el dominio real, se autentica, y termina en
 * otro lado. Es la base de un phishing creíble.
 *
 * La regla es la misma que ya aplica `app/auth/callback/route.ts`: solo rutas
 * internas. Tiene que empezar con `/` y no con `//`, porque `//sitio.com` es
 * una URL protocol-relative que el navegador resuelve como externa.
 */

export const DESTINO_POR_DEFECTO = "/dashboard";

/** Devuelve el destino si es una ruta interna; si no, el destino por defecto. */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_POR_DEFECTO;
  if (!next.startsWith("/")) return DESTINO_POR_DEFECTO;
  if (next.startsWith("//")) return DESTINO_POR_DEFECTO;
  return next;
}
