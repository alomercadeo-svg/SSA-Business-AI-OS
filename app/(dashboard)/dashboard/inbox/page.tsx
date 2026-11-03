import { getWorkspace, esManager } from "@/lib/workspace";
import { InboxView } from "./inbox-view";
import { AvisoSesionWhatsapp } from "@/components/inbox/aviso-sesion-whatsapp";
import { COLUMNAS_DEL_AVISO, type CanalDeSesion } from "@/lib/sesion-whatsapp-pantalla";
import { busquedaDeBandeja, estadoDeBandeja, leerCantidades, leerPaginaDeBandeja } from "@/lib/bandeja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversacion?: string | string[]; q?: string | string[]; estado?: string | string[] }>;
}) {
  const { workspace, supabase, role } = await getWorkspace();
  const { conversacion, q, estado: estadoPedido } = await searchParams;
  // F35: la pestaña y la búsqueda viven en la dirección (`?estado=`, `?q=`),
  // así la página se puede recargar o compartir. «Abiertas» por defecto.
  const busqueda = busquedaDeBandeja(q);
  const estado = estadoDeBandeja(estadoPedido);

  // F35: la primera página la lee el servidor, con las funciones de la 00043
  // (security invoker: la seguridad por filas decide qué ve cada uno). Las
  // siguientes las pide la lista a /api/v1/conversations.
  const [pagina, cantidades] = await Promise.all([
    leerPaginaDeBandeja(supabase, workspace.id, { estado, busqueda, cursor: null }),
    leerCantidades(supabase, workspace.id, busqueda),
  ]);
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
        .select("*, contacts(*)")
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
          workspaceId={workspace.id}
          conversacionInicial={conversacionInicial}
        />
      </div>
    </div>
  );
}
