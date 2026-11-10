/**
 * F37, parte 1 (09/11/2026): leer una planilla CSV y preparar cada fila para
 * importarla como contacto. Sin React ni nada de servidor: lo usan la pantalla
 * (vista previa y mapeo) y la ruta `POST /api/v1/contacts/importar`, que
 * vuelve a preparar cada fila en el servidor (el teléfono se normaliza ahí).
 *
 * Sin librería: un lector de CSV (RFC 4180) chico, con lo que pidió la
 * revisión de Marcos: coma o punto y coma (Excel en español guarda con punto
 * y coma), la marca BOM de UTF-8 al principio, comillas, comillas dobles
 * escapadas y saltos de línea dentro de comillas.
 */
import { normalizarTelefono } from "./telefono";

export const MAX_FILAS_PARTE_1 = 500;
export const MAX_BYTES = 10 * 1024 * 1024;

export interface Planilla {
  separador: "," | ";";
  columnas: string[];
  filas: string[][];
}

/** El separador de la planilla: el que más aparece en la primera línea, fuera de comillas. */
export function detectarSeparador(texto: string): "," | ";" {
  let comas = 0;
  let puntoYComas = 0;
  let enComillas = false;
  for (const c of texto.replace(/^\uFEFF/, "")) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === "\n" || c === "\r")) break;
    else if (!enComillas && c === ",") comas++;
    else if (!enComillas && c === ";") puntoYComas++;
  }
  return puntoYComas > comas ? ";" : ",";
}

export function leerCsv(texto: string): Planilla {
  const limpio = texto.replace(/^\uFEFF/, "");
  const separador = detectarSeparador(limpio);
  const registros: string[][] = [];
  let registro: string[] = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === separador) {
      registro.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      registro.push(campo);
      registros.push(registro);
      registro = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || registro.length > 0) {
    registro.push(campo);
    registros.push(registro);
  }
  const conDatos = registros.filter((r) => r.some((v) => v.trim() !== ""));
  const [columnas = [], ...filas] = conDatos;
  return { separador, columnas: columnas.map((c) => c.trim()), filas };
}

/** A qué campo va cada columna. */
export type Campo =
  | "nombre"
  | "correo"
  | "telefono"
  | "pipedrive"
  | "setter"
  | "vendedor"
  | "etiquetas"
  // F38 (10/11/2026): el estado comercial que viene de Pipedrive, ya aplanado
  // por `scripts/pipedrive-unir.mjs`, y una nota del contacto.
  | "etapa"
  | "estado_trato"
  | "valor"
  | "moneda"
  | "fecha_cierre"
  | "pipedrive_trato"
  | "nota"
  | `campo:${string}`
  | "no_importar";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** El campo sugerido para un encabezado (paso 2 de §11). Los campos propios se sugieren por nombre o por su `slug`. */
export function sugerirCampo(encabezado: string, camposPropios: { slug: string; name: string }[] = []): Campo {
  const e = sinTildes(encabezado).replace(/[^a-z0-9]+/g, " ").trim();
  // F38: antes que el id de persona («Id de trato de Pipedrive» también dice
  // «pipedrive») y antes que el nombre («Nota del contacto» dice «contacto»).
  if (/\b(deal id|id de trato|trato id)\b/.test(e)) return "pipedrive_trato";
  if (/^(nota|notas|nota del contacto)( \d+)?$/.test(e)) return "nota";
  if (/^(etapa|stage|etapa del trato)$/.test(e)) return "etapa";
  if (/^(estado|estado del trato|status)$/.test(e)) return "estado_trato";
  if (/^(valor|valor del trato|value)$/.test(e)) return "valor";
  if (/^(moneda|currency)$/.test(e)) return "moneda";
  if (/^(fecha de cierre|cierre|close date)$/.test(e)) return "fecha_cierre";
  if (/\b(person id|pipedrive|id de pipedrive|id pipedrive)\b/.test(e)) return "pipedrive";
  if (/\b(e mail|email|correo|mail)\b/.test(e)) return "correo";
  if (/\b(telefono|tel|celular|movil|phone|whatsapp)\b/.test(e)) return "telefono";
  if (/\b(nombre|name|contacto)\b/.test(e)) return "nombre";
  if (/\bsetter\b/.test(e)) return "setter";
  if (/\b(vendedor|closer|owner)\b/.test(e)) return "vendedor";
  if (/\b(etiquetas?|tags?|labels?)\b/.test(e)) return "etiquetas";
  const propio = camposPropios.find((c) => sinTildes(c.name) === sinTildes(encabezado) || sinTildes(c.slug) === sinTildes(encabezado));
  if (propio) return `campo:${propio.slug}`;
  return "no_importar";
}

export interface FilaPreparada {
  numero: number;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  pipedrive: string | null;
  setter: string | null;
  vendedor: string | null;
  etiquetas: string[];
  campos: Record<string, string>;
  /** F38: crudos; el valor y la fecha se validan al importar. */
  etapa: string | null;
  estadoTrato: string | null;
  valor: string | null;
  moneda: string | null;
  fechaCierre: string | null;
  pipedriveTrato: string | null;
  /** Una por cada columna mapeada a «Nota del contacto» (F38, parte A: los tratos anteriores). */
  notas: string[];
  usoCodigoPorDefecto: boolean;
  error: string | null;
}

/** Caracteres invisibles de dirección de texto (marcas, incrustaciones y aislamientos). */
const INVISIBLES_DE_DIRECCION = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** F38: quita los invisibles de dirección y el apóstrofe inicial de planilla. */
export function limpiarTelefono(crudo: string): string {
  return crudo.replace(INVISIBLES_DE_DIRECCION, "").trim().replace(/^'+/, "").trim();
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Una fila del archivo, con el mapeo y el código de país por defecto. Un
 * teléfono sin `+` toma el código por defecto (y queda señalado); uno que
 * empieza con `00` cambia el `00` por `+`. Una fila sin ningún identificador
 * de §14 (id de Pipedrive, correo o teléfono) no se puede deduplicar y se
 * rechaza con su motivo; un teléfono que no se normaliza no se inventa.
 */
export function prepararFila(
  valores: string[],
  mapeo: Campo[],
  opciones: { codigoPais: string; numero: number },
): FilaPreparada {
  const f: FilaPreparada = {
    numero: opciones.numero,
    nombre: null,
    correo: null,
    telefono: null,
    pipedrive: null,
    setter: null,
    vendedor: null,
    etiquetas: [],
    campos: {},
    etapa: null,
    estadoTrato: null,
    valor: null,
    moneda: null,
    fechaCierre: null,
    pipedriveTrato: null,
    notas: [],
    usoCodigoPorDefecto: false,
    error: null,
  };
  let telefonoCrudo: string | null = null;
  mapeo.forEach((campo, i) => {
    const v = (valores[i] ?? "").trim();
    if (!v) return;
    if (campo === "nombre") f.nombre = v;
    else if (campo === "correo") f.correo = v.toLowerCase();
    else if (campo === "telefono") telefonoCrudo = v;
    else if (campo === "pipedrive") f.pipedrive = v;
    else if (campo === "setter") f.setter = v;
    else if (campo === "vendedor") f.vendedor = v;
    else if (campo === "etiquetas") f.etiquetas = v.split(",").map((t) => t.trim()).filter(Boolean);
    else if (campo === "etapa") f.etapa = v;
    else if (campo === "estado_trato") f.estadoTrato = v.toLowerCase();
    else if (campo === "valor") f.valor = v;
    else if (campo === "moneda") f.moneda = v.toUpperCase();
    else if (campo === "fecha_cierre") f.fechaCierre = v;
    else if (campo === "pipedrive_trato") f.pipedriveTrato = v;
    else if (campo === "nota") f.notas.push(v);
    else if (campo.startsWith("campo:")) f.campos[campo.slice(6)] = v;
  });

  if (f.correo && !CORREO.test(f.correo)) {
    f.error = `El correo «${f.correo}» no es válido. Corregilo en la planilla y volvé a importar.`;
    return f;
  }
  if (telefonoCrudo !== null) {
    // F38: la basura de planilla que rompe la normalización en silencio. Los
    // invisibles de dirección de texto primero (pueden ir antes del apóstrofe),
    // después el apóstrofe inicial.
    const crudo: string = limpiarTelefono(telefonoCrudo);
    const sinEspacios = crudo.replace(/[\s\-.()]/g, "");
    let candidato = sinEspacios;
    if (candidato.startsWith("00")) candidato = `+${candidato.slice(2)}`;
    else if (!candidato.startsWith("+")) {
      candidato = `${opciones.codigoPais}${candidato}`;
      f.usoCodigoPorDefecto = true;
    }
    const normalizado = normalizarTelefono(candidato);
    // Al menos 7 dígitos sin el código de país (§11: «8856-12» no se normaliza).
    const nacional = f.usoCodigoPorDefecto ? sinEspacios.replace(/^\+/, "") : null;
    const corto = nacional !== null ? nacional.length < 7 : (normalizado ?? "").length - 1 < 8;
    if (!normalizado || corto || !/^\+?[0-9\s\-.()]+$/.test(crudo)) {
      f.usoCodigoPorDefecto = false;
      f.error = `El teléfono «${crudo}» no se puede normalizar. No se inventó un número: corregilo en la planilla y volvé a importar.`;
      return f;
    }
    f.telefono = normalizado;
  }
  if (!f.correo && !f.telefono && !f.pipedrive) {
    f.error = "No tiene correo, teléfono ni id de Pipedrive: sin eso no se puede saber si ya existe, así que no se importó.";
  }
  return f;
}
