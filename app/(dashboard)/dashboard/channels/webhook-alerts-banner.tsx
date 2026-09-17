import { AlertTriangle } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WebhookAlertCondition } from "@/lib/types/database";
import { resolverAlertaDeWebhook } from "./webhook-alerts-actions";

/**
 * Aviso de condiciones abiertas del receptor de webhooks.
 *
 * POR QUÉ ESTÁ EN ESTA PANTALLA
 * Una tabla que nadie consulta es un diario, no una alerta. Este es el lugar
 * donde alguien va a mirar cuando sospeche que algo no está entrando.
 *
 * ── DE DÓNDE SALE CADA FILA, Y POR QUÉ SON DOS CONSULTAS ────────────────────
 *
 * Las condiciones se leen por dos caminos distintos porque tienen dueños
 * distintos:
 *
 *   * **Las del workspace** (`webhook_auth_failed`) se leen con el cliente del
 *     usuario. La RLS de la 00022 las autoriza para Owner y Admin de ese
 *     workspace, así que la base decide y acá no hace falta nada más.
 *
 *   * **Las de sistema** (`webhook_unknown_instance`, con `workspace_id` nulo)
 *     NO tienen policy de lectura: nadie las lee por RLS. Se leen con el cliente
 *     de servicio y una guarda de rol explícita, del lado del servidor.
 *
 * La asimetría no es comodidad. La 00022 había resuelto esto con una función
 * `is_any_workspace_owner()` que se contradecía con su propio motivo: decía que
 * una instancia desconocida no es atribuible a ningún workspace, y después
 * dejaba que cualquier Owner de cualquier workspace la leyera. Hoy no se nota
 * porque hay un solo workspace, pero el esquema del fork es multi-tenant, y el
 * `detail` lleva el nombre de una instancia que en ese escenario sería de otro
 * despliegue. La 00023 borró esa función.
 *
 * Este componente corre solo en el servidor, así que el cliente de servicio
 * nunca cruza al navegador.
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

/**
 * El recuento, y por qué dice cosas distintas según la condición.
 *
 * En `webhook_auth_failed` un incremento ES un mensaje perdido: el 401 está en
 * la lista de códigos que cancelan los reintentos de Evolution, así que ese
 * evento no vuelve nunca.
 *
 * En `webhook_unknown_instance` NO. Ahí devolvemos 503, que sí se reintenta
 * hasta diez veces, así que el mismo mensaje puede haber golpeado el endpoint
 * varias veces y el número cuenta intentos de entrega, no mensajes. Además la
 * condición tiene un tope de una actualización por minuto (00023), así que el
 * número es un piso y no un total. Decir "mensajes perdidos" ahí sería
 * directamente falso: todavía no se perdió ninguno.
 */
function recuento(alerta: Alerta): string {
  if (alerta.alert_condition === "webhook_unknown_instance") {
    return alerta.occurrences === 1
      ? "1 intento de entrega rechazado"
      : `${alerta.occurrences} intentos de entrega rechazados`;
  }
  return alerta.occurrences === 1 ? "1 mensaje perdido" : `${alerta.occurrences} mensajes perdidos`;
}

export async function WebhookAlertsBanner({
  supabase,
  workspaceId,
  esOwner,
}: {
  /** Cliente del usuario: la RLS decide qué ve de su propio workspace. */
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  /**
   * Resuelto por la página contra la sesión. Es la guarda que reemplaza a la
   * policy que borró la 00023: las alertas de sistema solo las ve el Owner.
   */
  esOwner: boolean;
}) {
  const { data: delWorkspace } = await supabase
    .from("webhook_alerts")
    .select(COLUMNAS)
    .eq("workspace_id", workspaceId)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false })
    .returns<Alerta[]>();

  let deSistema: Alerta[] = [];
  if (esOwner) {
    // Sin policy de lectura, así que va por el cliente de servicio. La
    // autorización es el `if` de arriba, resuelto en el servidor.
    const servicio = await createServiceClient();
    const { data } = await servicio
      .from("webhook_alerts")
      .select(COLUMNAS)
      .is("workspace_id", null)
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false })
      .returns<Alerta[]>();
    deSistema = data ?? [];
  }

  const alertas = [...(delWorkspace ?? []), ...deSistema];
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

            {/*
              EL NOMBRE DE INSTANCIA ES TEXTO NO CONFIABLE: lo elige quien llama
              al webhook. React escapa el contenido, así que no hay inyección de
              HTML, pero quedan dos problemas reales y los dos se resuelven acá:

                1. Romper el layout con una cadena larga sin espacios. Por eso
                   `break-all`, además del `left(detail, 200)` de la 00023.
                2. Hacerse pasar por texto de la interfaz, con algo como
                   "ssa-whatsapp — contactá a soporte en este link". Por eso el
                   nombre va SIEMPRE dentro de su propio <code>, y la frase de la
                   interfaz queda afuera: el mensaje no se arma interpolando el
                   nombre en una oración.
            */}
            {alerta.alert_condition === "webhook_unknown_instance" ? (
              <div className="mt-1 space-y-1 text-sm text-red-800 dark:text-red-200">
                <p>Los mensajes llegaron para esta conexión:</p>
                <code className="block break-all rounded bg-red-100 px-1.5 py-1 font-mono text-xs dark:bg-red-900/50">
                  {alerta.detail ?? "(sin nombre)"}
                </code>
                <p>
                  No figura en ningún canal activo. Suele pasar cuando se renombra la conexión
                  en Evolution y el canal queda apuntando al nombre viejo.
                </p>
                <p className="font-medium">
                  Todavía no se perdió ningún mensaje: se están reintentando durante unos 20
                  minutos. Corregí el nombre antes de que se agoten.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-red-800 dark:text-red-200">
                Los mensajes llegan pero no se pueden verificar, así que se descartan. Casi
                siempre es un cambio de secreto a medio hacer: revisá que el secreto configurado
                en Evolution sea el mismo que está guardado en Vault. Mientras esto siga, cada
                mensaje nuevo se pierde.
              </p>
            )}

            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              {recuento(alerta)}
              {" · desde el "}
              {cuando(alerta.first_seen_at)}
              {" · el último, "}
              {cuando(alerta.last_seen_at)}
            </p>
          </div>

          {/*
            El cierre manual no es una comodidad: para la condición de conexión
            desconocida es el ÚNICO cierre que existe. La 00023 le sacó el cierre
            automático porque dependía de que el `detail` coincidiera, y el
            `detail` guarda el nombre de la última instancia desconocida, no el
            de la que causó el problema.
          */}
          <form action={resolverAlertaDeWebhook} className="shrink-0 self-start">
            <input type="hidden" name="source" value={alerta.source} />
            <input type="hidden" name="condition" value={alerta.alert_condition} />
            {alerta.workspace_id && (
              <input type="hidden" name="workspace_id" value={alerta.workspace_id} />
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
