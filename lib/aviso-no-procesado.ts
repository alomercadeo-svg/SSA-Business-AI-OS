/**
 * Deuda de §15 (ítem 7 de la sesión de cierre, 10/11/2026): «un aviso que
 * falla después de reclamado se pierde, en los dos receptores». Desde
 * `b4470a3` el mensaje se guarda ANTES del acuse (si falla, se libera el
 * reclamo y el proveedor reintenta). Lo que corre DESPUÉS del acuse —los
 * flujos, el comentario, el procesamiento de Evolution— fallaba solo al log, y
 * el proveedor ya recibió el 200: no reintenta.
 *
 * §15 no traía propuesta. La elegida (vetable): que quede a la vista, con la
 * alerta `aviso_no_procesado` del espacio (una por condición abierta, como las
 * demás), que se ve en Canales, deja «canal con error» en el historial y avisa
 * a Owner y Admin con el techo de F23. El detalle lo arma este código: solo la
 * etapa, nunca el cuerpo del aviso. Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function alertarAvisoNoProcesado(
  supabase: SupabaseClient,
  p: { fuente: "zernio" | "evolution"; workspaceId: string; channelId: string | null; etapa: string },
): Promise<void> {
  try {
    const { data: alertaId, error } = await supabase.rpc("record_webhook_alert", {
      p_source: p.fuente,
      p_condition: "aviso_no_procesado",
      p_workspace_id: p.workspaceId,
      p_channel_id: p.channelId,
      p_detail: `Etapa: ${p.etapa}`,
    });
    if (error || typeof alertaId !== "string") return;
    const [{ auditarAlertaSiEsNueva }, { notificarAlerta }] = await Promise.all([import("@/lib/auditoria"), import("@/lib/correo")]);
    await auditarAlertaSiEsNueva(supabase, alertaId);
    await notificarAlerta(alertaId, { servicio: supabase as never });
  } catch (err) {
    console.error("[aviso] tampoco se pudo abrir la alerta:", err instanceof Error ? err.message : String(err));
  }
}
