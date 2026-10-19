import { createServiceClient } from "@/lib/supabase/server";
import { actorDe } from "@/lib/auditoria";

export interface Miembro {
  id: string;
  etiqueta: string;
}

/**
 * Los miembros del espacio, con su nombre o su correo, para los desplegables
 * de setter y vendedor (F41) y para validar a quién se asigna.
 *
 * Va con la clave de servicio, como la pantalla de Equipo: la policy de
 * `workspace_members` le devuelve a cada usuario solo su propia fila, y los
 * nombres viven en `auth.users`. Quien llama ya comprobó que el usuario es del
 * espacio (`getWorkspace` o la RLS del contacto).
 */
export async function miembrosDelEspacio(workspaceId: string): Promise<Miembro[]> {
  const servicio = await createServiceClient();
  const { data: filas, error } = await servicio
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`workspace_members: ${error.message}`);
  const miembros = await Promise.all(
    (filas ?? []).map(async ({ user_id }) => {
      const { data } = await servicio.auth.admin.getUserById(user_id);
      return { id: user_id, etiqueta: data?.user ? actorDe(data.user).etiqueta : user_id };
    }),
  );
  return miembros.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
}
