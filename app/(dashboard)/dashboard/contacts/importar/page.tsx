import { getWorkspaceAsManager } from "@/lib/workspace";
import { miembrosDelEspacio } from "@/lib/miembros";
import { ImportarContactos } from "@/components/contacts/importar-contactos";

/**
 * F37, parte 1 (09/11/2026): «Importar contactos», desde «Importar CSV» en
 * Contactos. Esta noche solo Owner y Admin (decidido por Marcos): un Member
 * vuelve al tablero, y la ruta le responde 403 igual.
 */
export default async function ImportarPage({ searchParams }: { searchParams: Promise<{ importacion?: string }> }) {
  // F37, parte 2: desde el correo de fin de importación se vuelve al resumen.
  const { importacion } = await searchParams;
  const { workspace, supabase } = await getWorkspaceAsManager();
  const [campos, miembros] = await Promise.all([
    supabase.from("custom_field_definitions").select("slug, name").eq("workspace_id", workspace.id).order("name"),
    miembrosDelEspacio(workspace.id),
  ]);
  return (
    <ImportarContactos
      camposPropios={(campos.data ?? []).map((c) => ({ slug: String(c.slug), name: String(c.name) }))}
      miembros={miembros}
      importacionInicial={typeof importacion === "string" && /^[0-9a-f-]{36}$/i.test(importacion) ? importacion : null}
    />
  );
}
