import { describe, it, expect } from "vitest";
import { aplicarToque, toqueDe } from "./atribucion";

/**
 * La atribución de F25: `first_click` una sola vez, `last_click` en cada
 * interacción con parámetros. Hoy no la llama ningún camino: el primero es F27,
 * con el aviso de Evolution de un click-to-WhatsApp. Esto es la lógica, probada
 * con datos simulados; la base además frena sobrescribir `first_click` (00029).
 */
const cuando = "2026-10-07T12:00:00Z";

describe("toqueDe", () => {
  it("una interacción sin parámetros de seguimiento no es un toque", () => {
    expect(toqueDe({ cuando })).toBeNull();
    expect(toqueDe({ canal: "whatsapp", cuando })).toBeNull();
  });

  it("lee los utm de la URL y de los parámetros sueltos", () => {
    expect(toqueDe({ url: "https://x.com/?utm_source=meta&utm_campaign=octubre", canal: "instagram", cuando })).toMatchObject({
      source: "meta",
      campaign: "octubre",
      channel: "instagram",
      referral_url: "https://x.com/?utm_source=meta&utm_campaign=octubre",
    });
  });

  it("un click-to-WhatsApp registra el anuncio como origen", () => {
    expect(toqueDe({ adId: "120210", ctwaClid: "abc", sourceType: "ad", canal: "whatsapp", cuando })).toEqual({
      ad_id: "120210",
      ctwa_clid: "abc",
      source: "ad",
      channel: "whatsapp",
      captured_at: cuando,
    });
  });
});

describe("aplicarToque", () => {
  const primero = { source: "meta", captured_at: "2026-10-01T00:00:00Z" };
  const segundo = { source: "google", captured_at: "2026-10-05T00:00:00Z" };

  it("el primer toque es first_click y last_click", () => {
    expect(aplicarToque({}, primero)).toEqual({ first_click: primero, last_click: primero });
  });

  it("los siguientes solo mueven last_click: first_click no se toca", () => {
    expect(aplicarToque({ first_click: primero, last_click: primero }, segundo)).toEqual({
      first_click: primero,
      last_click: segundo,
    });
  });

  it("sin toque, la atribución queda igual", () => {
    const a = { first_click: primero, last_click: primero };
    expect(aplicarToque(a, null)).toEqual(a);
    expect(aplicarToque(null, null)).toEqual({});
  });
});
