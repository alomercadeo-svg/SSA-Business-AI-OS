"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceAsManager } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import type { WebhookAlertCondition } from "@/lib/types/database";

/**
 * Cierre manual de una condición del receptor de webhooks.
 *
 * ── POR QUÉ ES IMPRESCINDIBLE, Y NO UNA COMODIDAD ───────────────────────────
 *
 * Para `webhook_unknown_instance` este es el ÚNICO cierre que existe. La 00023
 * le sacó el cierre automático porque dependía de que el `detail` coincidiera
 * con la instancia del aviso, y el `detail` guarda el nombre de la ÚLTIMA
 * instancia desconocida, no el de la que causó el problema: con tres nombres,
 * arreglar el que rompía de verdad no cerraba nada, y un nombre basura posterior
 * lo desactivaba para siempre.
 *
 * `webhook_auth_failed` sí se cierra sola cuando entra un aviso válido de ese
 * workspace, pero también se puede cerrar acá.
 *
 * ── QUIÉN AUTORIZA, Y POR QUÉ HAY DOS CAMINOS ───────────────────────────────
 *
 * Las dos clases de alerta tienen dueños distintos, así que se cierran distinto:
 *
 *   * **Con workspace:** va con el cliente del usuario. `resolve_webhook_alert`
 *     llama por dentro a `can_touch_webhook_alert`, que exige ser manager de ese
 *     workspace. La base decide y acá no se replica el chequeo: duplicarlo
 *     invita a que las dos copias se desincronicen.
 *
 *   * **De sistema** (`workspace_id` nulo): desde la 00023,
 *     `can_touch_webhook_alert(null)` solo acepta `service_role`. Así que va con
 *     el cliente de servicio, detrás de una guarda de rol explícita en el
 *     servidor. Es la contraparte de cómo se leen en el banner, y el motivo es
 *     el mismo: esa fila no es atribuible a ningún workspace, así que su
 *     autorización no puede colgarse de la membresía a uno.
 */
export async function resolverAlertaDeWebhook(formData: FormData): Promise<void> {
  const { supabase, role, workspace } = await getWorkspaceAsManager();

  const source = String(formData.get("source") ?? "");
  const condicion = String(formData.get("condition") ?? "") as WebhookAlertCondition;
  const workspaceId = formData.get("workspace_id");

  if (!source || !condicion) return;

  // El `workspace_id` del formulario no se usa como autorización: se compara
  // contra el workspace de la sesión. Un formulario editado no puede cerrar la
  // alerta de otro workspace.
  const esDeSistema = !workspaceId;
  const destino = esDeSistema ? null : workspace.id;

  if (esDeSistema && role !== "owner") return;

  const cliente = esDeSistema ? await createServiceClient() : supabase;

  const { error } = await cliente.rpc("resolve_webhook_alert", {
    p_source: source,
    p_condition: condicion,
    p_workspace_id: destino,
    // Sin `p_detail_match`: la condición de sistema agrupa todas las instancias
    // desconocidas en una fila, así que cerrar "la del detalle" no significa
    // nada. Se cierra la condición entera, que es lo que la persona está
    // diciendo al apretar el botón.
    p_detail_match: null,
  });

  if (error) console.error("[webhook-alerts] no se pudo cerrar la alerta:", error.message);

  revalidatePath("/dashboard/channels");
}
