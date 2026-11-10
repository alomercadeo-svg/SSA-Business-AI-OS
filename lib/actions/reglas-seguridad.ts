"use server";

/**
 * F33 (ítem 10 del plan maestro, 09/11/2026): guardar las reglas de seguridad
 * de secuencia de un canal de WhatsApp (`channels.safety_config`, 00055). Solo
 * Owner y Admin; se valida en el servidor y queda en el historial.
 */
import { revalidatePath } from "next/cache";
import { esManager, getWorkspaceOrNull } from "@/lib/workspace";
import { actorDe, registrarAuditoria } from "@/lib/auditoria";
import { validarConfiguracion, type ReglasDeSeguridad } from "@/lib/reglas-seguridad";
import type { Json } from "@/lib/types/database";

type Resultado = { ok: true; reglas: ReglasDeSeguridad } | { ok: false; error: string };

export async function guardarReglasDeSeguridad(canalId: string, pedido: unknown): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar las reglas de seguridad." };
  const validado = validarConfiguracion(pedido);
  if (!validado.ok) return validado;
  const { supabase, workspace, user } = contexto;

  const { data: antes } = await supabase
    .from("channels")
    .select("safety_config, display_name, username, instance_name")
    .eq("id", canalId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const { data: actualizado, error } = await supabase
    .from("channels")
    .update({ safety_config: validado.reglas as unknown as Json })
    .eq("id", canalId)
    .eq("workspace_id", workspace.id)
    .select("id")
    .maybeSingle();
  // Una política que no deja pasar el UPDATE no da error: afecta cero filas.
  if (error || !actualizado) return { ok: false, error: "No se pudo guardar: revisá la conexión y volvé a intentar." };

  const fila = antes as { safety_config?: unknown; display_name?: string | null; username?: string | null; instance_name?: string | null } | null;
  const nombre = fila?.display_name ?? fila?.username ?? fila?.instance_name ?? "WhatsApp";
  await registrarAuditoria({
    workspaceId: workspace.id,
    actor: actorDe(user),
    accion: "configuracion.cambiada",
    entidad: { tipo: "canal", id: canalId, etiqueta: `Reglas de seguridad de WhatsApp: ${nombre}` },
    cambios: { safety_config: { antes: fila?.safety_config ?? null, despues: validado.reglas } },
  });
  revalidatePath("/dashboard/settings/channels/whatsapp");
  return { ok: true, reglas: validado.reglas };
}
