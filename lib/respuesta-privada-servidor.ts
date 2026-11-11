/**
 * F40: las dependencias reales de `enviarRespuestaPrivada` (Supabase con la
 * clave de servicio y Zernio con la clave del espacio, leída de Vault por el
 * mismo camino que el resto de la app). Solo servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getZernioApiKey } from "@/lib/vault";
import { createZernioClient } from "@/lib/zernio-client";
import type { DependenciasDeRespuesta } from "@/lib/respuesta-privada";

export function dependenciasDeRespuesta(servicio: SupabaseClient<Database>): DependenciasDeRespuesta {
  let workspaceDelComentario: string | null = null;
  return {
    ahora: () => new Date(),
    async leer(id, workspaceId) {
      const { data } = await servicio
        .from("comment_logs")
        .select("id, workspace_id, post_id, platform_comment_id, comentado_at, created_at, respuesta_privada_at, channels(late_account_id)")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!data) return null;
      workspaceDelComentario = data.workspace_id;
      const canal = (data as unknown as { channels: { late_account_id: string | null } | null }).channels;
      return {
        id: data.id,
        workspaceId: data.workspace_id,
        postId: data.post_id,
        commentId: data.platform_comment_id,
        lateAccountId: canal?.late_account_id ?? null,
        comentadoAt: data.comentado_at,
        creadoAt: data.created_at,
        respuestaPrivadaAt: data.respuesta_privada_at,
      };
    },
    async reclamar(id, cuando) {
      const { data } = await servicio
        .from("comment_logs")
        .update({ respuesta_privada_at: cuando.toISOString(), respuesta_privada_error: null })
        .eq("id", id)
        .is("respuesta_privada_at", null)
        .select("id");
      return (data?.length ?? 0) > 0;
    },
    async soltar(id, error) {
      await servicio.from("comment_logs").update({ respuesta_privada_at: null, respuesta_privada_error: error }).eq("id", id);
    },
    async enviar({ postId, commentId, accountId, mensaje }) {
      const clave = workspaceDelComentario ? await getZernioApiKey(servicio as never, workspaceDelComentario) : null;
      if (!clave) throw new Error("sin clave de Zernio");
      const zernio = createZernioClient(clave);
      const res = await zernio.comments.sendPrivateReplyToComment({
        path: { postId, commentId },
        body: { accountId, message: mensaje },
      });
      if ((res as { error?: unknown }).error) throw new Error(JSON.stringify((res as { error?: unknown }).error).slice(0, 300));
      return { messageId: (res.data as { messageId?: string } | undefined)?.messageId ?? null };
    },
  };
}
