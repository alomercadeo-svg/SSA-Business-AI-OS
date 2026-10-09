"use server";

/**
 * El límite de silencio de un canal (F39), desde Configuración, Vigilancia de
 * canales. Solo Owner y Admin: lo controla este `if` en el servidor y, en la
 * base, la política de UPDATE de `channels` (00019). Vacío = el canal no se
 * vigila (`umbral_silencio_horas` nulo, 00033).
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { actorDe, etiquetaDeCanal, registrarAuditoria } from "@/lib/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarUmbral(canalId: string, valor: string): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar la vigilancia de canales." };
  const { supabase, workspace, user } = contexto;

  const texto = String(valor ?? "").trim();
  let umbral: number | null = null;
  if (texto !== "") {
    if (!/^\d+$/.test(texto) || Number(texto) <= 0) {
      return { ok: false, error: "El límite tiene que ser un número entero de horas mayor que 0, o quedar vacío para no vigilar el canal." };
    }
    umbral = Number(texto);
  }

  const { data: canal } = await supabase
    .from("channels")
    .select("id, platform, username, display_name, instance_name, umbral_silencio_horas")
    .eq("id", canalId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!canal) return { ok: false, error: "No se encontró el canal." };
  if (canal.umbral_silencio_horas === umbral) return { ok: true };

  const { data: actualizado, error } = await supabase
    .from("channels")
    .update({ umbral_silencio_horas: umbral })
    .eq("id", canalId)
    .eq("workspace_id", workspace.id)
    .select("id")
    .maybeSingle();
  // Una política que no deja pasar el UPDATE no da error: afecta cero filas.
  if (error || !actualizado) return { ok: false, error: "No se pudo guardar: revisá la conexión y volvé a intentar." };

  await registrarAuditoria({
    workspaceId: workspace.id,
    actor: actorDe(user),
    accion: "configuracion.cambiada",
    entidad: { tipo: "canal", id: canalId, etiqueta: `Vigilancia de canales: ${etiquetaDeCanal(canal)}` },
    cambios: { umbral_silencio_horas: { antes: canal.umbral_silencio_horas, despues: umbral } },
  });
  revalidatePath("/dashboard/settings/vigilancia");
  return { ok: true };
}
