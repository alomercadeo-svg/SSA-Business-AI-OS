import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clasificarCompartido, enlaceDelCompartido, tituloDelCompartido, TITULO_MAXIMO } from "./contenido-hilo";
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

  it("el enlace: solo https y solo instagram.com; payload.url primero", () => {
    expect(enlaceDelCompartido(ADJ.reel)).toBe(ADJ.reel.payload.url);
    // 06/11/2026: el de lookaside.fbsbx.com abre solo la imagen (visto por
    // Marcos el 05/11) y el enlace armado desde ig_post_media_id no abre la
    // publicación (06/11): la publicación queda sin enlace.
    expect(enlaceDelCompartido(ADJ.publicacion)).toBeNull();
    expect(enlaceDelCompartido({ type: "share", url: "https://lookaside.fbsbx.com/a" })).toBeNull();
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

describe("el título de una publicación compartida (F44, criterio 1, reescrito el 06/11/2026)", () => {
  it("sale de payload.title, sin espacios de más", () => {
    expect(tituloDelCompartido(ADJ.publicacion)).toBe("<título de prueba>");
    expect(tituloDelCompartido({ type: "share", payload: { title: "  Hola   mundo \n" } })).toBe("Hola mundo");
  });

  it("sin título, vacío o que no es texto: nulo", () => {
    for (const a of [{ type: "share" }, { type: "share", payload: { title: "   " } }, { type: "share", payload: { title: 5 } }, null]) {
      expect(tituloDelCompartido(a)).toBeNull();
    }
  });

  it("se corta en el máximo, con «…»", () => {
    const t = tituloDelCompartido({ type: "share", payload: { title: "a".repeat(TITULO_MAXIMO + 50) } })!;
    expect(t.length).toBe(TITULO_MAXIMO);
    expect(t.endsWith("…")).toBe(true);
  });
});
