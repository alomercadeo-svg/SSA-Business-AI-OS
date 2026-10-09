import { getWorkspaceAsManager } from "@/lib/workspace";
import { hasWorkspaceSecret, SECRET_NAMES } from "@/lib/vault";
import { SettingsView } from "./settings-view";
import { HORARIO_POR_DEFECTO, ZONA_POR_DEFECTO, validarHorario, zonaValida } from "@/lib/horas-habiles";

/**
 * Las zonas IANA que conoce el servidor. Se arman acá y no en el navegador:
 * la lista de `Intl` puede variar entre los dos, y el valor que se guarda lo
 * valida el servidor.
 */
function zonasDisponibles(actual: string): string[] {
  let zonas: string[] = [];
  try {
    zonas = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    zonas = [ZONA_POR_DEFECTO];
  }
  return zonas.includes(actual) ? zonas : [actual, ...zonas];
}

export default async function SettingsPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();

  // Solo si la clave está configurada o no. El valor no se le manda al cliente:
  // antes venía en la fila del workspace y viajaba al navegador en cada carga.
  // Se lee con el cliente del usuario, así que la autorización de Vault aplica.
  const [hasApiKey, hasAiKey] = await Promise.all([
    hasWorkspaceSecret(supabase, workspace.id, SECRET_NAMES.zernio),
    hasWorkspaceSecret(supabase, workspace.id, SECRET_NAMES.aiGateway),
  ]);

  // F39 (00033). Si lo guardado no se puede leer, se muestra el valor por
  // defecto: guardar desde acá lo corrige.
  const zonaHoraria = zonaValida(workspace.zona_horaria) ? workspace.zona_horaria : ZONA_POR_DEFECTO;
  const horario = validarHorario(workspace.horario_atencion) ?? HORARIO_POR_DEFECTO;

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey,
        hasAiKey,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
        zonaHoraria,
        horario,
      }}
      zonas={zonasDisponibles(zonaHoraria)}
    />
  );
}
