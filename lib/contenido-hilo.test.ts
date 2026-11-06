import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clasificarCompartido, enlaceDelCompartido } from "./contenido-hilo";
import { seDescarga } from "./adjuntos";

/**
 * F44, criterios 1 y 2: un compartido o un reel se reconocen por el aviso, sin
 * bajar nada. Con las claves reales del 05/11/2026 (`lib/fixtures/zernio-adjuntos-f44.json`).
 */
const ADJ = JSON.parse(readFileSync(new URL("./fixtures/zernio-adjuntos-f44.json", import.meta.url), "utf8"));

describe("el clasificador de compartidos (F44)", () => {
  it("las tres formas reales: publicación, reel y video de la cámara", () => {
    expect(clasificarCompartido(ADJ.publicacion)).toBe("publicacion");
    expect(clasificarCompartido(ADJ.reel)).toBe("reel");
    expect(clasificarCompartido(ADJ.videoDeCamara)).toBeNull();
  });

  it("un reel se reconoce por cualquiera de sus tres marcas", () => {
    expect(clasificarCompartido({ type: "video", originalType: "ig_reel" })).toBe("reel");
    expect(clasificarCompartido({ type: "video", payload: { reel_video_id: "1" } })).toBe("reel");
    expect(clasificarCompartido({ type: "video", url: "https://www.instagram.com/reel/x/" })).toBe("reel");
    expect(clasificarCompartido({ type: "video", url: "https://instagram.com/reel/x/" })).toBe("reel");
  });

  it("una foto, un ephemeral, un adjunto vacío o nada: no es compartido", () => {
    for (const a of [{ type: "image", url: "https://lookaside.fbsbx.com/x" }, { type: "ephemeral" }, {}, null, undefined, "x"]) {
      expect(clasificarCompartido(a)).toBeNull();
    }
  });

  it("el enlace: solo https y solo los tres hosts de la lista; payload.url primero", () => {
    expect(enlaceDelCompartido(ADJ.publicacion)).toBe(ADJ.publicacion.payload.url);
    expect(enlaceDelCompartido(ADJ.reel)).toBe(ADJ.reel.payload.url);
    expect(enlaceDelCompartido({ type: "share", url: "https://lookaside.fbsbx.com/a" })).toBe("https://lookaside.fbsbx.com/a");
    expect(enlaceDelCompartido({ type: "share", url: "http://www.instagram.com/p/x" })).toBeNull();
    expect(enlaceDelCompartido({ type: "share", url: "https://ejemplo.com/p/x" })).toBeNull();
    expect(enlaceDelCompartido({ type: "share", url: "https://www.instagram.com.ejemplo.com/p/x" })).toBeNull();
    expect(enlaceDelCompartido({ type: "share", url: "javascript:alert(1)" })).toBeNull();
    expect(enlaceDelCompartido({ type: "share", url: "no es una dirección" })).toBeNull();
  });
});

describe("seDescarga con un reel (F44, criterio 2)", () => {
  it("el reel no se marca para bajar; el video de la cámara sí", () => {
    expect(seDescarga({ direction: "inbound", messageType: "video", attachments: [ADJ.reel] })).toBe(false);
    expect(seDescarga({ direction: "inbound", messageType: "video", attachments: [ADJ.videoDeCamara] })).toBe(true);
  });
});
