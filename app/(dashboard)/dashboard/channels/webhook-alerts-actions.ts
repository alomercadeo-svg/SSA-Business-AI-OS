"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceAsManager } from "@/lib/workspace";
import type { WebhookAlertCondition } from "@/lib/types/database";

/**
 * Cierre manual de una condición del receptor de webhooks.
 *
 * Existe porque las dos condiciones se cierran solas por caminos distintos y
 * uno de los dos puede no llegar nunca:
 *
 *   * `webhook_auth_failed` se apaga con el primer aviso válido del workspace.
 *   * `webhook_unknown_instance` se apaga con un aviso válido DE LA INSTANCIA
 *     que figura en su detalle. Si esa instancia se borró en vez de arreglarse,
 *     ese aviso no va a llegar nunca y la condición quedaría abierta para
 *     siempre, gritando por algo que ya no existe.
 *
 * Una alarma que no se puede apagar deja de ser una alarma: la próxima vez que
 * suene por algo real, nadie la va a mirar.
 *
 * La autorización la decide la base. `resolve_webhook_alert` está otorgada a
 * `authenticated` y adentro llama a `can_touch_webhook_alert`, que exige ser
 * manager del workspace de la alerta, o Owner de alguno si es una alerta de
 * sistema. Acá no se replica ese chequeo: duplicarlo invita a que las dos
 * copias se desincronicen.
 */
export async function resolverAlertaDeWebhook(formData: FormData): Promise<void> {
  const { supabase } = await getWorkspaceAsManager();

  const source = String(formData.get("source") ?? "");
  const condicion = String(formData.get("condition") ?? "") as WebhookAlertCondition;
  const workspaceId = formData.get("workspace_id");
  const detalle = formData.get("detail");

  if (!source || !condicion) return;

  const { error } = await supabase.rpc("resolve_webhook_alert", {
    p_source: source,
    p_condition: condicion,
    p_workspace_id: workspaceId ? String(workspaceId) : null,
    // Se pasa el detalle exacto de la fila que se está cerrando: si entre que
    // se pintó la pantalla y se apretó el botón llegó otro aviso con un nombre
    // de instancia distinto, esto cierra la que se vio, no otra.
    p_detail_match: detalle ? String(detalle) : null,
  });

  if (error) console.error("[webhook-alerts] no se pudo cerrar la alerta:", error.message);

  revalidatePath("/dashboard/channels");
}
