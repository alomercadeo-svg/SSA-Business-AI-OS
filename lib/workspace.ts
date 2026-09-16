import { cache } from "react";
import { WORKSPACE_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const WORKSPACE_COOKIE = "zernflow_workspace_id";

/**
 * Resolución del workspace activo. Único lugar del proyecto donde se decide
 * sobre qué workspace opera una request.
 *
 * Antes había cinco copias de esta lógica: esta y una en cada ruta de
 * `api/v1/channels`. Las cuatro de las rutas ignoraban la cookie y las cinco
 * cerraban con `.limit(1).single()` **sin `order by`**. Postgres no garantiza
 * orden sin `order by`, así que la consulta podía devolver un workspace
 * distinto en cada llamada: el dashboard y la API podían estar operando sobre
 * workspaces distintos al mismo tiempo, y dos llamadas seguidas a la misma ruta
 * podían discrepar. Con un solo usuario y un solo workspace no se nota; con un
 * Member invitado, que además tiene el workspace propio que le crea el trigger
 * de registro, sí.
 *
 * Orden de resolución:
 *   1. La cookie de workspace, si apunta a uno donde el usuario es miembro.
 *   2. La membresía más reciente, con desempate por id.
 *
 * Por qué la más reciente y no la más antigua: al registrarse, el trigger
 * `handle_new_user` le crea a todo usuario su propio workspace. Un invitado
 * queda entonces con dos membresías, y la del workspace real es la más nueva.
 * La más antigua lo mandaría siempre a su workspace fantasma vacío. Es una
 * heurística mientras exista ese workspace de más; el arreglo de fondo es que
 * el registro por invitación no lo cree.
 */
async function resolveWorkspace() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  if (selectedId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select(`workspace_id, role, workspaces(${WORKSPACE_PUBLIC_COLUMNS})`)
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .maybeSingle();

    if (membership?.workspaces) {
      return {
        user,
        workspace: membership.workspaces,
        role: membership.role,
        supabase,
      };
    }
  }

  // Sin cookie válida: la membresía más reciente. El segundo `order` es el
  // desempate que hace la consulta determinística aunque dos membresías
  // compartan `created_at`.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select(`workspace_id, role, workspaces(${WORKSPACE_PUBLIC_COLUMNS})`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("workspace_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.workspaces) return null;

  return {
    user,
    workspace: membership.workspaces,
    role: membership.role,
    supabase,
  };
}

export type WorkspaceContext = NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>>;

/**
 * Para Server Components y páginas: redirige a /login cuando no hay sesión o el
 * usuario no pertenece a ningún workspace.
 *
 * Cacheada por request: deduplica entre el layout y la página del mismo render.
 */
export const getWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const contexto = await resolveWorkspace();
  if (!contexto) redirect("/login");
  return contexto;
});

/**
 * Para API routes: devuelve null en lugar de redirigir, para que el handler
 * responda 401 en JSON. Una redirección a /login desde un endpoint de API le
 * llega al cliente como HTML donde esperaba datos.
 *
 * Sin `cache()` a propósito: un route handler la llama una sola vez por
 * request, así que no habría nada que deduplicar.
 */
export async function getWorkspaceOrNull(): Promise<WorkspaceContext | null> {
  return resolveWorkspace();
}

/** Roles que pueden configurar el workspace: Owner y Admin. */
export function esManager(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Para páginas que solo puede abrir un Owner o un Admin.
 *
 * Manda al Member a /dashboard en lugar de renderizar. La guarda va en el
 * servidor y no en el componente porque estas páginas leen datos que la RLS no
 * frena: `settings/team` arma el listado del equipo con el service client y
 * resuelve cada email contra `auth.users`. Esconder los botones en el cliente
 * deja el dato igual en el HTML.
 *
 * Cacheada por request, igual que getWorkspace().
 */
export const getWorkspaceAsManager = cache(async (): Promise<WorkspaceContext> => {
  const contexto = await resolveWorkspace();
  if (!contexto) redirect("/login");
  if (!esManager(contexto.role)) redirect("/dashboard");
  return contexto;
});

/**
 * Para API routes que solo puede usar un Owner o un Admin.
 *
 * Devuelve el contexto, o la respuesta de error ya armada para que el handler
 * la retorne. El rol lo resuelve el servidor a partir de la sesión: nunca sale
 * de nada que mande el cliente.
 *
 * Distingue 401 de 403 a propósito. 401 es "no sé quién sos", que el cliente
 * resuelve volviendo a entrar; 403 es "sé quién sos y no alcanza", que no se
 * arregla reintentando.
 */
export async function requireManager(): Promise<
  | { contexto: WorkspaceContext; error: null }
  | { contexto: null; error: NextResponse }
> {
  const contexto = await resolveWorkspace();

  if (!contexto) {
    return {
      contexto: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!esManager(contexto.role)) {
    return {
      contexto: null,
      error: NextResponse.json(
        { error: "Requiere rol de Owner o Admin" },
        { status: 403 }
      ),
    };
  }

  return { contexto, error: null };
}
