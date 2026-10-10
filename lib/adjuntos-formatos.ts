/**
 * Los formatos de archivo que F28 acepta, y cómo se reconocen por su
 * contenido. ES LA ÚNICA LISTA: el detector la usa, y `allowed_mime_types`
 * del bucket `message-media` (migración 00034) tiene que ser igual. Un test
 * (`lib/adjuntos-formatos.test.ts`) falla si difieren.
 *
 * El tipo sale de los primeros bytes del archivo, no de la extensión ni de lo
 * que diga el proveedor (criterio de F28). Lo que no se reconoce no se guarda.
 *
 * Un MP4 con solo audio (la nota de voz de Instagram, inferencia sin
 * verificar) y uno con video tienen la misma cabecera: distinguirlos pide leer
 * las pistas del archivo. Acá solo `M4A ` y `M4B ` se reconocen como audio; el
 * resto de los `ftyp` de MP4 queda como `video/mp4`.
 */

export interface Formato {
  mime: string;
  ext: string;
}

export const FORMATOS_PERMITIDOS: readonly Formato[] = [
  { mime: "image/jpeg", ext: "jpg" },
  { mime: "image/png", ext: "png" },
  { mime: "image/gif", ext: "gif" },
  { mime: "image/webp", ext: "webp" },
  { mime: "image/heic", ext: "heic" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/quicktime", ext: "mov" },
  { mime: "video/webm", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/mpeg", ext: "mp3" },
  { mime: "audio/ogg", ext: "ogg" },
  { mime: "audio/aac", ext: "aac" },
  { mime: "application/pdf", ext: "pdf" },
];

/** Cuántos bytes del principio hacen falta para reconocer cualquiera de la lista. */
export const BYTES_PARA_DETECTAR = 16;

function empieza(b: Uint8Array, firma: readonly number[], desde = 0): boolean {
  if (b.length < desde + firma.length) return false;
  return firma.every((x, i) => b[desde + i] === x);
}

function ascii(b: Uint8Array, desde: number, largo: number): string {
  return String.fromCharCode(...b.subarray(desde, desde + largo));
}

/** El formato por los primeros bytes, o null si no es uno de la lista. */
export function detectarFormato(bytes: Uint8Array): Formato | null {
  const mime = mimePorContenido(bytes);
  return FORMATOS_PERMITIDOS.find((f) => f.mime === mime) ?? null;
}

function mimePorContenido(b: Uint8Array): string | null {
  if (empieza(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (empieza(b, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(b, 0, 3) === "ID3") return "audio/mpeg";
  // Cabecera de trama: 12 bits en 1. Con la capa en 00 es AAC (ADTS); con otra
  // capa, MP3.
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf0) === 0xf0) {
    return (b[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  if (ascii(b, 4, 4) === "ftyp") {
    const marca = ascii(b, 8, 4);
    if (marca === "qt  ") return "video/quicktime";
    if (marca === "M4A " || marca === "M4B ") return "audio/mp4";
    if (marca === "heic" || marca === "heix" || marca === "mif1") return "image/heic";
    return "video/mp4";
  }
  return null;
}
