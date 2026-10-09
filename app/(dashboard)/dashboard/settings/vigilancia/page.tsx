import { getWorkspaceAsManager } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { hasWorkspaceSecret, SECRET_NAMES } from "@/lib/vault";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { etiquetaDeCanal } from "@/lib/auditoria";
import { haceCuanto, marcaVencida, marcaVisible } from "@/lib/tareas-estado";
import { claveDeVigilancia } from "@/lib/tareas-programadas";
import { textoDeSuscripcion, type ResultadoSuscripcion } from "@/lib/vigilancia-suscripcion";
import { cn } from "@/lib/utils";
import { UmbralCanal } from "./umbral-canal";

/**
 * Configuración › Vigilancia de canales (F39, §11). Solo Owner y Admin: la
 * guarda es `getWorkspaceAsManager`, en el servidor.
 *
 * - La tabla de canales sale del cliente del usuario (la RLS de `channels`).
 * - La marca de última ejecución y lo leído de la suscripción salen de
 *   `tareas_estado`, que no tiene políticas (solo la clave de servicio, 00032):
 *   se lee con el cliente de servicio DESPUÉS del control de rol de arriba.
 * - La marca que se muestra es `ultimo_ok_at` (`marcaVisible`), en rojo a los
 *   30 minutos (`marcaVencida`). `ultima_ejecucion_at` no se muestra: se mueve
 *   también cuando la corrida falla.
 */
export const dynamic = "force-dynamic";

const ZONA_PANTALLA = "America/Costa_Rica";
const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-CR", { dateStyle: "short", timeStyle: "short", timeZone: ZONA_PANTALLA }).format(new Date(iso));

export default async function VigilanciaPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();
  const servicio = await createServiceClient();

  const [{ data: canales, error }, { data: tarea }, tieneZernio] = await Promise.all([
    supabase
      .from("channels")
      .select("id, platform, username, display_name, instance_name, is_active, last_inbound_at, umbral_silencio_horas")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true }),
    servicio
      .from("tareas_estado")
      .select("ultima_ejecucion_at, ultimo_ok_at, ultimo_error, resultado")
      .eq("clave", claveDeVigilancia(workspace.id))
      .maybeSingle(),
    hasWorkspaceSecret(supabase, workspace.id, SECRET_NAMES.zernio),
  ]);

  if (error) {
    console.error("vigilancia: no se pudo leer channels:", error.message);
    throw new Error("No se pudieron leer los canales.");
  }

  const ahora = new Date();
  const marca = marcaVisible(tarea);
  const vencida = marcaVencida(tarea, ahora);
  const resultado = (tarea?.resultado ?? {}) as { suscripcion?: ResultadoSuscripcion | "sin_clave" };
  const suscripcion = resultado.suscripcion ?? (tieneZernio ? null : "sin_clave");
  const textoSuscripcion = textoDeSuscripcion(suscripcion);
  const leida = suscripcion && suscripcion !== "sin_clave" && !suscripcion.error ? suscripcion : null;

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>
      <SettingsTabs actual="vigilancia" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
          <p className="text-sm text-muted-foreground">
            Si un canal pasa más horas hábiles sin recibir mensajes que su límite, se abre una alerta y se avisa por
            correo a Owner y Admin.
          </p>

          {!canales || canales.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Todavía no hay canales conectados en este espacio.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Canal</th>
                    <th className="px-4 py-2 font-medium">Límite de silencio</th>
                    <th className="px-4 py-2 font-medium">Último mensaje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {canales.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        {etiquetaDeCanal(c)}
                        {!c.is_active && <span className="ml-2 text-xs text-muted-foreground">(inactivo: no se vigila)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <UmbralCanal canalId={c.id} inicial={c.umbral_silencio_horas} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.last_inbound_at ? haceCuanto(c.last_inbound_at, ahora) : "Todavía no recibió mensajes"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            className={cn(
              "space-y-1 rounded-lg border px-4 py-3 text-sm",
              vencida
                ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                : "border-border bg-muted/30",
            )}
          >
            <p className="font-medium">
              {marca ? `Última revisión: ${haceCuanto(marca, ahora)}` : "La revisión todavía no corrió nunca."}
            </p>
            <p className={vencida ? "" : "text-muted-foreground"}>
              Si esta hora deja de avanzar, significa que nadie está vigilando los canales.
            </p>
            {vencida && tarea?.ultimo_error && (
              <p className="text-xs">La última corrida falló: {tarea.ultimo_error}</p>
            )}
          </div>

          <div
            className={cn(
              "space-y-1 rounded-lg border px-4 py-3 text-sm",
              textoSuscripcion.tono === "error"
                ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                : "border-border bg-muted/30",
            )}
          >
            <p className="font-medium">{textoSuscripcion.titulo}</p>
            {leida && (
              <p className="text-xs text-muted-foreground">
                Leídos: {leida.eventos.length ? leida.eventos.join(", ") : "ninguno"}
                {leida.leida_el ? ` · el ${hora(leida.leida_el)}` : ""}
                {leida.activo === false ? " · el webhook figura inactivo en Zernio" : ""}
              </p>
            )}
            {suscripcion && suscripcion !== "sin_clave" && suscripcion.error && suscripcion.leida_el && (
              <p className="text-xs">Intento del {hora(suscripcion.leida_el)}.</p>
            )}
            <p className={textoSuscripcion.tono === "error" ? "" : "text-muted-foreground"}>
              Si falta alguno, se abre una alerta que dice cuál.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
