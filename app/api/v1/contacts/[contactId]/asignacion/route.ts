import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorDe, registrarAuditoria } from "@/lib/auditoria";
import { cambiosDeAsignacion, leerPedidoDeAsignacion, origenPermitido, type Asignacion } from "@/lib/asignacion";
import { miembrosDelEspacio } from "@/lib/miembros";

/**
 * PATCH /api/v1/contacts/[contactId]/asignacion — F41.
 *
 * Cuerpo: `{ setter_id?: uuid | null, vendedor_id?: uuid | null }`.
 *
 * ES UNA RUTA Y NO UNA ACCIÓN DE SERVIDOR, a propósito (apartamiento del
 * patrón del CLAUDE.md, anotado en `docs/estado-fase1.md`): el control
 * positivo de F41 pide probar la asignación «desde el desplegable» con la
 * sesión real de un usuario, y un script puede llamar a esta ruta igual que el
 * desplegable. Por eso trae su propio control de origen (`origenPermitido`).
 *
 * Escribe con el cliente del usuario: la RLS de la 00019 decide qué contacto
 * puede tocar, y su `with check` no deja que un Member se quite un lead que
 * dejaría de ver. El historial va con la clave de servicio (`registrarAuditoria`).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  if (!origenPermitido(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return NextResponse.json({ error: "Pedido rechazado: no viene de la aplicación." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }
  const pedido = leerPedidoDeAsignacion(cuerpo);
  if (!pedido) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  const { contactId } = await params;
  const { data: contacto } = await supabase
    .from("contacts")
    .select("id, workspace_id, display_name, setter_id, vendedor_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contacto) {
    return NextResponse.json({ error: "No encontramos ese contacto, o no está asignado a vos." }, { status: 404 });
  }

  const miembros = await miembrosDelEspacio(contacto.workspace_id);
  const nombre = (id: string | null) => (id ? (miembros.find((m) => m.id === id)?.etiqueta ?? id) : null);
  for (const id of Object.values(pedido)) {
    if (id && !miembros.some((m) => m.id === id)) {
      return NextResponse.json({ error: "Esa persona no es parte del equipo." }, { status: 400 });
    }
  }

  const actual: Asignacion = { setter_id: contacto.setter_id, vendedor_id: contacto.vendedor_id };
  const cambios = cambiosDeAsignacion(actual, pedido);
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ ...actual, sinCambios: true });
  }

  const nuevo = Object.fromEntries(Object.entries(cambios).map(([campo, c]) => [campo, c.despues]));
  const { data: escrito, error } = await supabase
    .from("contacts")
    .update(nuevo)
    .eq("id", contactId)
    .select("setter_id, vendedor_id")
    .maybeSingle();
  if (error?.code === "42501") {
    return NextResponse.json(
      { error: "No podés quitarte este contacto: dejarías de verlo. Pedíselo a un Owner o un Admin." },
      { status: 403 },
    );
  }
  if (error || !escrito) {
    console.error("[asignacion] no se pudo guardar:", error?.message ?? "sin filas");
    return NextResponse.json({ error: "No se pudo guardar la asignación. Volvé a intentar." }, { status: 500 });
  }

  await registrarAuditoria({
    workspaceId: contacto.workspace_id,
    actor: actorDe(user),
    accion: "contacto.asignado",
    entidad: { tipo: "contacto", id: contacto.id, etiqueta: contacto.display_name },
    cambios,
    detalle: {
      nombres: Object.fromEntries(
        Object.entries(cambios).map(([campo, c]) => [campo, { antes: nombre(c.antes), despues: nombre(c.despues) }]),
      ),
    },
  });

  return NextResponse.json({ setter_id: escrito.setter_id, vendedor_id: escrito.vendedor_id });
}
