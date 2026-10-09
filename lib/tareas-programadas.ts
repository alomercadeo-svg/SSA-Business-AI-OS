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
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { revisarSilencio, type Auditar, type Notificar } from "./vigilancia-canales";
import { revisarSuscripcion, type ResultadoSuscripcion } from "./vigilancia-suscripcion";
import type { EstadoWebhook } from "./integraciones";

/** Un redespliegue corta la corrida sin liberar; a los 5 minutos se puede volver a tomar. */
const MINUTOS_DE_RESERVA = 5;

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
  };
}

export interface ResumenDeCorrida {
  espacios: number;
  fallidas: number;
  /** Espacios que otra corrida tenía tomados. */
  ocupadas: number;
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

  const resumen: ResumenDeCorrida = { espacios: 0, fallidas: 0, ocupadas: 0 };
  for (const e of (espacios ?? []) as Array<{ id: string; zona_horaria: string; horario_atencion: unknown }>) {
    resumen.espacios += 1;
    const r = await vigilarEspacio(servicio, e, ahora, d);
    if (r === "ocupada") resumen.ocupadas += 1;
    if (r === "fallo") resumen.fallidas += 1;
  }
  return resumen;
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
