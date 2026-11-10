import { esManager, getWorkspace } from "@/lib/workspace";
import { miembrosParaLaBandeja } from "@/lib/miembros-bandeja";
import { filtrosDeContactos, filtrosDeContactosParaElRol, leerContactos, paginaDeContactos, settersEnOrden } from "@/lib/contactos";
import { ContactsView } from "./contacts-view";
import { ContactosEliminados } from "@/components/contacts/contactos-eliminados";

type Parametros = Record<string, string | string[] | undefined>;

/**
 * La lista de Contactos (F43, tramo B de S9): la primera página, la cantidad
 * y el total, desde el servidor, con la búsqueda, los filtros y la página de
 * la dirección. Hasta el 05/11/2026 traía los primeros 100 y buscaba en el
 * navegador. Lo demás lo pide la vista a `GET /api/v1/contacts`.
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<Parametros> }) {
  const { workspace, supabase, role, user } = await getWorkspace();
  const params = await searchParams;
  const manager = esManager(role);

  // F30: la vista «Eliminados». `contactos_eliminados` aplica el alcance de
  // quien mira (un Member ve solo sus leads); la lista de abajo ya no los
  // muestra, porque la seguridad por filas de la 00038 oculta lo eliminado.
  if (params.vista === "eliminados") {
    const { data, error } = await supabase.rpc("contactos_eliminados", { p_workspace: workspace.id });
    // Un error no se muestra como «no hay eliminados»: la pantalla de error lo dice.
    if (error) throw new Error("No se pudieron leer los contactos eliminados.");
    return <ContactosEliminados filas={data ?? []} puedeRestaurar={manager} />;
  }

  const filtros = filtrosDeContactosParaElRol(filtrosDeContactos(params), manager, user.id);
  // F43, criterio 7: para ordenar por setter, la base necesita los setters ya ordenados por nombre.
  const pedidoDeMiembros = miembrosParaLaBandeja(role, user, workspace.id);
  const setters = filtros.orden.campo === "setter" ? settersEnOrden(await pedidoDeMiembros) : [];
  const [lista, tagsRes, miembros] = await Promise.all([
    leerContactos(supabase, workspace.id, filtros, paginaDeContactos(params.pagina), setters),
    supabase.from("tags").select("*").eq("workspace_id", workspace.id).order("name"),
    // F43 (pendiente de S8): a un Member, solo él mismo; no se lee el equipo con la clave de servicio.
    pedidoDeMiembros,
  ]);
  if (lista.error) throw new Error("No se pudieron leer los contactos.");

  return (
    <ContactsView
      inicial={{ contactos: lista.contactos, cantidad: lista.cantidad, total: lista.total, pagina: lista.pagina, paginas: lista.paginas }}
      filtros={filtros}
      tags={tagsRes.data ?? []}
      miembros={miembros}
      equipoCompleto={manager}
      ahora={new Date().toISOString()}
      recienEliminado={params.eliminado === "1"}
    />
  );
}
