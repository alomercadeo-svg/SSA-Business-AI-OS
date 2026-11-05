/**
 * El nombre que se muestra de un contacto (F43, criterio 5), igual en la
 * bandeja, en Contactos y en la ficha.
 *
 * Cuando un contacto llega sin nombre ni usuario, el código que lo crea pone
 * su identificador de remitente en `display_name` (lib/zernio-aviso.ts:101 y
 * :109, lib/inbox-sync.ts:372, lib/evolution-guardado.ts:287 con un `@lid`):
 * 95 de 743 en @alomercadeo el 02/11/2026. Esto lo resuelve al mostrar, sin
 * escribir en ningún contacto.
 *
 * No deduce nada de la forma del nombre (requerimientos-fase1.md:620): un
 * nombre se reemplaza solo si es IGUAL a uno de los identificadores de
 * remitente guardados del propio contacto (`contact_channels`). Decidido en
 * el chat de Marcos el 05/11/2026 (D6 y D7): con usuario, «@usuario»; un
 * contacto de WhatsApp cuyo nombre es su teléfono lo conserva, porque su
 * identificador es el JID, no el teléfono.
 *
 * Sin React ni nada de servidor.
 */
export const SIN_NOMBRE = "Sin nombre";

export interface CanalParaElNombre {
  platform_sender_id: string;
  platform_username: string | null;
}

export function nombreVisible(
  contacto: { display_name: string | null },
  canales: CanalParaElNombre[] | null | undefined,
): string {
  const lista = canales ?? [];
  const nombre = contacto.display_name?.trim();
  if (nombre && !lista.some((c) => c.platform_sender_id === nombre)) return nombre;
  const usuario = lista.map((c) => c.platform_username?.trim()).find((u) => !!u);
  return usuario ? `@${usuario.replace(/^@/, "")}` : SIN_NOMBRE;
}

/** La letra del círculo: la primera, sin la @. «Sin nombre» lleva «?». */
export function inicialDe(nombre: string): string {
  if (nombre === SIN_NOMBRE) return "?";
  return nombre.replace(/^@/, "").charAt(0).toUpperCase() || "?";
}

/** El de una conversación de la bandeja, con su contacto y los canales anidados (lib/bandeja.ts). */
export function nombreDeConversacion(conversacion: {
  contacts?: { display_name: string | null; contact_channels?: CanalParaElNombre[] | null } | null;
}): string {
  const c = conversacion.contacts;
  return c ? nombreVisible(c, c.contact_channels) : SIN_NOMBRE;
}
