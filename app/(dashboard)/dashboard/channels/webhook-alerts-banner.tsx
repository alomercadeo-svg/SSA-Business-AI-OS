import { AlertTriangle } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WebhookAlertCondition } from "@/lib/types/database";
import { resolverAlertaDeWebhook } from "./webhook-alerts-actions";

/**
 * Aviso de condiciones abiertas del receptor de webhooks.
 *
 * POR QUÉ ESTÁ EN ESTA PANTALLA Y NO EN OTRA
 * Una tabla que nadie consulta es un diario, no una alerta. Este es el lugar
 * donde alguien va a mirar cuando sospeche que algo no está entrando, así que
 * es donde la condición tiene que ser visible.
 *
 * QUÉ SIGNIFICA QUE ESTO APAREZCA
 * Que estamos perdiendo mensajes, no que hubo un error recuperable. Verificado
 * en el código de Evolution 2.3.7: los códigos 401 y 404 están en la lista por
 * defecto de códigos que cancelan los reintentos, así que cada aviso rechazado
 * se descarta sin segunda oportunidad. Por eso el texto no dice "hubo un
 * problema": dice cuántos mensajes se perdieron y desde cuándo.
 *
 * Lee con el cliente del usuario, no con el de servicio, así que la RLS de la
 * 00022 decide qué ve cada uno: las condiciones del workspace las ven sus
 * managers, y la de instancia desconocida, que no tiene workspace al que
 * atribuirse, solo el Owner.
 */

type Alerta = Pick<
  Database["public"]["Tables"]["webhook_alerts"]["Row"],
  | "id"
  | "workspace_id"
  | "source"
  | "alert_condition"
  | "detail"
  | "occurrences"
  | "first_seen_at"
  | "last_seen_at"
>;

const COLUMNAS =
  "id, workspace_id, source, alert_condition, detail, occurrences, first_seen_at, last_seen_at";

/** Zona horaria del negocio, según las decisiones transversales del plano. */
const ZONA = "America/Costa_Rica";

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONA,
  }).format(new Date(iso));
}

function titulo(condicion: WebhookAlertCondition): string {
  switch (condicion) {
    case "webhook_auth_failed":
      return "WhatsApp está rechazando los mensajes que llegan";
    case "webhook_unknown_instance":
      return "Están llegando mensajes de una conexión que no reconocemos";
    default:
      return "El receptor de mensajes reportó un problema";
  }
}

function queHacer(alerta: Alerta): string {
  switch (alerta.alert_condition) {
    case "webhook_auth_failed":
      return (
        "Los mensajes llegan pero no se pueden verificar, así que se descartan. " +
        "Casi siempre es un cambio de secreto a medio hacer: revisá que el secreto " +
        "configurado en Evolution sea el mismo que está guardado en Vault. Mientras " +
        "esto siga, cada mensaje nuevo se pierde."
      );
    case "webhook_unknown_instance":
      return (
        `Llegaron mensajes para la conexión "${alerta.detail ?? "sin nombre"}", que no ` +
        "figura en ningún canal activo. Suele pasar cuando se renombra la conexión en " +
        "Evolution y el canal queda apuntando al nombre viejo. Corregí el nombre para " +
        "que vuelvan a entrar."
      );
    default:
      return "Revisá la configuración del canal de WhatsApp.";
  }
}

export async function WebhookAlertsBanner({
  supabase,
}: {
  supabase: SupabaseClient<Database>;
}) {
  const { data } = await supabase
    .from("webhook_alerts")
    .select(COLUMNAS)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false })
    .returns<Alerta[]>();

  const alertas = data ?? [];
  if (alertas.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {alertas.map((alerta) => (
        <div
          key={alerta.id}
          className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />

          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-900 dark:text-red-100">
              {titulo(alerta.alert_condition)}
            </p>

            <p className="mt-1 text-sm text-red-800 dark:text-red-200">
              {queHacer(alerta)}
            </p>

            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              {alerta.occurrences === 1
                ? "1 mensaje perdido"
                : `${alerta.occurrences} mensajes perdidos`}
              {" · desde el "}
              {cuando(alerta.first_seen_at)}
              {" · el último, "}
              {cuando(alerta.last_seen_at)}
            </p>
          </div>

          {/* El cierre manual existe porque la condición de conexión
              desconocida solo se apaga sola con un mensaje válido de esa misma
              conexión, y si la conexión se borró en vez de arreglarse, ese
              mensaje no llega nunca. */}
          <form action={resolverAlertaDeWebhook} className="shrink-0 self-start">
            <input type="hidden" name="source" value={alerta.source} />
            <input type="hidden" name="condition" value={alerta.alert_condition} />
            {alerta.workspace_id && (
              <input type="hidden" name="workspace_id" value={alerta.workspace_id} />
            )}
            {alerta.detail && (
              <input type="hidden" name="detail" value={alerta.detail} />
            )}
            <button
              type="submit"
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/40"
            >
              Ya lo resolví
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
