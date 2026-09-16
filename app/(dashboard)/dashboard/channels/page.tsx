import { getWorkspaceAsManager } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { ChannelsView } from "./channels-view";

export default async function ChannelsPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();

  const { data: channels } = await supabase
    .from("channels")
    // Sin "*": estas filas se serializan en las props de ChannelsView, que es
    // un Client Component, y el secreto de firma terminaría en el HTML.
    .select(CHANNEL_PUBLIC_COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <ChannelsView
      channels={channels ?? []}
      workspaceId={workspace.id}
    />
  );
}
