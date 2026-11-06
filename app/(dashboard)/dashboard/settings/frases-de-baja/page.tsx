import { getWorkspaceAsManager } from "@/lib/workspace";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { FRASES_POR_DEFECTO } from "@/lib/no-contactar";
import { FormularioDeFrases } from "./formulario";

/**
 * Configuración › Frases de baja (F34, ítem 8 del plan maestro). Solo Owner y
 * Admin: `getWorkspaceAsManager` manda a cualquier otro a la bandeja.
 */
export default async function FrasesDeBajaPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();
  const { data } = await supabase.from("workspaces").select("frases_de_baja").eq("id", workspace.id).maybeSingle();
  const frases = (data as { frases_de_baja?: string[] | null } | null)?.frases_de_baja ?? FRASES_POR_DEFECTO;

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-6 sm:px-8">
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>
      <SettingsTabs actual="frases" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:px-8">
          <p className="text-sm text-muted-foreground">
            Si un lead escribe una de estas frases, el contacto queda marcado como «No contactar»: no se le puede escribir,
            se pausan sus secuencias y queda en el historial. Se comparan sin mayúsculas ni tildes, y por palabras enteras
            («basta» marca, «bastante» no). Una frase por línea.
          </p>
          <FormularioDeFrases inicial={frases} />
        </div>
      </div>
    </div>
  );
}
