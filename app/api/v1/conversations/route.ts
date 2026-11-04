import { NextRequest, NextResponse } from "next/server";
import { esManager, getWorkspaceOrNull } from "@/lib/workspace";
import { busquedaDeBandeja, estadoDeBandeja, leerCantidades, leerPaginaDeBandeja } from "@/lib/bandeja";
import { filtrosDeLaDireccion, filtrosParaElRol } from "@/lib/filtros-bandeja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/conversations (F35, tramo A de S8): la lista de la bandeja.
 *
 *   ?estado=open|closed|all  la pestaña (Abiertas por defecto)
 *   ?q=…                     la búsqueda (nombre, usuario, correo, teléfono)
 *   ?antesOrden=…&antesId=…  el cursor: la página siguiente a esa fila
 *   ?id=…                    una sola, si pasa los filtros (la pide Realtime)
 *   ?soloCantidades=1        solo las cantidades de las pestañas
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
export async function GET(request: NextRequest) {
  const contexto = await getWorkspaceOrNull();
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

  const pagina = await leerPaginaDeBandeja(supabase, workspace.id, { estado, busqueda, cursor, id, filtros });
  if (pagina.error) {
    console.error("[conversations] no se pudo leer la bandeja:", pagina.error);
    return NextResponse.json({ error: "No se pudieron leer las conversaciones" }, { status: 500 });
  }
  if (cursor || id) return NextResponse.json({ conversaciones: pagina.conversaciones, hayMas: pagina.hayMas });

  const cantidades = await leerCantidades(supabase, workspace.id, busqueda, filtros);
  return NextResponse.json({ conversaciones: pagina.conversaciones, hayMas: pagina.hayMas, cantidades });
}
