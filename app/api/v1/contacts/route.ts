import { NextRequest, NextResponse } from "next/server";
import { esManager, getWorkspaceOrNull } from "@/lib/workspace";
import { filtrosDeContactos, filtrosDeContactosParaElRol, leerContactos, paginaDeContactos } from "@/lib/contactos";

/**
 * GET /api/v1/contacts (F43, tramo B de S9): la lista de Contactos.
 *
 *   ?q=…                     la búsqueda, palabra por palabra, sin tildes
 *   ?seguimiento=hoy|semana|vencido, ?etapa=…, ?setter=…, ?vendedor=…, ?etiqueta=…
 *                            los filtros de la fila (lib/contactos.ts). Lo que
 *                            no se entiende se descarta. Un Member con el id
 *                            de otro en setter o vendedor: se ignora.
 *   ?pagina=N                la página, desde 1
 *
 * Reemplaza el GET del fork, que nadie llamaba (verificado el 05/11/2026),
 * tomaba la primera membresía y no el espacio elegido, y filtraba la etiqueta
 * en memoria.
 *
 * Lee con el cliente del usuario y las funciones `security invoker` de la
 * 00049: la seguridad por filas decide qué contactos ve cada uno.
 *
 * Server-Timing, como la ruta de la bandeja: `sesion_y_espacio`, `lista` (la
 * página y las cantidades, a la vez) y `total`, en milisegundos y sin datos.
 */
const ms = (desde: number) => (performance.now() - desde).toFixed(1);

export async function GET(request: NextRequest) {
  const inicio = performance.now();
  const contexto = await getWorkspaceOrNull();
  const tSesion = ms(inicio);
  if (!contexto) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, workspace, role, user } = contexto;

  const p = request.nextUrl.searchParams;
  const filtros = filtrosDeContactosParaElRol(filtrosDeContactos(p), esManager(role), user.id);
  const desde = performance.now();
  const lista = await leerContactos(supabase, workspace.id, filtros, paginaDeContactos(p.get("pagina") ?? undefined));
  const tLista = ms(desde);
  if (lista.error) {
    console.error("[contacts] no se pudo leer la lista:", lista.error);
    return NextResponse.json({ error: "No se pudieron leer los contactos" }, { status: 500 });
  }
  const res = NextResponse.json({ contactos: lista.contactos, cantidad: lista.cantidad, total: lista.total, pagina: lista.pagina, paginas: lista.paginas });
  res.headers.set("Server-Timing", `sesion_y_espacio;dur=${tSesion}, lista;dur=${tLista}, total;dur=${ms(inicio)}`);
  return res;
}
