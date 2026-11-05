import { getWorkspace, esManager } from "@/lib/workspace";
import { InboxView } from "./inbox-view";
import { AvisoSesionWhatsapp } from "@/components/inbox/aviso-sesion-whatsapp";
import { COLUMNAS_DEL_AVISO, type CanalDeSesion } from "@/lib/sesion-whatsapp-pantalla";
import { SELECCION_DE_BANDEJA, busquedaDeBandeja, estadoDeBandeja, leerCantidades, leerPaginaDeBandeja } from "@/lib/bandeja";
import { PLATAFORMAS, filtrosDeLaDireccion, filtrosParaElRol, type OpcionesDeFiltros } from "@/lib/filtros-bandeja";
import { miembrosParaLaBandeja } from "@/lib/miembros-bandeja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase, role, user } = await getWorkspace();
  const parametros = await searchParams;
  const { conversacion, q, estado: estadoPedido } = parametros;
  // F35: la pestaña y la búsqueda viven en la dirección (`?estado=`, `?q=`),
  // así la página se puede recargar o compartir. «Abiertas» por defecto.
  const busqueda = busquedaDeBandeja(q);
  const estado = estadoDeBandeja(estadoPedido);
  // Tramo B: los filtros también viven en la dirección. Un Member con el id de
  // otro miembro en `asignacion`: se ignora (lib/filtros-bandeja.ts).
  const filtros = filtrosParaElRol(filtrosDeLaDireccion(parametros), esManager(role), user.id);

  // F35: la primera página la lee el servidor, con las funciones de la 00043
  // (security invoker: la seguridad por filas decide qué ve cada uno). Las
  // siguientes las pide la lista a /api/v1/conversations.
  // Lo que ofrece el panel de filtros: las etiquetas del espacio, las
  // plataformas con algún canal activo y, en «Asignación», el equipo para
  // Owner y Admin, o solo quien mira si es Member (lib/miembros-bandeja.ts).
  const [pagina, cantidades, etiquetas, canalesActivos, miembros] = await Promise.all([
    leerPaginaDeBandeja(supabase, workspace.id, { estado, busqueda, cursor: null, filtros }),
    leerCantidades(supabase, workspace.id, busqueda, filtros),
    supabase.from("tags").select("id, name").eq("workspace_id", workspace.id).order("name"),
    supabase.from("channels").select("platform").eq("workspace_id", workspace.id).eq("is_active", true),
    miembrosParaLaBandeja(role, user, workspace.id),
  ]);
  const plataformasActivas = new Set((canalesActivos.data ?? []).map((c) => c.platform));
  const opcionesDeFiltros: OpcionesDeFiltros = {
    etiquetas: etiquetas.data ?? [],
    miembros,
    plataformas: PLATAFORMAS.filter((p) => plataformasActivas.has(p)),
  };
  if (pagina.error) console.error("[inbox] no se pudo leer la bandeja:", pagina.error);
  const conversations = pagina.conversaciones;

  // F30: el clic de la ficha abre ese hilo. Si no está en la primera página de
  // la lista, se lee sola, por su id, con el cliente del usuario: la seguridad
  // por filas decide si la puede ver (una ajena o eliminada no llega). La lista
  // no cambia.
  let conversacionInicial = null;
  const pedida = typeof conversacion === "string" && UUID.test(conversacion) ? conversacion : null;
  if (pedida) {
    conversacionInicial = conversations.find((c) => c.id === pedida) ?? null;
    if (!conversacionInicial) {
      const { data } = await supabase
        .from("conversations")
        .select(SELECCION_DE_BANDEJA)
        .eq("id", pedida)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      conversacionInicial = data ?? null;
    }
  }

  // F32: el aviso de WhatsApp caído. F35 reescribe la bandeja y lo tiene que
  // conservar (ver el encabezado del componente).
  const { data: canalesDeWhatsapp } = await supabase
    .from("channels")
    .select(COLUMNAS_DEL_AVISO)
    .eq("workspace_id", workspace.id)
    .eq("provider", "evolution")
    .eq("is_active", true);

  return (
    <div className="flex h-full flex-col">
      <AvisoSesionWhatsapp inicial={(canalesDeWhatsapp ?? []) as CanalDeSesion[]} esManager={esManager(role)} />
      <div className="min-h-0 flex-1">
        <InboxView
          inicial={{ conversaciones: conversations, hayMas: pagina.hayMas, cantidades }}
          estado={estado}
          busqueda={busqueda}
          filtros={filtros}
          opcionesDeFiltros={opcionesDeFiltros}
          workspaceId={workspace.id}
          zonaDelNegocio={workspace.zona_horaria}
          conversacionInicial={conversacionInicial}
        />
      </div>
    </div>
  );
}
