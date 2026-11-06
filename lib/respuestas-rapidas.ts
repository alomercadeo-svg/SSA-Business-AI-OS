/**
 * F36, Respuestas rápidas (ítem 6 del plan maestro, 06/11/2026). En la
 * interfaz se llaman «Respuestas rápidas», nunca «plantillas»: las plantillas
 * de WhatsApp son otra cosa (plan B).
 *
 * Lo que no depende de la base ni de la pantalla: interpolar las variables,
 * filtrar por nombre o atajo, reconocer la «/» mientras se escribe y validar
 * lo que se guarda (la base repite los mismos límites en sus `check`, 00052).
 */
export interface RespuestaRapida {
  id: string;
  nombre: string;
  atajo: string;
  contenido: string;
}

export interface DatosParaInterpolar {
  contacto?: { display_name?: string | null; email?: string | null; phone?: string | null } | null;
  espacio?: { name?: string | null } | null;
}

/** Las cuatro variables del criterio de F36 (auditoría #88b). */
export const VARIABLES = ["{{contact.display_name}}", "{{contact.email}}", "{{contact.phone}}", "{{workspace.name}}"] as const;

/** Reemplaza las cuatro variables; si un dato falta, queda vacío. Las demás llaves quedan como están. */
export function interpolar(texto: string, datos: DatosParaInterpolar): string {
  const valor = (v: string | null | undefined) => (typeof v === "string" ? v : "");
  return texto.replace(/\{\{\s*(contact\.display_name|contact\.email|contact\.phone|workspace\.name)\s*\}\}/g, (_, clave: string) => {
    switch (clave) {
      case "contact.display_name":
        return valor(datos.contacto?.display_name);
      case "contact.email":
        return valor(datos.contacto?.email);
      case "contact.phone":
        return valor(datos.contacto?.phone);
      default:
        return valor(datos.espacio?.name);
    }
  });
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Por nombre o atajo, sin mayúsculas ni tildes. Sin texto, todas. */
export function filtrarRespuestas(lista: RespuestaRapida[], consulta: string): RespuestaRapida[] {
  const q = normal(consulta.trim());
  if (!q) return lista;
  return lista.filter((r) => normal(r.atajo).includes(q) || normal(r.nombre).includes(q));
}

export interface Barra {
  /** Dónde está la «/» en el texto. */
  desde: number;
  /** Lo escrito después de la «/», hasta el cursor. */
  consulta: string;
}

/**
 * La «/» que abre el selector: al principio o después de un espacio, y sin
 * espacios entre ella y el cursor. Una barra dentro de una palabra
 * («http://», «a/b») no lo abre.
 */
export function barraEn(texto: string, cursor: number): Barra | null {
  const antes = texto.slice(0, cursor);
  const m = antes.match(/(^|\s)\/([^\s/]*)$/);
  if (!m) return null;
  return { desde: antes.length - m[2].length - 1, consulta: m[2] };
}

/** Reemplaza «/consulta» por el contenido elegido; el cursor queda al final de lo insertado. */
export function aplicarRespuesta(texto: string, barra: Barra, contenido: string): { texto: string; cursor: number } {
  const fin = barra.desde + 1 + barra.consulta.length;
  return { texto: texto.slice(0, barra.desde) + contenido + texto.slice(fin), cursor: barra.desde + contenido.length };
}

export const LARGO_NOMBRE = 80;
export const LARGO_CONTENIDO = 2000;

/** Lo que se guarda: el nombre y el contenido sin espacios en los bordes; el atajo en minúsculas, sin «/». */
export function validarRespuesta(entrada: { nombre: string; atajo: string; contenido: string }):
  | { ok: true; valor: { nombre: string; atajo: string; contenido: string } }
  | { ok: false; error: string } {
  const nombre = (entrada.nombre ?? "").trim();
  const atajo = (entrada.atajo ?? "").trim().replace(/^\//, "").toLowerCase();
  const contenido = (entrada.contenido ?? "").trim();
  if (!nombre) return { ok: false, error: "Poné un nombre." };
  if (nombre.length > LARGO_NOMBRE) return { ok: false, error: `El nombre puede tener hasta ${LARGO_NOMBRE} caracteres.` };
  if (!/^[a-z0-9_-]{1,30}$/.test(atajo)) return { ok: false, error: "El atajo va en minúsculas, sin espacios: letras, números, «-» o «_», hasta 30." };
  if (!contenido) return { ok: false, error: "Escribí el texto de la respuesta." };
  if (contenido.length > LARGO_CONTENIDO) return { ok: false, error: `El texto puede tener hasta ${LARGO_CONTENIDO} caracteres.` };
  return { ok: true, valor: { nombre, atajo, contenido } };
}

/** Las flechas en el selector: dan la vuelta. Con la lista vacía, se queda en 0. */
export function moverEleccion(actual: number, total: number, tecla: "ArrowDown" | "ArrowUp"): number {
  if (total <= 0) return 0;
  return tecla === "ArrowDown" ? (actual + 1) % total : (actual - 1 + total) % total;
}
