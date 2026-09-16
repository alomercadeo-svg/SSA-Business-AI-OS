import { getWorkspace } from "@/lib/workspace";
import { hasWorkspaceSecret, SECRET_NAMES } from "@/lib/vault";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const { workspace, supabase } = await getWorkspace();

  // Solo si la clave está configurada o no. El valor no se le manda al cliente:
  // antes venía en la fila del workspace y viajaba al navegador en cada carga.
  // Se lee con el cliente del usuario, así que la autorización de Vault aplica.
  const [hasApiKey, hasAiKey] = await Promise.all([
    hasWorkspaceSecret(supabase, workspace.id, SECRET_NAMES.zernio),
    hasWorkspaceSecret(supabase, workspace.id, SECRET_NAMES.aiGateway),
  ]);

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey,
        hasAiKey,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
    />
  );
}
