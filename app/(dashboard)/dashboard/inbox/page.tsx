import { getWorkspace } from "@/lib/workspace";
import { InboxView } from "./inbox-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversacion?: string | string[] }>;
}) {
  const { workspace, supabase } = await getWorkspace();
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

  return (
    <InboxView
      conversations={conversations ?? []}
      workspaceId={workspace.id}
      conversacionInicial={conversacionInicial}
    />
  );
}
