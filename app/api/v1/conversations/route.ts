import { NextRequest, NextResponse } from "next/server";
import { esManager, getWorkspaceOrNull } from "@/lib/workspace";
import { busquedaDeBandeja, estadoDeBandeja, leerCantidades, leerPaginaDeBandeja } from "@/lib/bandeja";
import { filtrosDeLaDireccion, filtrosParaElRol } from "@/lib/filtros-bandeja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/conversations (F35, tramo A de S8): la lista de la bandeja.
 *
 *   ?estado=open|closed|all  la pestaña (Abiertas por defecto)
 *   ?q=…                     la búsqueda, palabra por palabra en el contacto, o en un mismo mensaje
 *   ?antesOrden=…&antesId=…  el cursor: la página siguiente a esa fila
 *   ?id=…                    una sola, si pasa los filtros (la pide Realtime)
 *   ?soloCantidades=1        solo las cantidades de las pestañas
 *
 * Server-Timing (retrabajo del 04/11/2026, pedido por Marcos): la duración de
 * cada paso, en milisegundos y sin datos, para leerla en la pestaña «Timing»
 * del navegador: `sesion_y_espacio` (todo getWorkspaceOrNull: la sesión y la
 * membresía, que no se separan sin tocar lib/workspace.ts), `pagina`,
 * `cantidades` (solo en la primera página) y `total`. No incluye lo que pasa
 * antes de la ruta: el middleware, que también lee la sesión.
 *   ?etiquetas=…&asignacion=…&canal=…&ultimo=…&telefono=…&seguimiento=…
 *                            los filtros del tramo B (lib/filtros-bandeja.ts).
 *                            Lo que no se entiende se descarta. `ahora` no se
 *                            lee: el reloj fijo es solo del verificador. Un
 *                            Member con el id de otro miembro en `asignacion`:
 *                            se ignora, sin error.
 *
 * Lee con el cliente del usuario y las funciones `security invoker` de la
 * 00043: la seguridad por filas decide qué conversaciones ve cada uno. La
 * primera página trae además las cantidades; las siguientes no, porque no
 * cambian por paginar.
 */
/** Un paso medido: nombre y milisegundos, como los pide Server-Timing. */
const ms = (desde: number) => (performance.now() - desde).toFixed(1);
const conTiempos = (res: NextResponse, pasos: Array<[string, string]>) => {
  res.headers.set("Server-Timing", pasos.map(([n, d]) => `${n};dur=${d}`).join(", "));
  return res;
};

/** Mide cuánto tarda una promesa, sin cambiar lo que devuelve. */
async function medida<T>(p: Promise<T>): Promise<[T, string]> {
  const desde = performance.now();
  const r = await p;
  return [r, ms(desde)];
}

export async function GET(request: NextRequest) {
  const inicio = performance.now();
  const [contexto, tSesion] = await medida(getWorkspaceOrNull());
  if (!contexto) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, workspace, role, user } = contexto;

  const p = request.nextUrl.searchParams;
  const estado = estadoDeBandeja(p.get("estado") ?? undefined);
  const busqueda = busquedaDeBandeja(p.get("q") ?? undefined);
  const filtros = filtrosParaElRol(filtrosDeLaDireccion(p), esManager(role), user.id);

  if (p.get("soloCantidades") === "1") {
    const cantidades = await leerCantidades(supabase, workspace.id, busqueda, filtros);
    if (!cantidades) return NextResponse.json({ error: "No se pudieron contar las conversaciones" }, { status: 500 });
    return NextResponse.json({ cantidades });
  }

  const antesOrden = p.get("antesOrden");
  const antesId = p.get("antesId");
  const id = p.get("id") ?? undefined;
  if ((antesOrden || antesId) && !(antesOrden && antesId && UUID.test(antesId))) {
    return NextResponse.json({ error: "Cursor inválido" }, { status: 400 });
  }
  if (id !== undefined && !UUID.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const cursor = antesOrden && antesId ? { orden: antesOrden, id: antesId } : null;

  // La primera página trae además las cantidades. Se piden a la vez: cada una
  // recorre las conversaciones del espacio, y una detrás de la otra sumaban
  // sus tiempos (retrabajo del 04/11/2026). Con cursor o por id, solo la página.
  const primera = !cursor && !id;
  const [[pagina, tPagina], [cantidades, tCantidades]] = await Promise.all([
    medida(leerPaginaDeBandeja(supabase, workspace.id, { estado, busqueda, cursor, id, filtros })),
    primera ? medida(leerCantidades(supabase, workspace.id, busqueda, filtros)) : Promise.resolve([null, ""] as [null, string]),
  ]);
  const tiempos: Array<[string, string]> = [["sesion_y_espacio", tSesion], ["pagina", tPagina], ...(primera ? [["cantidades", tCantidades] as [string, string]] : [])];
  if (pagina.error) {
    console.error("[conversations] no se pudo leer la bandeja:", pagina.error);
    return NextResponse.json({ error: "No se pudieron leer las conversaciones" }, { status: 500 });
  }
  if (!primera) return conTiempos(NextResponse.json({ conversaciones: pagina.conversaciones, hayMas: pagina.hayMas }), [...tiempos, ["total", ms(inicio)]]);
  return conTiempos(NextResponse.json({ conversaciones: pagina.conversaciones, hayMas: pagina.hayMas, cantidades }), [...tiempos, ["total", ms(inicio)]]);
}
