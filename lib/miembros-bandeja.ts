/**
 * La lista de «Asignación» de la bandeja (F35, tramo B de S8), según el rol.
 * Decidido por Marcos el 04/11/2026:
 *
 * - Owner y Admin: todo el equipo, de `miembrosDelEspacio`.
 * - Member: solo él mismo. Para un Member **no se llama a
 *   `miembrosDelEspacio`**: usa la clave de servicio y se saltea la política
 *   de `workspace_members` (00020), que a un Member le deja ver solo su propia
 *   fila. Así la página de un Member no lleva el nombre, el correo ni el id de
 *   ningún otro miembro.
 *
 * Si el equipo no se pudo leer, la bandeja no se cae: la lista queda con
 * quien mira, y el error va al registro del servidor.
 *
 * Solo para el servidor (lo usa `inbox/page.tsx`).
 */
import type { User } from "@supabase/supabase-js";
import { actorDe } from "./auditoria";
import { esManager } from "./workspace";
import { miembrosDelEspacio, type Miembro } from "./miembros";

export async function miembrosParaLaBandeja(
  rol: string,
  usuario: Pick<User, "id" | "email" | "user_metadata">,
  workspaceId: string,
  leer: (workspaceId: string) => Promise<Miembro[]> = miembrosDelEspacio,
): Promise<Miembro[]> {
  const yo = { id: usuario.id, etiqueta: actorDe(usuario).etiqueta };
  if (!esManager(rol)) return [yo];
  try {
    return await leer(workspaceId);
  } catch (e) {
    console.error("[inbox] no se pudo leer el equipo para «Asignación»:", e instanceof Error ? e.message : e);
    return [yo];
  }
}
