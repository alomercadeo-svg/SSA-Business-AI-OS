/**
 * F37, parte 2 (ítem 2 de la sesión de cierre, 10/11/2026): el proceso que
 * corre las tandas de una importación.
 *
 * Por qué así. El 10/11/2026, 500 filas en un solo pedido tardaron 5 min 16 s
 * y la pantalla dijo «No se pudo importar» aunque el servidor terminó. La
 * documentación de Railway (Public Networking, «Specs & Limits», leída el
 * 10/11/2026) cierra un pedido después de 5 minutos sin datos transferidos; y
 * la de Next.js 16 (`proxyClientMaxBodySize`) corta en silencio el cuerpo de
 * un pedido por encima de 10 MB cuando hay `middleware.ts`, como acá. Por eso:
 *
 *   - La pantalla sube el archivo en tandas de hasta 500 filas a
 *     `csv_import_lotes` (cada pedido es chico y rápido).
 *   - Con 500 filas o menos, el pedido que cierra la subida espera el
 *     proceso; con más, responde enseguida y el proceso corre después de la
 *     respuesta (`after()` de Next.js) en el mismo servidor de Railway.
 *   - El proceso reclama la importación por unos minutos y renueva el reclamo
 *     a medida que avanza. Si el servidor se reinicia a mitad de camino (un
 *     despliegue), el reclamo vence y la retoma la tarea programada de cada 10
 *     minutos (`POST /api/cron/tareas`), desde la primera tanda sin procesar.
 *   - Dentro de cada tanda, varias filas van a la vez (`concurrencia`), y las
 *     que comparten un identificador van en orden (`importarFilas`).
 *
 * Una tanda que se cortó a mitad de camino se vuelve a procesar entera: no
 * duplica (se actualiza lo que ya se creó) pero cuenta como «actualizado» lo
 * que ya había creado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types/database";
import type { Actor, EventoAuditoria } from "./auditoria";
import { prepararFila, type Campo } from "./importacion-csv";
import { importarFilas, type AlmacenDeContactos, type Catalogos, type LineaDelResumen } from "./importacion-contactos";

/** Filas por tanda: lo que sube cada pedido y lo que se procesa de una vez. */
export const FILAS_POR_TANDA = 500;
/** Hasta acá, en el momento; desde 501, en segundo plano (F37, criterio 7). */
export const LIMITE_EN_EL_MOMENTO = 500;
/** F37, criterio 2. */
export const MAX_FILAS = 10_000;
/** Cuánto dura el reclamo; se renueva con cada avance. */
export const MINUTOS_DE_RECLAMO = 3;
/** Filas a la vez dentro de una tanda. */
export const CONCURRENCIA = 8;
/** Hasta cuántas líneas de detalle guarda el resumen. */
export const MAX_LINEAS = 2000;
/** Al tercer fallo, la importación queda fallida. */
export const MAX_INTENTOS = 3;

export interface OpcionesGuardadas {
  mapeo: Campo[];
  codigoPais: string;
  asignarA: string | null;
  etiquetaOrigenId: string | null;
  actor: Actor;
}

export interface ImportacionGuardada {
  id: string;
  workspaceId: string;
  creadoPor: string | null;
  nombreArchivo: string;
  filas: number;
  enSegundoPlano: boolean;
  opciones: OpcionesGuardadas;
  intentos?: number;
}

export interface Totales {
  creados: number;
  actualizados: number;
  conError: number;
  usaronCodigo: number;
  procesadas: number;
  lineas: LineaDelResumen[];
  etiquetasCreadas?: string[];
}

export interface ColaDeImportacion {
  /** La reclama si nadie la tiene (o venció el reclamo) y no terminó. */
  reclamar(id: string, hasta: Date, ahora: Date): Promise<ImportacionGuardada | null>;
  siguienteTanda(id: string): Promise<{ numero: number; filas: string[][] } | null>;
  avanzar(id: string, procesadas: number, hasta: Date): Promise<void>;
  /** Marca la tanda y suma sus números; devuelve los totales nuevos. */
  cerrarTanda(id: string, numero: number, parcial: Totales): Promise<Totales>;
  todasLasFilas(id: string): Promise<string[][]>;
  terminar(id: string, datos: { totales: Totales; control: unknown }): Promise<void>;
  /** Suelta el reclamo y cuenta el intento; `definitiva` la deja fallida. */
  fallar(id: string, mensaje: string, definitiva: boolean): Promise<void>;
  /** true solo la primera vez: el aviso sale una sola vez. */
  marcarAviso(id: string): Promise<boolean>;
}

export interface DependenciasDeProceso {
  cola: ColaDeImportacion;
  ahora: () => Date;
  almacenPara: (imp: ImportacionGuardada, eventos: EventoAuditoria[]) => AlmacenDeContactos;
  catalogosPara: (imp: ImportacionGuardada) => Promise<Catalogos>;
  auditar: (eventos: EventoAuditoria[]) => Promise<void>;
  medirControl: (imp: ImportacionGuardada, idsDeTrato: string[]) => Promise<unknown>;
  avisar: (imp: ImportacionGuardada, resumen: Totales & { estado: "terminada" | "fallida"; control: unknown }) => Promise<void>;
}

const hasta = (ahora: Date) => new Date(ahora.getTime() + MINUTOS_DE_RECLAMO * 60_000);

export async function procesarImportacion(id: string, d: DependenciasDeProceso): Promise<"terminada" | "ocupada" | "fallo"> {
  const imp = await d.cola.reclamar(id, hasta(d.ahora()), d.ahora());
  if (!imp) return "ocupada";
  const { mapeo, codigoPais, asignarA, etiquetaOrigenId, actor } = imp.opciones;
  let totales: Totales | null = null;
  try {
    let ultimoAvance = 0;
    for (let t = await d.cola.siguienteTanda(id); t; t = await d.cola.siguienteTanda(id)) {
      // Se leen otra vez en cada tanda: una etiqueta creada en la anterior ya existe.
      const catalogos = await d.catalogosPara(imp);
      const base = t.numero * FILAS_POR_TANDA;
      const filas = t.filas.map((valores, i) => prepararFila(valores, mapeo, { codigoPais, numero: base + i + 2 }));
      const eventos: EventoAuditoria[] = [];
      const yaProcesadas = totales?.procesadas ?? 0;
      const avances: Promise<void>[] = [];
      const r = await importarFilas(filas, catalogos, d.almacenPara(imp, eventos), {
        asignarA,
        etiquetaOrigenId,
        concurrencia: CONCURRENCIA,
        alAvanzar: (n) => {
          const ahora = d.ahora().getTime();
          if (n === filas.length || ahora - ultimoAvance >= 1000) {
            ultimoAvance = ahora;
            avances.push(d.cola.avanzar(id, yaProcesadas + n, hasta(d.ahora())));
          }
        },
      });
      await Promise.all(avances);
      for (const c of r.creadosIds) {
        eventos.push({ workspaceId: imp.workspaceId, actor, accion: "contacto.creado", entidad: { tipo: "contacto", id: c.id, etiqueta: c.nombre }, detalle: { importacion: id } });
      }
      await d.auditar(eventos);
      totales = await d.cola.cerrarTanda(id, t.numero, {
        creados: r.creados,
        actualizados: r.actualizados,
        conError: r.conError,
        usaronCodigo: r.usaronCodigo,
        procesadas: filas.length,
        lineas: r.lineas,
        etiquetasCreadas: r.etiquetasCreadas,
      });
    }

    const cerrados: Totales = totales ?? { creados: 0, actualizados: 0, conError: 0, usaronCodigo: 0, procesadas: 0, lineas: [] };
    let control: unknown = null;
    const iTrato = mapeo.indexOf("pipedrive_trato");
    if (iTrato >= 0) {
      const ids = (await d.cola.todasLasFilas(id)).map((f) => (f[iTrato] ?? "").trim()).filter(Boolean);
      control = await d.medirControl(imp, ids);
    }
    await d.auditar([
      {
        workspaceId: imp.workspaceId,
        actor,
        accion: "importacion.completada",
        entidad: { tipo: "importacion", id, etiqueta: imp.nombreArchivo },
        detalle: { filas: imp.filas, creados: cerrados.creados, actualizados: cerrados.actualizados, con_error: cerrados.conError, en_segundo_plano: imp.enSegundoPlano },
      },
    ]);
    await d.cola.terminar(id, { totales: cerrados, control });
    if (imp.enSegundoPlano && (await d.cola.marcarAviso(id))) await d.avisar(imp, { ...cerrados, estado: "terminada", control });
    return "terminada";
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error("[importacion] falló el proceso:", id, mensaje);
    const definitiva = (imp.intentos ?? 0) + 1 >= MAX_INTENTOS;
    await d.cola.fallar(id, mensaje, definitiva);
    if (definitiva && imp.enSegundoPlano && (await d.cola.marcarAviso(id))) {
      const t = totales ?? { creados: 0, actualizados: 0, conError: 0, usaronCodigo: 0, procesadas: 0, lineas: [] };
      await d.avisar(imp, { ...t, estado: "fallida", control: null });
    }
    return "fallo";
  }
}

// ── La cola sobre Supabase ─────────────────────────────────────────────────

type Cliente = SupabaseClient<Database>;

interface FilaDeImportacion {
  id: string;
  workspace_id: string;
  created_by: string | null;
  nombre_archivo: string | null;
  filas: number;
  en_segundo_plano: boolean;
  opciones: OpcionesGuardadas | null;
  intentos: number;
}

const COLUMNAS = "id, workspace_id, created_by, nombre_archivo, filas, en_segundo_plano, opciones, intentos";

function guardada(f: FilaDeImportacion): ImportacionGuardada {
  return {
    id: f.id,
    workspaceId: f.workspace_id,
    creadoPor: f.created_by,
    nombreArchivo: f.nombre_archivo ?? "planilla.csv",
    filas: f.filas,
    enSegundoPlano: f.en_segundo_plano,
    opciones: f.opciones as OpcionesGuardadas,
    intentos: f.intentos,
  };
}

export function colaSupabase(servicio: Cliente): ColaDeImportacion {
  const tabla = () => servicio.from("csv_imports");
  return {
    async reclamar(id, h, ahora) {
      const { data, error } = await tabla()
        .update({ estado: "en_curso", trabajando_hasta: h.toISOString() })
        .eq("id", id)
        .in("estado", ["en_cola", "en_curso"])
        // Las de la ruta en el momento de la parte 1 no tienen opciones: no son de esta cola.
        .not("opciones", "is", null)
        .or(`trabajando_hasta.is.null,trabajando_hasta.lt.${ahora.toISOString()}`)
        .select(COLUMNAS);
      if (error) throw new Error(`csv_imports: ${error.message}`);
      const fila = (data?.[0] ?? null) as unknown as FilaDeImportacion | null;
      if (!fila) return null;
      await tabla().update({ empezada_at: ahora.toISOString() }).eq("id", id).is("empezada_at", null);
      return guardada(fila);
    },
    async siguienteTanda(id) {
      const { data, error } = await servicio
        .from("csv_import_lotes")
        .select("numero, filas")
        .eq("import_id", id)
        .is("procesado_at", null)
        .order("numero")
        .limit(1);
      if (error) throw new Error(`csv_import_lotes: ${error.message}`);
      const t = data?.[0];
      return t ? { numero: t.numero, filas: t.filas as string[][] } : null;
    },
    async avanzar(id, procesadas, h) {
      await tabla().update({ procesadas, trabajando_hasta: h.toISOString() }).eq("id", id);
    },
    async cerrarTanda(id, numero, parcial) {
      const { data: antes, error } = await tabla().select("creados, actualizados, con_error, usaron_codigo, lineas, etiquetas_creadas").eq("id", id).single();
      if (error || !antes) throw new Error(`csv_imports: ${error?.message ?? "sin fila"}`);
      const lineas = [...((antes.lineas as unknown as LineaDelResumen[]) ?? []), ...parcial.lineas].slice(0, MAX_LINEAS);
      const totales: Totales = {
        creados: antes.creados + parcial.creados,
        actualizados: antes.actualizados + parcial.actualizados,
        conError: antes.con_error + parcial.conError,
        usaronCodigo: antes.usaron_codigo + parcial.usaronCodigo,
        // Todas las tandas anteriores son de 500 filas; la última puede ser más chica.
        procesadas: numero * FILAS_POR_TANDA + parcial.procesadas,
        lineas,
        etiquetasCreadas: [...new Set([...(antes.etiquetas_creadas ?? []), ...(parcial.etiquetasCreadas ?? [])])],
      };
      const { error: e2 } = await tabla()
        .update({
          creados: totales.creados,
          actualizados: totales.actualizados,
          con_error: totales.conError,
          usaron_codigo: totales.usaronCodigo,
          procesadas: totales.procesadas,
          lineas: lineas as unknown as Json,
          etiquetas_creadas: totales.etiquetasCreadas,
        })
        .eq("id", id);
      if (e2) throw new Error(`csv_imports: ${e2.message}`);
      const { error: e3 } = await servicio.from("csv_import_lotes").update({ procesado_at: new Date().toISOString() }).eq("import_id", id).eq("numero", numero);
      if (e3) throw new Error(`csv_import_lotes: ${e3.message}`);
      return totales;
    },
    async todasLasFilas(id) {
      const { data, error } = await servicio.from("csv_import_lotes").select("filas").eq("import_id", id).order("numero");
      if (error) throw new Error(`csv_import_lotes: ${error.message}`);
      return (data ?? []).flatMap((t) => t.filas as string[][]);
    },
    async terminar(id, { totales, control }) {
      await tabla()
        .update({
          estado: "terminada",
          terminada_at: new Date().toISOString(),
          trabajando_hasta: null,
          procesadas: totales.procesadas,
          control: (control ?? null) as Json,
          error: null,
        })
        .eq("id", id);
    },
    async fallar(id, mensaje, definitiva) {
      const { data } = await tabla().select("intentos").eq("id", id).single();
      await tabla()
        .update({
          intentos: (data?.intentos ?? 0) + 1,
          error: mensaje.slice(0, 500),
          trabajando_hasta: null,
          ...(definitiva ? { estado: "fallida", terminada_at: new Date().toISOString() } : { estado: "en_cola" }),
        })
        .eq("id", id);
    },
    async marcarAviso(id) {
      const { data } = await tabla().update({ aviso_enviado_at: new Date().toISOString() }).eq("id", id).is("aviso_enviado_at", null).select("id");
      return (data?.length ?? 0) > 0;
    },
  };
}

/** Las importaciones que esperan y nadie tiene reclamadas (para la tarea programada). */
export async function importacionesPendientes(servicio: Cliente, ahora: Date): Promise<string[]> {
  const { data, error } = await servicio
    .from("csv_imports")
    .select("id")
    .in("estado", ["en_cola", "en_curso"])
    .not("opciones", "is", null)
    .or(`trabajando_hasta.is.null,trabajando_hasta.lt.${ahora.toISOString()}`)
    .order("created_at")
    .limit(5);
  if (error) throw new Error(`csv_imports: ${error.message}`);
  return (data ?? []).map((f) => f.id as string);
}
