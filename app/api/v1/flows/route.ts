import { requireManager } from "@/lib/workspace";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: flows, error } = await supabase
    .from("flows")
    .select("id, name, description, status, version, published_at, created_at, updated_at")
    .eq("workspace_id", membership.workspace_id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(flows);
}

export async function POST(request: NextRequest) {
  // 1b (ítem 4 de la sesión de cierre): escribir flujos es de Owner y Admin,
  // controlado en el servidor. Un flujo publicado le escribe a cualquier contacto.
  const { error: sinRol } = await requireManager();
  if (sinRol) return sinRol;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const body = await request.json();

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      workspace_id: membership.workspace_id,
      name: body.name || "Untitled Flow",
      description: body.description || null,
      nodes: body.nodes || [],
      edges: body.edges || [],
    })
    .select("id, name, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(flow, { status: 201 });
}
