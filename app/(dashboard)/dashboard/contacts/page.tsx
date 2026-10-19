import { getWorkspace } from "@/lib/workspace";
import { filtroDeAsignacion, type FiltroDeAsignacion } from "@/lib/asignacion";
import { miembrosDelEspacio } from "@/lib/miembros";
import { ContactsView } from "./contacts-view";

/** El tope del fork. Paginar la lista no es de F41: ver la nota de F35 en el plano. */
const TOPE = 100;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ setter?: string | string[]; vendedor?: string | string[] }>;
}) {
  const { workspace, supabase } = await getWorkspace();
  const params = await searchParams;
  const filtros = { setter: filtroDeAsignacion(params.setter), vendedor: filtroDeAsignacion(params.vendedor) };

  // F41: el filtro por setter y vendedor corre acá, antes del tope, y el total
  // se cuenta en la base (dentro de lo que la RLS le deja ver a quien mira).
  let query = supabase
    .from("contacts")
    .select("*, contact_tags(tag_id, tags(*))", { count: "exact" })
    .eq("workspace_id", workspace.id);
  const aplicar = (columna: "setter_id" | "vendedor_id", f: FiltroDeAsignacion) => {
    if (f.tipo === "sin") query = query.is(columna, null);
    if (f.tipo === "persona") query = query.eq(columna, f.id);
  };
  aplicar("setter_id", filtros.setter);
  aplicar("vendedor_id", filtros.vendedor);

  const [contactsRes, tagsRes, miembros] = await Promise.all([
    query.order("last_interaction_at", { ascending: false, nullsFirst: false }).limit(TOPE),
    supabase
      .from("tags")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("name"),
    miembrosDelEspacio(workspace.id),
  ]);

  const contacts = contactsRes.data ?? [];
  return (
    <ContactsView
      contacts={contacts}
      total={contactsRes.count ?? contacts.length}
      tags={tagsRes.data ?? []}
      workspaceId={workspace.id}
      miembros={miembros}
      filtroSetter={filtros.setter.tipo === "persona" ? filtros.setter.id : filtros.setter.tipo}
      filtroVendedor={filtros.vendedor.tipo === "persona" ? filtros.vendedor.id : filtros.vendedor.tipo}
    />
  );
}
