import { getWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";
import { MarcoDeLaApp } from "@/components/marco-de-la-app";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user, supabase } = await getWorkspace();

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, slug)")
    .eq("user_id", user.id);

  const workspaces = (memberships ?? [])
    .map((m) => ({
      ...(m.workspaces as { id: string; name: string; slug: string }),
      role: m.role,
    }))
    .filter((w) => w.id);

  return (
    // F35, criterio del teléfono: en el teléfono el menú es una barra arriba
    // (columna); desde `md`, a la izquierda (fila). `h-dvh` y no `h-screen`:
    // en el teléfono, 100vh incluye la barra del navegador y corta el campo
    // de escritura. En el teléfono, además, el marco sigue a la parte visible
    // con el teclado abierto (retrabajo del ítem 4, 06/11/2026). `min-w-0`:
    // lo de adentro no ensancha la página.
    <MarcoDeLaApp>
      <Sidebar workspace={workspace} user={user} workspaces={workspaces} />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </MarcoDeLaApp>
  );
}
