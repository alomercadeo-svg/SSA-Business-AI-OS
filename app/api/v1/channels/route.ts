import { NextResponse } from "next/server";
import { getWorkspaceOrNull } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";

export async function GET() {
  const contexto = await getWorkspaceOrNull();
  if (!contexto)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspace, supabase } = contexto;

  const { data: channels, error } = await supabase
    .from("channels")
    // Sin "*": estas filas se devuelven como JSON y el secreto de firma del
    // canal iría dentro.
    .select(CHANNEL_PUBLIC_COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(channels);
}
