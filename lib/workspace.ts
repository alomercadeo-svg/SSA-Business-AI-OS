import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const WORKSPACE_COOKIE = "zernflow_workspace_id";

/**
 * Columnas del workspace que se pueden traer a la UI.
 *
 * Con `workspaces(*)` la fila entera terminaba en las props de <Sidebar>, que es
 * un Client Component, así que Next serializaba `late_api_key_encrypted`,
 * `ai_api_key` y `webhook_secret` en el HTML de TODAS las páginas del
 * dashboard. Las API keys ahora viven en Vault (lib/vault.ts) y el secreto de
 * HMAC lo leen `resolveWebhookSecret` y `getOrCreateWorkspaceWebhookSecret` con
 * su propia consulta del lado del servidor. Ninguno de los tres se usa en la
 * UI, así que se enumeran las columnas en vez de traer todo.
 */
const WORKSPACE_COLUMNS =
  "id, name, slug, ai_provider, global_keywords, unassigned_leads_visible_to_members, created_at, updated_at";

/**
 * Cached per-request: deduplicates across layout + page in the same render.
 * Reads workspace ID from cookie if set; falls back to first workspace.
 */
export const getWorkspace = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  // Try cookie workspace first
  if (selectedId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select(`workspace_id, role, workspaces(${WORKSPACE_COLUMNS})`)
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .single();

    if (membership?.workspaces) {
      return {
        user,
        workspace: membership.workspaces,
        role: membership.role,
        supabase,
      };
    }
  }

  // Fallback to first workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select(`workspace_id, role, workspaces(${WORKSPACE_COLUMNS})`)
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.workspaces) redirect("/login");

  return {
    user,
    workspace: membership.workspaces,
    role: membership.role,
    supabase,
  };
});
