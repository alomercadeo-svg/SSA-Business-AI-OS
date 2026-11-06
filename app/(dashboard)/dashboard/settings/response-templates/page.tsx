import { getWorkspaceAsManager } from "@/lib/workspace";
import { RespuestasRapidasView } from "./respuestas-view";

/**
 * Configuración › Respuestas rápidas (F36, criterio 1). Solo Owner y Admin: la
 * guarda es `getWorkspaceAsManager`, en el servidor, y un Member que entra por
 * la dirección vuelve a /dashboard sin que se lea nada. La base dice lo mismo
 * para escribir (00052); leer, lo puede cualquier miembro, para usarlas con
 * «/» en la bandeja.
 */
export const dynamic = "force-dynamic";

export default async function RespuestasRapidasPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();
  const { data, error } = await supabase
    .from("response_templates")
    .select("id, nombre, atajo, contenido")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("nombre");
  if (error) {
    // Lo atrapa `error.tsx` del dashboard, con la pantalla de error de §11.1.
    console.error("respuestas rápidas: no se pudo leer response_templates:", error.message);
    throw new Error("No se pudieron leer las respuestas rápidas.");
  }
  return <RespuestasRapidasView respuestas={data ?? []} />;
}
