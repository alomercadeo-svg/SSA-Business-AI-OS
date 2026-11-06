/**
 * F34, lo que puede usar también el navegador (sin nada del servidor): las
 * frases por defecto, el aviso del bloqueo y la detección. La marca, con la
 * base y el historial, está en `lib/no-contactar.ts`.
 */
export const FRASES_POR_DEFECTO: string[] = [
  "no me escribas más",
  "dejá de mandar mensajes",
  "no quiero recibir mensajes",
  "stop",
  "unsubscribe",
  "basta",
  "no me contactes",
];

/** Lo que ve quien intenta escribirle a un marcado. Sin opción de forzarlo. */
export const AVISO_NO_CONTACTAR = "Este contacto pidió no recibir más mensajes. No se le puede escribir.";

function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function fraseDeBaja(texto: string | null | undefined, frases: readonly string[]): string | null {
  if (!texto) return null;
  const mensaje = ` ${normalizar(texto)} `;
  if (mensaje.trim() === "") return null;
  for (const frase of frases) {
    const f = normalizar(frase ?? "");
    if (f && mensaje.includes(` ${f} `)) return frase;
  }
  return null;
}
