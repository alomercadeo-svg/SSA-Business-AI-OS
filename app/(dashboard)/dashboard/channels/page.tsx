import { getWorkspaceAsManager } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { ChannelsView } from "./channels-view";
import { WebhookAlertsBanner } from "./webhook-alerts-banner";

export default async function ChannelsPage() {
  const { workspace, supabase, role } = await getWorkspaceAsManager();

  const { data: channels } = await supabase
    .from("channels")
    // Sin "*": estas filas se serializan en las props de ChannelsView, que es
    // un Client Component, y el secreto de firma terminaría en el HTML.
    .select(CHANNEL_PUBLIC_COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <>
      {/* Arriba de la lista a propósito: si el canal está rechazando mensajes,
          eso importa más que cualquier cosa que digan las tarjetas de abajo.

          `esOwner` se resuelve acá, contra la sesión, y es la guarda que
          reemplaza a la policy que borró la 00023: las alertas de sistema no
          tienen lectura por RLS y solo las ve el Owner. */}
      <WebhookAlertsBanner
        supabase={supabase}
        workspaceId={workspace.id}
        esOwner={role === "owner"}
      />
      <ChannelsView
        channels={channels ?? []}
        workspaceId={workspace.id}
      />
    </>
  );
}
