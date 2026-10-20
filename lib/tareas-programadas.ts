/**
 * Las tareas programadas, que corre `POST /api/cron/tareas` (lo llama el
 * servicio «vigilancia-cron» de Railway cada 10 minutos).
 *
 * Hoy hay una sola: la vigilancia de F39, por espacio, con la revisión de
 * silencio y la suscripción de Zernio. La purga de F30 se suma acá en la
 * sesión 3. Las rutas del fork (`/api/cron/jobs` y `/api/cron/sequences`) no se
 * tocan ni se llaman.
 *
 * LA MARCA DE ÚLTIMA EJECUCIÓN (§14, «Vigilancia por ausencia»). Cada espacio
 * tiene su fila en `tareas_estado` (00032), tomada con `reservar_tarea`. La
 * marca que se muestra es `ultimo_ok_at`, y solo se mueve si la revisión de
 * silencio terminó bien. Una lectura fallida de la suscripción NO la frena: el
 * vigilante corrió, y la falla queda a la vista en su propia línea de la
 * pantalla («No se pudo leer la suscripción: …»).
 *
 * EL REINTENTO DE ADJUNTOS (F28) corre DESPUÉS de la vigilancia de todos los
 * espacios, en su propio `try/catch`: si falla, la marca de la vigilancia ya
 * se escribió y no se toca. Tiene su propia fila en `tareas_estado`
 * (`reintento_adjuntos`, sin espacio). Vigilancia de canales la muestra.
 *
 * LA PURGA DE F30 corre por espacio, después de su vigilancia, en su propio
 * `try/catch`: si falla, la vigilancia de ese espacio ya escribió su marca y
 * no se toca, y el resto de los espacios sigue. Su marca es
 * `purga_eliminados:<espacio>`, y corre cuando la última buena tiene más de 24
 * horas (`lib/purga.ts`). Vigilancia de canales la muestra, en rojo a las 25.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { revisarSilencio, type Auditar, type Notificar } from "./vigilancia-canales";
import { revisarSuscripcion, type ResultadoSuscripcion } from "./vigilancia-suscripcion";
import type { EstadoWebhook } from "./integraciones";
import { almacenDeSupabase, reintentarAdjuntos, type ResumenDeReintento } from "./adjuntos";
import { almacenParaPurgar, claveDePurga, purgarEspacio, tocaPurgar, type ResumenDePurga } from "./purga";

/** Un redespliegue corta la corrida sin liberar; a los 5 minutos se puede volver a tomar. */
const MINUTOS_DE_RESERVA = 5;

export const CLAVE_DE_REINTENTO_DE_ADJUNTOS = "reintento_adjuntos";

export function claveDeVigilancia(workspaceId: string): string {
  return `vigilancia_canales:${workspaceId}`;
}

export interface Dependencias {
  notificar: Notificar;
  auditar: Auditar;
  /** La clave de Zernio del espacio, o null. */
  leerSecreto: (servicio: SupabaseClient, workspaceId: string) => Promise<string | null>;
  /** `leerWebhook` con un cliente de Zernio armado con esa clave. */
  leerSuscripcion?: (clave: string) => Promise<EstadoWebhook>;
  /** F28. Si falta, la corrida no reintenta adjuntos. */
  reintentarAdjuntos?: (servicio: SupabaseClient, ahora: Date) => Promise<ResumenDeReintento>;
  /** F30. Si falta, la corrida no purga. */
  purgar?: (servicio: SupabaseClient, workspaceId: string, ahora: Date) => Promise<ResumenDePurga>;
}

/** Las de producción. Se cargan al usarlas, para que los tests no las arrastren. */
async function dependenciasReales(): Promise<Dependencias> {
  const [{ notificarAlerta }, { auditarAlertaSiEsNueva }, { getWorkspaceSecret, SECRET_NAMES }, { leerWebhook }, { createZernioClient }] =
    await Promise.all([
      import("./correo"),
      import("./auditoria"),
      import("./vault"),
      import("./integraciones-estado"),
      import("./zernio-client"),
    ]);
  return {
    notificar: (id, o) => notificarAlerta(id, { servicio: o.servicio as never }),
    auditar: auditarAlertaSiEsNueva,
    leerSecreto: (servicio, ws) => getWorkspaceSecret(servicio, ws, SECRET_NAMES.zernio),
    leerSuscripcion: (clave) => leerWebhook(createZernioClient(clave)),
    reintentarAdjuntos: (servicio, ahora) => reintentarAdjuntos({ almacen: almacenDeSupabase(servicio), ahoraFijo: ahora }),
    purgar: (servicio, workspaceId, ahora) => purgarEspacio({ servicio, workspaceId, ahora, almacen: almacenParaPurgar(servicio) }),
  };
}

export interface ResumenDeCorrida {
  espacios: number;
  fallidas: number;
  /** Espacios que otra corrida tenía tomados. */
  ocupadas: number;
  /** F28: "ok", "fallo", "ocupada" o "sin_correr". */
  adjuntos?: "ok" | "fallo" | "ocupada" | "sin_correr";
  /** F30: cuántos espacios purgó, cuántos fallaron. Los que estaban al día no cuentan. */
  purgas?: { ok: number; fallo: number };
}

export async function correrTareas({
  servicio,
  ahora,
  deps,
}: {
  servicio: SupabaseClient;
  ahora: Date;
  deps?: Dependencias;
}): Promise<ResumenDeCorrida> {
  const d = deps ?? (await dependenciasReales());
  const { data: espacios, error } = await servicio.from("workspaces").select("id, zona_horaria, horario_atencion");
  if (error) throw new Error(`workspaces: ${error.message}`);

  const resumen: ResumenDeCorrida = { espacios: 0, fallidas: 0, ocupadas: 0, purgas: { ok: 0, fallo: 0 } };
  for (const e of (espacios ?? []) as Array<{ id: string; zona_horaria: string; horario_atencion: unknown }>) {
    resumen.espacios += 1;
    const r = await vigilarEspacio(servicio, e, ahora, d);
    if (r === "ocupada") resumen.ocupadas += 1;
    if (r === "fallo") resumen.fallidas += 1;
    const p = await correrPurga(servicio, e.id, ahora, d);
    if (p === "ok") resumen.purgas!.ok += 1;
    if (p === "fallo") resumen.purgas!.fallo += 1;
  }
  resumen.adjuntos = await correrReintentoDeAdjuntos(servicio, ahora, d);
  return resumen;
}

/**
 * F30. Nunca tira: un fallo queda en su fila de `tareas_estado` y en el log, y
 * no cuenta como falla de la corrida (la vigilancia es la que manda el 500).
 */
async function correrPurga(
  servicio: SupabaseClient,
  workspaceId: string,
  ahora: Date,
  d: Dependencias,
): Promise<"ok" | "fallo" | "ocupada" | "al_dia" | "sin_correr"> {
  if (!d.purgar) return "sin_correr";
  const clave = claveDePurga(workspaceId);
  try {
    const { data: fila, error: errFila } = await servicio
      .from("tareas_estado")
      .select("ultimo_ok_at")
      .eq("clave", clave)
      .maybeSingle();
    if (errFila) throw new Error(`tareas_estado: ${errFila.message}`);
    if (!tocaPurgar((fila as { ultimo_ok_at?: string | null } | null)?.ultimo_ok_at, ahora)) return "al_dia";
    const { data: tomada, error } = await servicio.rpc("reservar_tarea", {
      p_clave: clave,
      p_workspace_id: workspaceId,
      p_minutos: MINUTOS_DE_RESERVA,
    });
    if (error) throw new Error(`reservar_tarea: ${error.message}`);
    if (tomada !== true) return "ocupada";
    const resumen = await d.purgar(servicio, workspaceId, ahora);
    const fin = new Date().toISOString();
    await servicio
      .from("tareas_estado")
      .update({ ocupada_hasta: null, ultimo_ok_at: fin, ultimo_error: null, resultado: { ...resumen, terminada_at: fin }, updated_at: fin })
      .eq("clave", clave);
    return "ok";
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "error";
    console.error(`[tareas] ${clave}:`, motivo);
    try {
      await servicio
        .from("tareas_estado")
        .update({ ocupada_hasta: null, ultimo_error: motivo, updated_at: new Date().toISOString() })
        .eq("clave", clave);
    } catch {
      // Ya quedó en el log.
    }
    return "fallo";
  }
}

/** Nunca tira: un fallo queda en su fila de `tareas_estado` y en el log. */
async function correrReintentoDeAdjuntos(
  servicio: SupabaseClient,
  ahora: Date,
  d: Dependencias,
): Promise<"ok" | "fallo" | "ocupada" | "sin_correr"> {
  if (!d.reintentarAdjuntos) return "sin_correr";
  const clave = CLAVE_DE_REINTENTO_DE_ADJUNTOS;
  try {
    const { data: tomada, error } = await servicio.rpc("reservar_tarea", {
      p_clave: clave,
      p_workspace_id: null,
      p_minutos: MINUTOS_DE_RESERVA,
    });
    if (error) throw new Error(`reservar_tarea: ${error.message}`);
    if (tomada !== true) return "ocupada";
    const resumen = await d.reintentarAdjuntos(servicio, ahora);
    const fin = new Date().toISOString();
    await servicio
      .from("tareas_estado")
      .update({ ocupada_hasta: null, ultimo_ok_at: fin, ultimo_error: null, resultado: { ...resumen, terminada_at: fin }, updated_at: fin })
      .eq("clave", clave);
    return "ok";
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "error";
    console.error(`[tareas] ${clave}:`, motivo);
    try {
      await servicio
        .from("tareas_estado")
        .update({ ocupada_hasta: null, ultimo_error: motivo, updated_at: new Date().toISOString() })
        .eq("clave", clave);
    } catch {
      // Ya quedó en el log.
    }
    return "fallo";
  }
}

async function vigilarEspacio(
  servicio: SupabaseClient,
  espacio: { id: string; zona_horaria: string; horario_atencion: unknown },
  ahora: Date,
  d: Dependencias,
): Promise<"ok" | "fallo" | "ocupada"> {
  const clave = claveDeVigilancia(espacio.id);
  const { data: tomada, error } = await servicio.rpc("reservar_tarea", {
    p_clave: clave,
    p_workspace_id: espacio.id,
    p_minutos: MINUTOS_DE_RESERVA,
  });
  if (error) {
    console.error(`[tareas] no se pudo reservar ${clave}:`, error.message);
    return "fallo";
  }
  if (tomada !== true) return "ocupada";

  try {
    const silencio = await revisarSilencio({ servicio, workspace: espacio, ahora, notificar: d.notificar, auditar: d.auditar });

    let suscripcion: ResultadoSuscripcion | "sin_clave";
    const claveZernio = await d.leerSecreto(servicio, espacio.id);
    if (!claveZernio || !d.leerSuscripcion) {
      suscripcion = "sin_clave";
    } else {
      const leer = d.leerSuscripcion;
      try {
        suscripcion = await revisarSuscripcion({ servicio, workspaceId: espacio.id, leer: () => leer(claveZernio), notificar: d.notificar, auditar: d.auditar });
      } catch (err) {
        // Leyó bien pero no pudo registrar la alerta: queda dicho como error de
        // la suscripción, y la marca del vigilante igual avanza.
        suscripcion = {
          leida_el: ahora.toISOString(),
          registrado: false,
          activo: null,
          eventos: [],
          faltan: [],
          error: `No se pudo registrar la alerta (${err instanceof Error ? err.message : "error"}).`,
          alerta: "sin_leer",
        };
      }
    }

    const fin = new Date().toISOString();
    await servicio
      .from("tareas_estado")
      .update({
        ocupada_hasta: null,
        ultimo_ok_at: fin,
        ultimo_error: null,
        resultado: { silencio, suscripcion, terminada_at: fin },
        updated_at: fin,
      })
      .eq("clave", clave);
    return "ok";
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "error";
    console.error(`[tareas] ${clave}:`, motivo);
    // `ultimo_ok_at` no se toca: la marca visible queda donde estaba y envejece.
    await servicio
      .from("tareas_estado")
      .update({ ocupada_hasta: null, ultimo_error: motivo, updated_at: new Date().toISOString() })
      .eq("clave", clave);
    return "fallo";
  }
}
