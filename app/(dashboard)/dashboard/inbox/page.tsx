import { getWorkspace, esManager } from "@/lib/workspace";
import { InboxView } from "./inbox-view";
import { AvisoSesionWhatsapp, COLUMNAS_DEL_AVISO, type CanalDeSesion } from "@/components/inbox/aviso-sesion-whatsapp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversacion?: string | string[] }>;
}) {
  const { workspace, supabase, role } = await getWorkspace();
  const { conversacion } = await searchParams;

  const { data: conversations } = await supabase
    .from("conversations")
    .select("*, contacts(*)")
    .eq("workspace_id", workspace.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  // F30: el clic de la ficha abre ese hilo. Si no está entre las 50 de la
  // lista, se lee sola, por su id, con el cliente del usuario: la seguridad por
  // filas decide si la puede ver (una ajena o eliminada no llega). La lista no
  // cambia: traer más conversaciones o buscarlas es F35.
  let conversacionInicial = null;
  const pedida = typeof conversacion === "string" && UUID.test(conversacion) ? conversacion : null;
  if (pedida) {
    conversacionInicial = (conversations ?? []).find((c) => c.id === pedida) ?? null;
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
          conversations={conversations ?? []}
          workspaceId={workspace.id}
          conversacionInicial={conversacionInicial}
        />
      </div>
    </div>
  );
}
