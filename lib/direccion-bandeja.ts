/**
 * La dirección de la bandeja (F35): la pestaña, la búsqueda, los filtros y la
 * conversación abierta viven ahí, así la página se puede recargar, compartir,
 * y volver a ella desde la ficha (tramo C de S8).
 *
 * POR QUÉ HACE FALTA COMPARAR AL MONTARSE. La lista escribe la dirección con
 * `replaceState`, sin pedirle la página al servidor (ya tiene los
 * resultados). Al volver con el atrás del navegador, Next restaura la página
 * que guardó la primera vez: la dirección dice `?q=…` y la página se dibuja
 * sin la búsqueda. Visto por Marcos el 04/11/2026 a las 15:47, y leído en
 * `app-router.js` y `restore-reducer.js` de Next 16.1.6.
 *
 * Sin React ni nada de servidor: lo usan la lista y la vista.
 */
import { busquedaDeBandeja, estadoDeBandeja, type EstadoDeBandeja } from "./bandeja";
import { CLAVES_DE_FILTROS, filtrosDeLaDireccion, parametrosDeFiltros, type FiltrosDeBandeja } from "./filtros-bandeja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VistaDeLaBandeja {
  estado: EstadoDeBandeja;
  busqueda: string;
  filtros: FiltrosDeBandeja;
  conversacion: string | null;
}

/** La dirección con la pestaña, lo buscado y los filtros, sobre la actual (conserva lo demás). */
export function direccionDeLaBandeja(href: string, estado: EstadoDeBandeja, busqueda: string, filtros: FiltrosDeBandeja): string {
  const url = new URL(href);
  if (busqueda) url.searchParams.set("q", busqueda);
  else url.searchParams.delete("q");
  if (estado !== "open") url.searchParams.set("estado", estado);
  else url.searchParams.delete("estado");
  for (const clave of CLAVES_DE_FILTROS) url.searchParams.delete(clave);
  for (const [clave, valor] of parametrosDeFiltros(filtros)) url.searchParams.set(clave, valor);
  return `${url.pathname}${url.search}`;
}

/** La dirección con la conversación abierta (`?conversacion=`, el mismo parámetro de F30), o sin ella. */
export function conConversacion(href: string, conversacion: string | null): string {
  const url = new URL(href);
  if (conversacion) url.searchParams.set("conversacion", conversacion);
  else url.searchParams.delete("conversacion");
  return `${url.pathname}${url.search}`;
}

/** Lo que el servidor lee de la dirección (como `inbox/page.tsx`). */
export function vistaDeLaDireccion(p: URLSearchParams): VistaDeLaBandeja {
  const c = p.get("conversacion");
  return {
    estado: estadoDeBandeja(p.get("estado") ?? undefined),
    busqueda: busquedaDeBandeja(p.get("q") ?? undefined),
    filtros: filtrosDeLaDireccion(p),
    conversacion: c && UUID.test(c) ? c : null,
  };
}

/**
 * Si la dirección no es lo que la página dibujó. Compara lo que el servidor
 * leería de la dirección (las mismas funciones que `inbox/page.tsx`) contra
 * lo que llegó como props, no los textos de la dirección: «Abiertas» no se
 * escribe, y los filtros pueden venir en otro orden.
 */
export function direccionDistinta(p: URLSearchParams, vista: VistaDeLaBandeja): boolean {
  const leida = vistaDeLaDireccion(p);
  return (
    leida.estado !== vista.estado ||
    leida.busqueda !== vista.busqueda ||
    JSON.stringify(parametrosDeFiltros(leida.filtros)) !== JSON.stringify(parametrosDeFiltros(vista.filtros)) ||
    (leida.conversacion?.toLowerCase() ?? null) !== (vista.conversacion?.toLowerCase() ?? null)
  );
}

/**
 * Lo que hace la vista de la bandeja al montarse: si la dirección no es lo que
 * la página dibujó, le pide la página al servidor otra vez. Como mucho una vez
 * por montaje: si la página nueva tampoco coincide (por ejemplo, una
 * conversación que ya no se puede ver), no vuelve a pedirla.
 */
export function crearVigiaDeLaDireccion(refrescar: () => void) {
  let refresco = false;
  return {
    alMontar(p: URLSearchParams, vista: VistaDeLaBandeja) {
      if (refresco || !direccionDistinta(p, vista)) return;
      refresco = true;
      refrescar();
    },
  };
}
