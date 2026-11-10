/**
 * F37, criterio 9 (ítem 2 de la sesión de cierre): lo que la pantalla muestra
 * de una importación, leído de `csv_imports`. La barra sale de lo procesado de
 * verdad (`procesadas`), no de una animación.
 */
import type { LineaDelResumen } from "./importacion-contactos";

export function porcentaje(procesadas: number, filas: number): number {
  if (!filas || filas <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((procesadas / filas) * 100)));
}

export interface ResumenDeImportacion {
  id: string;
  nombreArchivo: string;
  estado: string;
  terminada: boolean;
  fallida: boolean;
  enSegundoPlano: boolean;
  filas: number;
  procesadas: number;
  porcentaje: number;
  creados: number;
  actualizados: number;
  conError: number;
  usaronCodigo: number;
  lineas: LineaDelResumen[];
  etiquetasCreadas: string[];
  control: unknown;
  error: string | null;
  empezada: string;
  terminadaAt: string | null;
}

export function resumenDeImportacion(f: {
  id: string;
  nombre_archivo: string | null;
  filas: number;
  procesadas: number;
  creados: number;
  actualizados: number;
  con_error: number;
  usaron_codigo: number;
  estado: string;
  en_segundo_plano: boolean;
  lineas: unknown;
  etiquetas_creadas?: string[] | null;
  control: unknown;
  error: string | null;
  created_at: string;
  terminada_at: string | null;
}): ResumenDeImportacion {
  const terminada = f.estado === "terminada";
  const fallida = f.estado === "fallida";
  const procesadas = terminada ? f.filas : f.procesadas;
  return {
    id: f.id,
    nombreArchivo: f.nombre_archivo ?? "planilla.csv",
    estado: f.estado,
    terminada,
    fallida,
    enSegundoPlano: f.en_segundo_plano,
    filas: f.filas,
    procesadas,
    porcentaje: porcentaje(procesadas, f.filas),
    creados: f.creados,
    actualizados: f.actualizados,
    conError: f.con_error,
    usaronCodigo: f.usaron_codigo,
    lineas: terminada || fallida ? ((Array.isArray(f.lineas) ? f.lineas : []) as LineaDelResumen[]) : [],
    etiquetasCreadas: f.etiquetas_creadas ?? [],
    control: terminada ? f.control : null,
    // El motivo técnico no va a la pantalla: solo si falló del todo, un texto claro.
    error: fallida ? "La importación se cortó después de tres intentos." : null,
    empezada: f.created_at,
    terminadaAt: f.terminada_at,
  };
}
