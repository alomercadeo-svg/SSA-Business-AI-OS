import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { origenPermitido } from "@/lib/asignacion";
import { hoyEnZona } from "@/lib/seguimiento";
import { zonaValida } from "@/lib/horas-habiles";

/**
 * PATCH /api/v1/conversations/[id] — «Cerrar» y «Reabrir» del hilo (F35,
 * tramo D de S8). Cuerpo: `{ estado: "closed" | "open" }`.
 *
 * Escribe con el cliente del usuario: la seguridad por filas decide qué
 * conversación puede tocar cada uno (la política de edición de
 * `conversations`, 00019). Una que no ve da 404, y un `update` que no toca
 * ninguna fila también: nunca un 200 sin cambios (la lección del 204 de la
 * policy de UPDATE, Bloque 1).
 *
 * AL CERRAR SE PIDE EL PRÓXIMO SEGUIMIENTO si el del contacto es de hoy o ya
 * venció, con «hoy» en `workspaces.zona_horaria` (Costa Rica si viene vacía,
 * como el `coalesce` de los filtros, 00046:50). Responde 409 con
 * `code: "pide_seguimiento"` y no cierra: el hilo muestra el selector, y al
 * elegir vuelve a pedir el cierre. Si un Member no puede leer el contacto (la
 * conversación es suya y el contacto no), no hay fecha que mirar y cierra; la
 * tarea de reapertura la vuelve a abrir si el seguimiento estaba vencido.
 *
 * Cambiar el estado no deja fila en el historial de auditoría: F31 no lo pide
 * y la lista de acciones de `audit_log` (00040) no lo tiene.
 *
 * Trae el mismo control de origen que las rutas de la ficha (`origenPermitido`).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const estado = (cuerpo as { estado?: unknown } | null)?.estado;
  if (estado !== "closed" && estado !== "open") {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const { id } = await params;
  const { data: conversacion } = await supabase
    .from("conversations")
    .select("id, status, contact_id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversacion) {
    return NextResponse.json({ error: "No encontramos esa conversación, o no está asignada a vos." }, { status: 404 });
  }

  if (estado === "closed" && conversacion.contact_id) {
    const { data: contacto } = await supabase
      .from("contacts")
      .select("next_followup_date")
      .eq("id", conversacion.contact_id)
      .maybeSingle();
    const fecha = (contacto as { next_followup_date?: string | null } | null)?.next_followup_date ?? null;
    if (fecha) {
      const { data: espacio } = await supabase.from("workspaces").select("zona_horaria").eq("id", conversacion.workspace_id).maybeSingle();
      const zona = (espacio as { zona_horaria?: string | null } | null)?.zona_horaria ?? "America/Costa_Rica";
      if (!zonaValida(zona)) {
        console.error("[estado] la zona del espacio no es válida");
        return NextResponse.json({ error: "No se pudo cambiar el estado de la conversación." }, { status: 500 });
      }
      if (fecha <= hoyEnZona(new Date(), zona)) {
        return NextResponse.json(
          { error: "Antes de cerrar, elegí el próximo seguimiento.", code: "pide_seguimiento", fecha },
          { status: 409 },
        );
      }
    }
  }

  const { data: escrito, error } = await supabase.from("conversations").update({ status: estado }).eq("id", id).select("id, status").maybeSingle();
  if (error || !escrito) {
    console.error("[estado] no se pudo guardar:", error?.code ?? "sin filas");
    return NextResponse.json({ error: "No se pudo cambiar el estado de la conversación." }, { status: error ? 500 : 404 });
  }
  return NextResponse.json({ status: (escrito as { status: string }).status });
}
