/**
 * F34, ítem 8 del plan maestro (06/11/2026): no contactar.
 *
 * - `fraseDeBaja`: si un mensaje del lead trae una frase de baja del espacio
 *   (`workspaces.frases_de_baja`, 00053). Sin mayúsculas, sin tildes y por
 *   palabras enteras: «basta» marca, «bastante» no.
 * - `marcarSiPideBaja`: lo llaman los dos receptores (Zernio y Evolution) por
 *   `alEscribirElLead` (lib/estado-por-mensaje.ts), con el mensaje ya
 *   guardado: marca el contacto con el motivo y la fecha, pausa sus
 *   secuencias activas y lo deja en el historial. Una sola vez: si ya estaba
 *   marcado, no hace nada.
 *
 * Revertir es solo de Owner y Admin, y lo hace cumplir la base (disparador
 * de la 00053). Que un marcado nunca entre a una secuencia, también.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarAuditoria } from "./auditoria";

import { fraseDeBaja, FRASES_POR_DEFECTO } from "./no-contactar-texto";

export { AVISO_NO_CONTACTAR, fraseDeBaja, FRASES_POR_DEFECTO } from "./no-contactar-texto";

/** Devuelve si marcó. Tira si no pudo marcar (el proveedor reintenta). */
export async function marcarSiPideBaja(
  supabase: SupabaseClient,
  { workspaceId, contactId, texto }: { workspaceId: string; contactId: string; texto: string | null | undefined },
): Promise<boolean> {
  if (!texto) return false;
  const { data: ws, error: errWs } = await supabase.from("workspaces").select("frases_de_baja").eq("id", workspaceId).maybeSingle();
  // Si la lista no se pudo leer, las del criterio: perder una baja es peor.
  const lista = (ws as { frases_de_baja?: string[] | null } | null)?.frases_de_baja;
  const frases = !errWs && Array.isArray(lista) ? lista : FRASES_POR_DEFECTO;
  const frase = fraseDeBaja(texto, frases);
  if (!frase) return false;

  const { data: marcado, error } = await supabase
    .from("contacts")
    .update({ do_not_contact: true, do_not_contact_reason: `Escribió «${frase}»`, do_not_contact_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .eq("do_not_contact", false)
    .select("id, display_name");
  if (error) throw new Error(`contacts: ${error.message}`);
  const fila = (marcado as { id: string; display_name: string | null }[] | null)?.[0];
  if (!fila) return false;

  const { error: errSec } = await supabase
    .from("sequence_enrollments")
    .update({ status: "paused" })
    .eq("contact_id", contactId)
    .eq("status", "active");
  if (errSec) throw new Error(`sequence_enrollments: ${errSec.message}`);

  await registrarAuditoria({
    workspaceId,
    actor: null,
    accion: "contacto.no_contactar",
    entidad: { tipo: "contacto", id: fila.id, etiqueta: fila.display_name },
    detalle: { frase, via: "mensaje" },
  });
  return true;
}
