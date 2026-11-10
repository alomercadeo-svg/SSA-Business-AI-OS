/**
 * F32 y F31 (ítem 3 de la sesión de cierre, 10/11/2026): lo que pasa cuando la
 * sesión de WhatsApp pasa a «caído» o «se agotaron los intentos». El correo a
 * Owner y Admin (F23, como antes) y, desde hoy, una entrada «canal con error»
 * en el historial de auditoría, que F31 pide para «canal con error».
 *
 * Lo llaman el receptor de Evolution y la tarea programada, después de guardar
 * el estado (`registrarLectura` solo escribe en la base, a propósito).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarAuditoria } from "@/lib/auditoria";
import { notificarSesionWhatsapp } from "@/lib/correo";
import type { Transicion } from "@/lib/sesion-whatsapp";

export async function alCambiarLaSesion(t: Transicion, opciones: { servicio: SupabaseClient }): Promise<void> {
  if (!t.avisar) return;
  // No lanza: `registrarAuditoria` registra su propio fallo, y el correo tiene que salir igual.
  await registrarAuditoria({
    workspaceId: t.workspaceId,
    actor: null,
    accion: "canal.error",
    entidad: { tipo: "canal", id: t.canalId },
    detalle: { sesion: t.a, antes: t.de },
  });
  await notificarSesionWhatsapp(t, { servicio: opciones.servicio as never });
}
