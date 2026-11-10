/**
 * F42: contestar por WhatsApp desde la bandeja. Los textos y la regla de la
 * sesión que comparten la ruta de envío (`app/api/v1/messages/route.ts`) y el
 * hilo (`components/inbox/message-thread.tsx`).
 *
 * Sin React ni nada de servidor.
 */
import type { SesionEstado } from "@/lib/types/database";

/** El texto del criterio de F42 (campo deshabilitado). */
export const AVISO_WHATSAPP_DESCONECTADO =
  "WhatsApp no está conectado. Los mensajes no pueden salir ni entrar por este canal hasta reconectarlo.";

/** Evolution respondió con un error (decisión de la revisión del 09/11/2026, vetable). */
export const AVISO_WHATSAPP_RECHAZO = "No se envió: WhatsApp rechazó el mensaje.";

/** Evolution no respondió en 15 s (decisión de la revisión del 09/11/2026, vetable). */
export const AVISO_WHATSAPP_SIN_RESPUESTA =
  "WhatsApp no respondió a tiempo. Si el mensaje salió, va a aparecer en el hilo en unos segundos.";

/**
 * Si con ese estado de la sesión no se intenta enviar: caída, intentos
 * agotados o sin vincular (criterio de F42). «No se pudo verificar»
 * (`sin_verificar`) sí intenta: no es una caída, igual que en el aviso de F32
 * (decidido por Marcos el 09/11/2026).
 */
export function sesionImpideEnviar(estado: SesionEstado | string | null | undefined): boolean {
  return estado === "caido" || estado === "agotado" || estado === "sin_vincular";
}
