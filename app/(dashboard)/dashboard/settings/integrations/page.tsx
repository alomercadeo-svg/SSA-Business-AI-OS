import { getWorkspaceAsManager } from "@/lib/workspace";
import { getWorkspaceSecret } from "@/lib/vault";
import { aTarjeta, definicionDe, filasPorDefecto, type FilaIntegracion } from "@/lib/integraciones";
import { IntegrationsView } from "./integrations-view";

/**
 * Pantalla de integraciones (F24). Solo Owner y Admin: la guarda es
 * `getWorkspaceAsManager`, en el servidor, y un Member que entre por la
 * dirección vuelve a /dashboard sin que se lea nada.
 *
 * La pantalla se arma leyendo `integration_configs`. Las filas del catálogo se
 * crean si faltan; una fila que no está en el catálogo igual se muestra.
 *
 * Las claves se leen acá, en el servidor, solo para saber si existen y para
 * calcular el largo y los últimos cuatro. Al navegador no viaja ninguna.
 */
export default async function IntegrationsPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();
  const workspaceId = workspace.id as string;

  await supabase
    .from("integration_configs")
    .upsert(filasPorDefecto(workspaceId), { onConflict: "workspace_id,proveedor", ignoreDuplicates: true });

  const { data: filas, error } = await supabase
    .from("integration_configs")
    .select("id, tipo, proveedor, nombre, orden, config, estado, verificado_el, ultimo_error")
    .eq("workspace_id", workspaceId)
    .order("orden");

  if (error) {
    // El caso esperable es que falte la migración 00024. Se dice así, sin el
    // error técnico crudo, que igual queda en el log del servidor.
    console.error("integraciones: no se pudo leer integration_configs:", error.message);
    return <IntegrationsView workspaceId={workspaceId} tarjetas={[]} cuentasInstagram={[]} errorDeCarga />;
  }

  const tarjetas = await Promise.all(
    (filas as FilaIntegracion[]).map(async (f) => {
      const d = definicionDe(f.proveedor, f.tipo, f.nombre);
      const valor = await getWorkspaceSecret(supabase, workspaceId, d.secreto);
      return aTarjeta(f, valor);
    })
  );

  const { data: cuentas } = await supabase
    .from("channels")
    .select("id, username, is_active")
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .eq("provider", "zernio")
    .order("created_at");

  return (
    <IntegrationsView
      workspaceId={workspaceId}
      tarjetas={tarjetas}
      cuentasInstagram={(cuentas ?? []).map((c) => ({ id: c.id, username: c.username ?? "", activa: c.is_active }))}
    />
  );
}
