/**
 * F30, el borrado suave, del lado del servidor.
 *
 * DECISIÓN DE MARCOS DEL 19/10/2026: si escribe un lead que está eliminado,
 * dentro de los 30 días, el contacto se restaura solo, con «contacto
 * restaurado» en el historial y el mensaje en su conversación de siempre. El
 * lead que vuelve a escribir está activo: ocultar su mensaje sería una bandeja
 * silenciosa, y crearle otro contacto rompería la deduplicación. Después de la
 * purga ya no hay fila de canal que lo encuentre, y entra como contacto nuevo.
 *
 * El autor en el historial es el Sistema (nadie lo restauró), con la vía y el
 * canal. Lo escribe `restaurar_contacto` (00038), que acepta la vía
 * `mensaje_entrante` solo con la clave de servicio: por eso esto recibe el
 * cliente del receptor, que es el de servicio, y no pasa por la seguridad por
 * filas que le impide a un Member restaurar.
 *
 * DECISIÓN DE MARCOS DEL 20/10/2026: un saliente del negocio (desde la app de
 * Instagram o desde el teléfono) a un lead eliminado también lo restaura, con
 * la vía `mensaje_saliente`. Si el negocio le escribe, el lead está activo; sin
 * restaurarlo, la conversación queda oculta y la purga borra justo esos
 * mensajes.
 *
 * La importación del historial no restaura: no es nadie escribiendo ahora.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Restaura el contacto si está eliminado. Devuelve true si lo restauró. Tira si falla. */
export type ViaDeRestauracion = "mensaje_entrante" | "mensaje_saliente";

export async function restaurarSiEliminado(
  servicio: SupabaseClient,
  contactId: string,
  canalId: string,
  via: ViaDeRestauracion = "mensaje_entrante",
): Promise<boolean> {
  const { data, error } = await servicio.from("contacts").select("deleted_at").eq("id", contactId).maybeSingle();
  if (error) throw new Error(`contacts: ${error.message}`);
  if (!(data as { deleted_at?: string | null } | null)?.deleted_at) return false;
  const { error: errRpc } = await servicio.rpc("restaurar_contacto", {
    p_contacto: contactId,
    p_via: via,
    p_canal: canalId,
  });
  if (errRpc) throw new Error(`restaurar_contacto: ${errRpc.message}`);
  return true;
}

/** Cuántos días quedan para la purga (30 desde que se eliminó), nunca menos de 0. */
export const DIAS_DE_RETENCION = 30;

export function diasParaLaPurga(deletedAt: string, ahora: Date = new Date()): number {
  const vence = new Date(deletedAt).getTime() + DIAS_DE_RETENCION * 86_400_000;
  return Math.max(0, Math.ceil((vence - ahora.getTime()) / 86_400_000));
}
