import { describe, it, expect } from "vitest";
import { agruparPorCanal, enlaceAlHilo, fechaSinHora, horaDelNegocio, textoDeToque, type ConversacionDeFicha } from "./ficha";

describe("la ficha (F30)", () => {
  it("la hora va en la zona de Costa Rica, no en la del servidor (20:40 UTC son las 14:40)", () => {
    const t = horaDelNegocio("2026-10-19T20:40:00Z");
    expect(t).toContain("14:40");
    expect(t).not.toContain("20:40");
    expect(horaDelNegocio(null)).toBe("—");
  });

  it("una fecha sin hora no se corre de día por la zona", () => {
    expect(fechaSinHora("2026-11-03")).toMatch(/^3 nov\.? 2026$/);
    expect(fechaSinHora(null)).toBe("Sin fecha");
  });

  it("agrupa por canal, con el grupo de la conversación más reciente primero", () => {
    const canal = (id: string, platform: string) => ({ id, platform, username: `cuenta-${id}`, display_name: null, instance_name: null });
    const conv = (id: string, canalId: string, platform: string, cuando: string): ConversacionDeFicha => ({
      id, channel_id: canalId, status: "open", last_message_at: cuando, last_message_preview: null, channels: canal(canalId, platform),
    });
    const grupos = agruparPorCanal(
      [conv("a", "ig", "instagram", "2026-10-01T00:00:00Z"), conv("b", "wa", "whatsapp", "2026-10-05T00:00:00Z"), conv("c", "ig", "instagram", "2026-10-03T00:00:00Z")],
      (c) => `${c.platform} @${c.username}`,
    );
    expect(grupos.map((g) => [g.etiqueta, g.conversaciones.map((c) => c.id)])).toEqual([
      ["whatsapp @cuenta-wa", ["b"]],
      ["instagram @cuenta-ig", ["c", "a"]],
    ]);
  });

  it("el origen en una línea, y el enlace al hilo", () => {
    expect(textoDeToque({ source: "meta", medium: "cpc", campaign: "verano", captured_at: "2026-10-01T15:00:00Z" })).toMatch(/^meta \/ cpc · campaña verano · /);
    expect(textoDeToque(undefined)).toBe("Sin datos");
    expect(enlaceAlHilo("abc")).toBe("/dashboard/inbox?conversacion=abc");
  });
});

describe("el resumen de una conversación en la ficha (lectura de Marcos del 20/10/2026)", () => {
  it("sin texto en el resumen, muestra el tipo del último mensaje, no «Sin mensajes»", async () => {
    const { resumenDeConversacion } = await import("./ficha");
    expect(resumenDeConversacion("", "video")).toBe("Video");
    expect(resumenDeConversacion(null, "imagen")).toBe("Foto");
    expect(resumenDeConversacion("", "audio")).toBe("Audio");
    expect(resumenDeConversacion("", "otro")).toBe("Adjunto");
  });
  it("con texto, el texto; y «Sin mensajes» solo si de verdad no tiene", async () => {
    const { resumenDeConversacion } = await import("./ficha");
    expect(resumenDeConversacion("hola", "texto")).toBe("hola");
    expect(resumenDeConversacion("", null)).toBe("Sin mensajes");
  });
});
