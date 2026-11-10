import { describe, it, expect } from "vitest";
import { toqueDelAviso, type AvisoDeMensajeZernio } from "./zernio-aviso";

/**
 * F25, `last_click` en Instagram (ítem 3 de la sesión de cierre). Zernio manda
 * la referencia del anuncio en `metadata.referral` del primer mensaje después
 * del clic (`@zernio/node` 0.2.519, `dist/index.d.ts:7743-7790`): `ad_id`,
 * `ref`, `source` y `type` en Instagram CTD. **La forma real no se vio nunca**:
 * esto sigue a los tipos.
 */
const base = (metadata?: Record<string, unknown>, extra: Partial<AvisoDeMensajeZernio["message"]> = {}): AvisoDeMensajeZernio =>
  ({
    event: "message.received",
    message: { id: "m1", platformMessageId: "p1", direction: "incoming", text: "hola", sentAt: "2026-11-10T20:00:00.000Z", sender: { id: "s1" }, ...extra },
    conversation: { id: "c1" },
    account: { id: "a1", platform: "instagram" },
    metadata,
  }) as unknown as AvisoDeMensajeZernio;

describe("toqueDelAviso", () => {
  it("un mensaje con la referencia de un anuncio arma el toque, con el canal y la hora de Meta", () => {
    expect(toqueDelAviso(base({ referral: { ad_id: "120200", ref: "promo-nov", source: "ADS", type: "OPEN_THREAD" } }))).toEqual({
      ad_id: "120200",
      campaign: "promo-nov",
      source: "ADS",
      channel: "instagram",
      captured_at: "2026-11-10T20:00:00.000Z",
    });
  });
  it("control: un mensaje sin referencia no es un clic", () => {
    expect(toqueDelAviso(base())).toBeNull();
    expect(toqueDelAviso(base({ referral: {} }))).toBeNull();
  });
  it("un saliente (eco del negocio) nunca es un toque del lead", () => {
    expect(toqueDelAviso({ ...base({ referral: { ad_id: "1" } }), event: "message.sent" })).toBeNull();
  });
});
