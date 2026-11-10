/**
 * F37, parte 2 (ítem 2 de la sesión de cierre): la validación de los pedidos
 * de la subida por tandas (`POST /api/v1/contacts/importar/tandas`). Sin nada
 * de servidor, para probarla sola. La ruta comprueba además el rol, el origen
 * y que la importación sea del espacio y de quien la empezó.
 */
import type { Campo } from "./importacion-csv";
import { FILAS_POR_TANDA, LIMITE_EN_EL_MOMENTO, MAX_FILAS } from "./importacion-segundo-plano";

export const PATRON_CODIGO = /^\+[1-9][0-9]{0,3}$/;
export const CAMPOS_FIJOS = new Set([
  "nombre",
  "correo",
  "telefono",
  "pipedrive",
  "setter",
  "vendedor",
  "etiquetas",
  "no_importar",
  // F38
  "etapa",
  "estado_trato",
  "valor",
  "moneda",
  "fecha_cierre",
  "pipedrive_trato",
  "nota",
]);

export const mapeoValido = (m: unknown): m is Campo[] =>
  Array.isArray(m) && m.length > 0 && m.every((x) => typeof x === "string" && (CAMPOS_FIJOS.has(x) || x.startsWith("campo:")));

export interface Inicio {
  nombreArchivo: string;
  etiquetaOrigen: string | null;
  codigoPais: string;
  asignarA: string | null;
  mapeo: Campo[];
  total: number;
  tandas: number;
  enSegundoPlano: boolean;
}

export function leerInicio(c: unknown): Inicio | string {
  const p = (c ?? {}) as Record<string, unknown>;
  if (!mapeoValido(p.mapeo)) return "Pedido inválido.";
  if (typeof p.total !== "number" || !Number.isInteger(p.total) || p.total < 0) return "Pedido inválido.";
  if (p.total === 0) return "La planilla no tiene filas.";
  if (p.total > MAX_FILAS) return "Hasta 10.000 filas por importación.";
  if (typeof p.codigoPais !== "string" || !PATRON_CODIGO.test(p.codigoPais)) return "El código de país tiene que ser como +506.";
  if (p.asignarA !== null && p.asignarA !== undefined && typeof p.asignarA !== "string") return "Pedido inválido.";
  return {
    nombreArchivo: typeof p.nombreArchivo === "string" && p.nombreArchivo.trim() ? p.nombreArchivo.slice(0, 200) : "planilla.csv",
    etiquetaOrigen: typeof p.etiquetaOrigen === "string" && p.etiquetaOrigen.trim() ? p.etiquetaOrigen.trim().slice(0, 60) : null,
    codigoPais: p.codigoPais,
    asignarA: typeof p.asignarA === "string" && p.asignarA ? p.asignarA : null,
    mapeo: p.mapeo,
    total: p.total,
    tandas: Math.ceil(p.total / FILAS_POR_TANDA),
    enSegundoPlano: p.total > LIMITE_EN_EL_MOMENTO,
  };
}

export function leerTanda(c: unknown, imp: { tandas: number; columnas: number }): { importacion: string; numero: number; filas: string[][] } | string {
  const p = (c ?? {}) as Record<string, unknown>;
  if (typeof p.importacion !== "string") return "Pedido inválido.";
  if (typeof p.numero !== "number" || !Number.isInteger(p.numero) || p.numero < 0 || p.numero >= imp.tandas) return "Pedido inválido.";
  if (!Array.isArray(p.filas) || p.filas.length === 0) return "Pedido inválido.";
  if (p.filas.length > FILAS_POR_TANDA) return "Hasta 500 filas por tanda.";
  const bien = p.filas.every((f) => Array.isArray(f) && f.length <= imp.columnas && f.every((v) => typeof v === "string" && v.length <= 5000));
  if (!bien) return "Pedido inválido.";
  return { importacion: p.importacion, numero: p.numero, filas: p.filas as string[][] };
}

/** Antes de procesar: están todas las tandas y suman el total anunciado. */
export function tandasCompletas(imp: { total: number; tandas: number }, subidas: { numero: number; filas: number }[]): boolean {
  const numeros = new Set(subidas.map((t) => t.numero));
  if (numeros.size !== imp.tandas) return false;
  for (let i = 0; i < imp.tandas; i++) if (!numeros.has(i)) return false;
  return subidas.reduce((n, t) => n + t.filas, 0) === imp.total;
}
