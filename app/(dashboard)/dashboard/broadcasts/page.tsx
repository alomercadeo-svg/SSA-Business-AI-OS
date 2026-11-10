import { getWorkspaceAsManager } from "@/lib/workspace";
import { BroadcastsView } from "./broadcasts-view";

export default async function BroadcastsPage() {
  const { workspace, supabase } = await getWorkspaceAsManager(); // 1b: solo Owner y Admin (§11.1)

  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <BroadcastsView
      broadcasts={broadcasts ?? []}
      workspaceId={workspace.id}
    />
  );
}
