"use server";

/**
 * Acciones de servidor de la pantalla de Canales.
 *
 * `activarCanal` es la única escritura de `is_active` que queda en esa
 * pantalla, y solo en una dirección: encender. Apagar un canal es una
 * desconexión de hecho, porque los dos receptores rechazan los mensajes de un
 * canal inactivo (Zernio recibe 404; Evolution, 503 y después de unos 20
 * minutos de reintentos el mensaje se pierde). Se quitó de la interfaz el
 * 05/10/2026. Encender sí hace falta: la sincronización con Zernio puede
 * apagar un canal sola, y ningún camino lo vuelve a encender (ver F24 en el
 * plano).
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { actorDe, etiquetaDeCanal, registrarAuditoria } from "@/lib/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function activarCanal(channelId: string): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden activar canales." };
  const workspaceId = contexto.workspace.id;
  if (!workspaceId) return { ok: false, error: "No se pudo resolver el espacio de trabajo." };

  const { data, error } = await contexto.supabase
    .from("channels")
    .update({ is_active: true })
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .select("id, platform, username, display_name, instance_name");
  if (error) return { ok: false, error: "No se pudo activar el canal." };
  if (!data?.length) return { ok: false, error: "No se encontró ese canal." };

  await registrarAuditoria({
    workspaceId,
    actor: actorDe(contexto.user),
    accion: "canal.conectado",
    entidad: { tipo: "canal", id: data[0].id, etiqueta: etiquetaDeCanal(data[0]) },
    detalle: { origen: "activado_a_mano" },
  });

  revalidatePath("/dashboard/channels");
  return { ok: true };
}
