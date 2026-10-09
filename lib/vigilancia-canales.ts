/**
 * La revisión de silencio de F39: ¿algún canal pasó más horas hábiles sin
 * recibir mensajes que su límite?
 *
 * Por espacio, mira los canales activos con `umbral_silencio_horas` no nulo
 * (00033) y cuenta las horas hábiles desde `channels.last_inbound_at` (00032),
 * con el horario y la zona del espacio (`lib/horas-habiles.ts`).
 *
 * - Hay UNA sola condición abierta por espacio, fuente y tipo (índice de la
 *   00022), así que si se pasan varios canales va una sola alerta, con los
 *   canales en el detalle.
 * - El correo sale SOLO cuando la condición se abre. `record_webhook_alert`
 *   devuelve el mismo id al abrir y al sumar (00023:153-156); la recién abierta
 *   es la que queda con `occurrences = 1`, la misma regla de
 *   `auditarAlertaSiEsNueva` (`lib/auditoria.ts`). Dos corridas no se pisan
 *   porque cada una toma la tarea con `reservar_tarea` antes de empezar.
 * - Se cierra cuando NINGÚN canal vigilado está pasado de su límite, no cuando
 *   se recupera uno.
 * - Un canal que nunca recibió nada no tiene marca que envejecer: no alerta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { horasHabiles, validarHorario, zonaValida } from "./horas-habiles";
import { etiquetaDeCanal } from "./auditoria";

export const CONDICION_SILENCIO = "canal_silencioso";
/** No es un proveedor: la condición junta canales de Zernio y de Evolution. */
export const FUENTE_SILENCIO = "vigilancia";

/** El tope de `record_webhook_alert` para el detalle (00023:134). */
const LARGO_DETALLE = 200;

export interface CanalRevisado {
  id: string;
  nombre: string;
  horas: number;
  umbral: number;
}

export interface ResultadoSilencio {
  /** Canales vigilados que tienen marca, con sus horas hábiles. */
  vigilados: CanalRevisado[];
  /** Canales vigilados que todavía no recibieron ningún mensaje. */
  sinMarca: number;
  pasados: CanalRevisado[];
  /** Qué pasó con la condición en esta corrida. */
  alerta: "abierta" | "sigue" | "cerrada" | "ninguna";
}

export interface EspacioVigilado {
  id: string;
  zona_horaria: string;
  horario_atencion: unknown;
}

const una = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });

/** El detalle de la alerta, que entra en 200 caracteres. */
export function detalleDeSilencio(pasados: CanalRevisado[]): string {
  const completo = pasados.map((c) => `${c.nombre}: ${una(c.horas)} de ${c.umbral} horas hábiles`).join(" · ");
  if (completo.length <= LARGO_DETALLE) return completo;

  // No entran: cuántos son, y los primeros nombres que quepan.
  const cabeza = `${pasados.length} canales: `;
  const nombres: string[] = [];
  for (let i = 0; i < pasados.length; i++) {
    const resto = pasados.length - (nombres.length + 1);
    const cola = resto > 0 ? ` y ${resto} más` : "";
    const candidato = cabeza + [...nombres, pasados[i].nombre].join(", ") + cola;
    if (candidato.length > LARGO_DETALLE) break;
    nombres.push(pasados[i].nombre);
  }
  const resto = pasados.length - nombres.length;
  return (cabeza + nombres.join(", ") + (resto > 0 ? ` y ${resto} más` : "")).slice(0, LARGO_DETALLE);
}

export type Notificar = (alertaId: string, opciones: { servicio: SupabaseClient }) => Promise<unknown>;
export type Auditar = (servicio: SupabaseClient, alertaId: string) => Promise<void>;

/**
 * Abre la condición o le suma una ocurrencia. Audita y avisa por correo SOLO si
 * la abrió: la recién abierta es la que queda con `occurrences = 1`.
 */
export async function abrirOSumar(
  servicio: SupabaseClient,
  alerta: { source: string; condition: string; workspaceId: string; channelId: string | null; detail: string },
  notificar: Notificar,
  auditar: Auditar,
): Promise<"abierta" | "sigue"> {
  const { data: alertaId, error } = await servicio.rpc("record_webhook_alert", {
    p_source: alerta.source,
    p_condition: alerta.condition,
    p_workspace_id: alerta.workspaceId,
    p_channel_id: alerta.channelId,
    p_detail: alerta.detail,
  });
  if (error || typeof alertaId !== "string") throw new Error(`record_webhook_alert: ${error?.message ?? "sin id"}`);

  const { data } = await servicio.from("webhook_alerts").select("occurrences").eq("id", alertaId).maybeSingle();
  if ((data as { occurrences?: number } | null)?.occurrences !== 1) return "sigue";

  await auditar(servicio, alertaId);
  await notificar(alertaId, { servicio });
  return "abierta";
}

/** Cierra la condición abierta, si hay. true si cerró una. */
export async function cerrar(servicio: SupabaseClient, source: string, condition: string, workspaceId: string): Promise<boolean> {
  const { data, error } = await servicio.rpc("resolve_webhook_alert", {
    p_source: source,
    p_condition: condition,
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`resolve_webhook_alert: ${error.message}`);
  return (data as number) > 0;
}

export async function revisarSilencio({
  servicio,
  workspace,
  ahora,
  notificar,
  auditar,
}: {
  servicio: SupabaseClient;
  workspace: EspacioVigilado;
  ahora: Date;
  /** `notificarAlerta` de `lib/correo.ts`. Se inyecta para los tests. */
  notificar: Notificar;
  /** `auditarAlertaSiEsNueva` de `lib/auditoria.ts`. */
  auditar: Auditar;
}): Promise<ResultadoSilencio> {
  // Un horario o una zona inválidos hacen fallar la corrida: así la marca de
  // última ejecución no avanza y se ve, en vez de dejar de vigilar callado.
  const horario = validarHorario(workspace.horario_atencion);
  if (!horario) throw new Error("El horario de atención del espacio no es válido.");
  if (!zonaValida(workspace.zona_horaria)) throw new Error("La zona horaria del espacio no es válida.");

  const { data: canales, error } = await servicio
    .from("channels")
    .select("id, platform, username, display_name, instance_name, is_active, last_inbound_at, umbral_silencio_horas")
    .eq("workspace_id", workspace.id);
  if (error) throw new Error(`channels: ${error.message}`);

  const vigilados: CanalRevisado[] = [];
  let sinMarca = 0;
  for (const c of (canales ?? []) as Array<Record<string, any>>) {
    if (!c.is_active || c.umbral_silencio_horas == null) continue;
    if (!c.last_inbound_at) {
      sinMarca += 1;
      continue;
    }
    vigilados.push({
      id: c.id,
      nombre: etiquetaDeCanal(c),
      horas: horasHabiles(new Date(c.last_inbound_at), ahora, workspace.zona_horaria, horario),
      umbral: c.umbral_silencio_horas,
    });
  }
  const pasados = vigilados.filter((c) => c.horas > c.umbral);

  if (pasados.length === 0) {
    const cerro = await cerrar(servicio, FUENTE_SILENCIO, CONDICION_SILENCIO, workspace.id);
    return { vigilados, sinMarca, pasados, alerta: cerro ? "cerrada" : "ninguna" };
  }

  const alerta = await abrirOSumar(
    servicio,
    {
      source: FUENTE_SILENCIO,
      condition: CONDICION_SILENCIO,
      workspaceId: workspace.id,
      channelId: pasados.length === 1 ? pasados[0].id : null,
      detail: detalleDeSilencio(pasados),
    },
    notificar,
    auditar,
  );
  return { vigilados, sinMarca, pasados, alerta };
}
