/**
 * La identidad de un remitente de WhatsApp, a partir de la `key` que manda
 * Evolution (F26).
 *
 * **Hoy no la llama ningún camino.** El receptor de Evolution no guarda nada
 * (`lib/evolution-processor.ts`); el primer llamador es F27, al guardar cada
 * entrante: de acá salen `contact_channels.raw_jid` y `addressing_mode`,
 * `messages.remote_jid` y el teléfono del contacto, o la marca de "teléfono sin
 * resolver" cuando no hay número.
 *
 * Lo que hace Evolution, verificado en su código (`docs/investigacion-evolution-
 * api.md`, «El identificador de contacto puede no ser un teléfono»):
 *   - WhatsApp puede direccionar a un contacto por un LID, `<opaco>@lid`, que
 *     no contiene el teléfono.
 *   - Si Baileys trae `remoteJidAlt`, Evolution reemplaza el `remoteJid` por
 *     ese JID con teléfono ANTES de mandarnos el aviso, y `addressingMode`
 *     queda en `lid`.
 *   - Si no lo trae, el `remoteJid` llega como `@lid` y el teléfono no está en
 *     ningún lado. No hay endpoint para resolverlo.
 *
 * Reglas de acá:
 *   - `rawJid` es el `remoteJid` tal como llegó, sin transformar.
 *   - El teléfono sale solo de un JID `@s.whatsapp.net` (o de `senderPn`), y
 *     pasa por la normalización de §14. Nunca de un `@lid`, nunca del nombre.
 *   - Los grupos (`@g.us`) y las difusiones (`@broadcast`) no son un contacto.
 */
import { normalizarTelefono } from "@/lib/telefono";

export interface ClaveEvolution {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  addressingMode?: string | null;
  senderPn?: string | null;
  participant?: string | null;
}

export interface IdentidadWhatsApp {
  /** Qué es: una persona, o algo que no es un contacto. */
  tipo: "persona" | "grupo" | "difusion" | "desconocido";
  /** El `remoteJid` tal como llegó. */
  rawJid: string | null;
  /** `pn`, `lid` u otro valor que mande Evolution; nulo si no vino. */
  addressingMode: string | null;
  /** E.164, o nulo si el aviso no trae el número. */
  telefono: string | null;
  /** Llegó por un `@lid` sin el número: "teléfono sin resolver". */
  sinTelefono: boolean;
}

/** Los dígitos de un JID con teléfono: `50670349182:12@s.whatsapp.net` → `+50670349182`. */
export function telefonoDeJid(jid: string | null | undefined): string | null {
  if (typeof jid !== "string") return null;
  const m = jid.trim().match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return m ? normalizarTelefono(`+${m[1]}`) : null;
}

export function identidadDeClave(clave: ClaveEvolution | null | undefined): IdentidadWhatsApp {
  const rawJid = typeof clave?.remoteJid === "string" && clave.remoteJid.trim() ? clave.remoteJid.trim() : null;
  const addressingMode = typeof clave?.addressingMode === "string" && clave.addressingMode ? clave.addressingMode : null;

  if (!rawJid) return { tipo: "desconocido", rawJid: null, addressingMode, telefono: null, sinTelefono: false };
  if (rawJid.endsWith("@g.us")) return { tipo: "grupo", rawJid, addressingMode, telefono: null, sinTelefono: false };
  if (rawJid.endsWith("@broadcast")) return { tipo: "difusion", rawJid, addressingMode, telefono: null, sinTelefono: false };

  const telefono =
    telefonoDeJid(rawJid) ?? telefonoDeJid(clave?.remoteJidAlt) ?? telefonoDeJid(clave?.senderPn);
  const esLid = rawJid.endsWith("@lid");
  if (!esLid && !rawJid.endsWith("@s.whatsapp.net")) {
    return { tipo: "desconocido", rawJid, addressingMode, telefono, sinTelefono: false };
  }
  return { tipo: "persona", rawJid, addressingMode, telefono, sinTelefono: telefono === null };
}
