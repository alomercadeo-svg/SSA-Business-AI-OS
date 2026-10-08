import { History } from "lucide-react";
import { getWorkspaceAsManager } from "@/lib/workspace";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { cuandoSeEnvio } from "@/lib/correos-enviados";
import { textoDeEvento } from "@/lib/auditoria";

/**
 * Configuración › Historial de cambios (F31, §11). Solo Owner y Admin, como
 * toda la pantalla: la guarda es `getWorkspaceAsManager`, en el servidor.
 *
 * La lectura usa el cliente del usuario, así que la RLS de `audit_log` (00028)
 * decide qué filas vuelven: Owner y Admin, todo el espacio; un Member, solo sus
 * propias acciones. Un Member no llega a esta pestaña, pero la regla vale igual
 * para cualquier otra lectura: está en la base, no acá.
 *
 * Se muestran los últimos 200 eventos. El historial no se borra nunca, así que
 * crece; paginar es una mejora para cuando haga falta, no un hueco de F31.
 */
export default async function HistorialDeCambiosPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();

  const { data: eventos, error } = await supabase
    .from("audit_log")
    .select("id, created_at, actor_label, action, entity_label, changes, detail")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // Lo atrapa `error.tsx`, con la pantalla de error de §11.1.
  if (error) {
    console.error("historial de cambios: no se pudo leer audit_log:", error.message);
    throw new Error("No se pudo leer el historial de cambios.");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>
      <SettingsTabs actual="historial" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-8">
          {!eventos || eventos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <History className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Todavía no hay cambios registrados.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Acá va a quedar quién hizo qué y cuándo: contactos nuevos, cambios en el equipo, en las integraciones y en
                los canales.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Cuándo</th>
                    <th className="px-4 py-2 font-medium">Quién</th>
                    <th className="px-4 py-2 font-medium">Qué cambió</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((e) => (
                    <tr key={e.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{cuandoSeEnvio(e.created_at)}</td>
                      <td className="px-4 py-2">{e.actor_label}</td>
                      <td className="px-4 py-2">{textoDeEvento(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            El historial no se borra nunca. Un Member ve solo sus propias acciones.
          </p>
        </div>
      </div>
    </div>
  );
}
