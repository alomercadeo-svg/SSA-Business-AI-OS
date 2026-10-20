import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorDe, registrarAuditoria } from "@/lib/auditoria";
import { origenPermitido } from "@/lib/asignacion";
import { cambiosDeEdicion, leerPedidoDeEdicion } from "@/lib/edicion-contacto";

/**
 * PATCH /api/v1/contacts/[contactId] — «Editar datos» de la ficha (F30).
 *
 * Cuerpo: cualquiera de `display_name`, `email`, `secondary_email`, `phone`,
 * `country`, `lead_temperature` y `next_followup_date`.
 *
 * ES UNA RUTA Y NO UNA ACCIÓN DE SERVIDOR, por el mismo motivo que la de F41
 * (aprobado por Marcos el 19/10/2026 para F41 y en el plan del 20/10/2026 para
 * esta): `scripts/verify-ficha.mjs` la llama con la sesión real de cada uno,
 * igual que el botón. Trae el mismo control de origen (`origenPermitido`).
 *
 * Escribe con el cliente del usuario: la seguridad por filas decide qué
 * contacto puede tocar. Un nombre escrito acá queda como `manual`, y ningún
 * camino automático lo vuelve a pisar (F25). El teléfono pasa por
 * `reconciliar_telefono` (vía manual), que avisa si ya es de otro contacto y
 * deja su propia fila en el historial. Lo demás queda como «contacto editado»,
 * con el valor anterior y el nuevo.
 *
 * El correo no se bloquea si ya lo tiene otro contacto, pero se avisa
 * (decisión de Marcos del 20/10/2026): la búsqueda entre canales de F29 vincula
 * por correo solo si es único, y un correo repetido deja de vincular sin que
 * nadie lo note. Se busca con el cliente del usuario: un Member solo se entera
 * de los contactos que puede ver.
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
  const lectura = leerPedidoDeEdicion(cuerpo);
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 400 });
  const pedido = lectura.pedido;

  const { contactId } = await params;
  const { data: contacto } = await supabase
    .from("contacts")
    .select("id, workspace_id, display_name, email, secondary_email, phone, country, lead_temperature, next_followup_date")
    .eq("id", contactId)
    .maybeSingle();
  if (!contacto) {
    return NextResponse.json({ error: "No encontramos ese contacto, o no está asignado a vos." }, { status: 404 });
  }

  const cambios = cambiosDeEdicion(contacto, pedido);
  if (Object.keys(cambios).length > 0) {
    const nuevo: Record<string, unknown> = Object.fromEntries(Object.entries(cambios).map(([campo, c]) => [campo, c.despues]));
    if ("display_name" in cambios) nuevo.display_name_source = "manual";
    const { data: escrito, error } = await supabase.from("contacts").update(nuevo).eq("id", contactId).select("id").maybeSingle();
    if (error || !escrito) {
      console.error("[edicion] no se pudo guardar:", error?.code ?? "sin filas");
      return NextResponse.json({ error: "No se pudo guardar. Volvé a intentar." }, { status: error ? 500 : 404 });
    }
    await registrarAuditoria({
      workspaceId: contacto.workspace_id,
      actor: actorDe(user),
      accion: "contacto.editado",
      entidad: { tipo: "contacto", id: contacto.id, etiqueta: pedido.display_name ?? contacto.display_name },
      cambios,
    });
  }

  type Reconciliacion = { resultado: string; visible?: boolean; otro_id?: string };
  let aviso: string | undefined;
  if (pedido.email && pedido.email !== (contacto.email ?? "").toLowerCase()) {
    const patron = pedido.email.replace(/[\\%_]/g, "\\$&");
    const { data: otros } = await supabase
      .from("contacts")
      .select("id, display_name")
      .eq("workspace_id", contacto.workspace_id)
      .ilike("email", patron)
      .neq("id", contactId)
      .is("deleted_at", null)
      .limit(1);
    const otro = (otros ?? [])[0] as { display_name?: string | null } | undefined;
    if (otro) aviso = `Ojo: «${otro.display_name ?? "otro contacto"}» ya tiene ese correo. Se guardó igual; si son la misma persona, conviene unirlos.`;
  }

  let telefono: Reconciliacion | null = null;
  if (pedido.phone && pedido.phone !== contacto.phone) {
    const { data, error } = await supabase.rpc("reconciliar_telefono", {
      p_contacto: contactId,
      p_telefono: pedido.phone,
      p_via: "manual",
    });
    if (error) {
      console.error("[edicion] teléfono:", error.code);
      return NextResponse.json({ error: "No se pudo guardar el teléfono. Volvé a intentar." }, { status: 500 });
    }
    telefono = data as unknown as Reconciliacion;
    if (telefono?.resultado === "conflicto") {
      return NextResponse.json(
        {
          error: telefono.visible
            ? "Ese teléfono ya es de otro contacto. Si son la misma persona, un Owner o un Admin puede unirlos desde la ficha del otro."
            : "Ese teléfono ya es de otro contacto que no está asignado a vos. Pedíselo a un Owner o un Admin.",
          guardado: Object.keys(cambios),
          conflicto: telefono.visible ? { otro_id: telefono.otro_id } : null,
          aviso,
        },
        { status: 409 },
      );
    }
  }

  return NextResponse.json({ guardado: [...Object.keys(cambios), ...(telefono ? ["phone"] : [])], ...(aviso ? { aviso } : {}) });
}
