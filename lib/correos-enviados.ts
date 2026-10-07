/**
 * Lo que muestra la pestaña «Correos enviados» (F23, §11). Puro, sin base.
 */
import type { EmailEstado } from "@/lib/types/database";

export type TonoPastilla = "ok" | "warn" | "danger";

const ORDINAL = ["", "primer", "segundo", "tercer", "cuarto"];

/**
 * La pastilla de Estado. "Enviado al segundo intento" es la del prototipo
 * aprobado el 06/10/2026; las demás siguen la misma forma.
 */
export function estadoDeCorreo(estado: EmailEstado, intentos: number): { texto: string; tono: TonoPastilla } {
  switch (estado) {
    case "enviado":
      return intentos > 1
        ? { texto: `Enviado al ${ORDINAL[intentos] ?? `${intentos}.º`} intento`, tono: "warn" }
        : { texto: "Enviado", tono: "ok" };
    case "pendiente":
      return { texto: intentos > 0 ? "Reintentando" : "Enviando", tono: "warn" };
    case "fallido":
      return { texto: "Falló", tono: "danger" };
    default:
      // Las omisiones no se muestran (no se enviaron), pero si llegara una, que
      // no se vea como enviada.
      return { texto: "No se envió", tono: "danger" };
  }
}

/** Los estados que la pestaña muestra. Las omisiones no son correos enviados. */
export const ESTADOS_VISIBLES: EmailEstado[] = ["pendiente", "enviado", "fallido"];

/** «7 oct 15:20», en la zona del negocio. */
export function cuandoSeEnvio(iso: string, zona = "America/Costa_Rica"): string {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: zona })
    .format(d)
    .replace(".", "");
  const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zona }).format(d);
  return `${dia} ${hora}`;
}
