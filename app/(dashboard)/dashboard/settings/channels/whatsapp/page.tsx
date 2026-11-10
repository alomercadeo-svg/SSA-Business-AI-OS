import { getWorkspaceAsManager } from "@/lib/workspace";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { leerConfiguracion } from "@/lib/reglas-seguridad";
import { FormularioDeReglas } from "./formulario";

/**
 * Configuración › Reglas de WhatsApp (F33, ítem 10 del plan maestro;
 * `/settings/channels/whatsapp` de §11). Solo Owner y Admin:
 * `getWorkspaceAsManager` manda a cualquier otro a la bandeja. Una tarjeta por
 * canal de WhatsApp por Evolution. El motor que aplica las reglas es de la
 * Fase 2: acá se configuran.
 */
export default async function ReglasDeWhatsappPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();
  const { data } = await supabase
    .from("channels")
    .select("id, display_name, username, instance_name, safety_config")
    .eq("workspace_id", workspace.id)
    .eq("platform", "whatsapp")
    .eq("provider", "evolution")
    .order("created_at");
  const canales = (data ?? []) as { id: string; display_name: string | null; username: string | null; instance_name: string | null; safety_config: unknown }[];

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-6 sm:px-8">
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>
      <SettingsTabs actual="whatsapp" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-8">
          <p className="text-sm text-muted-foreground">
            Las reglas que protegen el número de WhatsApp de un bloqueo. Las aplican los seguimientos automáticos, que llegan con
            la Fase 2: lo que guardes acá es lo que van a respetar.
          </p>
          {canales.length === 0 ? (
            <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Todavía no hay un canal de WhatsApp conectado. Conectalo en Canales y las reglas aparecen acá.
            </p>
          ) : (
            canales.map((c) => (
              <FormularioDeReglas
                key={c.id}
                canalId={c.id}
                nombre={c.display_name ?? c.username ?? c.instance_name ?? "WhatsApp"}
                inicial={leerConfiguracion(c.safety_config)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
