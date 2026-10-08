import { describe, it, expect } from "vitest";
import { identidadDeClave, telefonoDeJid } from "./identidad-whatsapp";

/**
 * La identidad de un remitente de WhatsApp a partir de la `key` de Evolution
 * (F26). **Con datos simulados:** las formas salen de la lectura del código de
 * Evolution 2.3.7 (`docs/investigacion-evolution-api.md`), no de un aviso real,
 * porque los entrantes recién se guardan con F27.
 */
describe("identidadDeClave", () => {
  it("un JID con teléfono: el número queda en E.164 y no hay nada pendiente", () => {
    expect(identidadDeClave({ remoteJid: "50670349182@s.whatsapp.net", addressingMode: "pn" })).toEqual({
      tipo: "persona",
      rawJid: "50670349182@s.whatsapp.net",
      addressingMode: "pn",
      telefono: "+50670349182",
      sinTelefono: false,
    });
  });

  it("un @lid que Evolution ya reemplazó: llega con teléfono y modo lid", () => {
    // Evolution pone remoteJidAlt en remoteJid antes de avisar (líneas 1477 a 1483).
    const r = identidadDeClave({ remoteJid: "50688561234@s.whatsapp.net", remoteJidAlt: "50688561234@s.whatsapp.net", addressingMode: "lid" });
    expect(r).toMatchObject({ telefono: "+50688561234", addressingMode: "lid", sinTelefono: false });
  });

  it("un @lid sin alternativa: contacto sin teléfono, con el identificador crudo intacto", () => {
    expect(identidadDeClave({ remoteJid: "123456789012345@lid", addressingMode: "lid" })).toEqual({
      tipo: "persona",
      rawJid: "123456789012345@lid",
      addressingMode: "lid",
      telefono: null,
      sinTelefono: true,
    });
  });

  it("un @lid con senderPn: el teléfono sale de ahí, y el crudo sigue siendo el @lid", () => {
    expect(identidadDeClave({ remoteJid: "999@lid", senderPn: "50670000000@s.whatsapp.net" })).toMatchObject({
      rawJid: "999@lid",
      telefono: "+50670000000",
      sinTelefono: false,
    });
  });

  it("nunca saca el teléfono del número opaco de un @lid", () => {
    expect(identidadDeClave({ remoteJid: "50670349182@lid" }).telefono).toBeNull();
  });

  it("grupos, difusiones y claves vacías no son un contacto", () => {
    expect(identidadDeClave({ remoteJid: "120363@g.us" }).tipo).toBe("grupo");
    expect(identidadDeClave({ remoteJid: "status@broadcast" }).tipo).toBe("difusion");
    expect(identidadDeClave({}).tipo).toBe("desconocido");
    expect(identidadDeClave(null).tipo).toBe("desconocido");
  });
});

describe("telefonoDeJid", () => {
  it("descarta el sufijo de dispositivo", () => {
    expect(telefonoDeJid("50670349182:12@s.whatsapp.net")).toBe("+50670349182");
  });
  it("un JID que no es de teléfono da nulo", () => {
    expect(telefonoDeJid("abc@s.whatsapp.net")).toBeNull();
    expect(telefonoDeJid("1234567890123456@s.whatsapp.net")).toBeNull();
  });
});
