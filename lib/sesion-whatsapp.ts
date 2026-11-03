/**
 * El estado de la sesión de un canal de WhatsApp (F32).
 *
 * Lo escriben dos caminos con la misma regla: el receptor de Evolution, con
 * `connection.update`, y el chequeo periódico de las tareas programadas. Los
 * dos hacen falta porque ante una caída pasajera Evolution reconecta solo y no
 * manda `close` (Evolution 2.3.7, `whatsapp.baileys.service.ts:426-431`).
 *
 * LOS ESTADOS DE EVOLUTION 2.3.7 (verificados en su código público el
 * 02/11/2026, etiqueta `2.3.7`, huella `60e857fc…` del mismo archivo que cita
 * `lib/evolution-guardado.ts`):
 *   - `open`, `connecting`, `close` (Baileys, `WAConnectionState`) y `refused`,
 *     que agrega Evolution cuando se agotan los códigos QR (B:336-361). El
 *     `refused` solo viaja en el webhook: después la instancia queda en `close`
 *     (`monitor.service.ts:428-437`), y eso es lo que lee el chequeo.
 *   - Una instancia que nunca se vinculó contesta `close` (B:259), igual que
 *     una caída. Lo que las distingue es la marca `session_linked_at`.
 *
 * LA MARCA DE «ALGUNA VEZ ESTUVO CONECTADO» (decisión de Marcos del 02/11/2026).
 * Se pone la primera vez que aparece cualquiera de tres señales: el chequeo lee
 * `open`, el receptor recibe `connection.update` con `open`, o Evolution trae
 * un `ownerJid` no vacío (se escribe solo al pasar a `open`, B:493, y no lo
 * borran ni la rama de `close` ni `cleaningUp`). No se borra nunca. Sin marca,
 * un `close` es «sin vincular», no una caída, y no manda correo.
 *
 * EL ÚLTIMO ESTADO CONOCIDO (00042, decisión de Marcos del 03/11/2026). Un
 * «no se pudo verificar» pisa `session_state`, y eso borraba el agotado: el
 * `close` siguiente daba caído con otro correo, o «sin vincular».
 * `session_known_state` guarda el último estado que no fue «no se pudo
 * verificar»; `session_state` sigue diciendo «sin_verificar» mientras no se
 * sabe, y eso es lo que se muestra (criterios 3 y 8). Volver de ahí al mismo
 * estado conocido no avisa: no es una caída nueva.
 *
 * LA TRANSICIÓN. El evento y el chequeo pueden escribir a la vez. El cambio de
 * estado es un `update` condicionado a que el estado sea otro, y solo quien
 * obtiene la fila tiene una transición: así una caída manda un solo correo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SesionEstado } from "@/lib/types/database";

/** Lo que se leyó de Evolution, por evento o por chequeo. */
export type LecturaDeSesion =
  | { tipo: "estado"; estado: "open" | "connecting" | "close" | "refused" }
  /** Sin respuesta, error, 401 o sin `state`: el motivo va a `session_detail`. */
  | { tipo: "sin_verificar"; motivo: string };

export interface SesionGuardada {
  session_state: SesionEstado | null;
  session_detail: string | null;
  session_linked_at: string | null;
  session_known_state: Exclude<SesionEstado, "sin_verificar"> | null;
}

export interface Decision {
  /** El estado nuevo, o null si no cambia. */
  estado: SesionEstado | null;
  /** La lectura cruda o el motivo, para `session_detail`. */
  detalle: string;
  /** Si hay que poner la marca de vinculado (si ya estaba, no cambia nada). */
  marcar: boolean;
}

const ESTADOS_DE_EVOLUTION = new Set(["open", "connecting", "close", "refused"]);

/**
 * La lectura que trae un aviso del receptor, o null si no es de sesión.
 * `connection.update` trae `{ instance, state, statusReason, … }` en `data`
 * (B:350-357, B:463, B:509-515, B:519). Un `state` que no conocemos no se
 * adivina: no es una lectura.
 */
export function lecturaDeAviso(evento: string | undefined, data: unknown): LecturaDeSesion | null {
  if ((evento ?? "").trim().toLowerCase().replace(/_/g, ".") !== "connection.update") return null;
  const estado = data && typeof data === "object" ? (data as { state?: unknown }).state : undefined;
  if (typeof estado !== "string" || !ESTADOS_DE_EVOLUTION.has(estado)) return null;
  return { tipo: "estado", estado: estado as "open" | "connecting" | "close" | "refused" };
}

/** Los estados que mandan correo a Owner y Admin al entrar (criterio 7). */
export const ESTADOS_QUE_AVISAN: readonly SesionEstado[] = ["caido", "agotado"];

/**
 * La regla. `ownerJid` es la tercera señal de la marca: true si Evolution trajo
 * un `ownerJid` no vacío en esta lectura.
 */
export function decidirEstado(guardada: SesionGuardada, lectura: LecturaDeSesion, ownerJid = false): Decision {
  if (lectura.tipo === "sin_verificar") {
    // Criterio 3: un estado desconocido nunca se muestra como desconectado.
    return { estado: "sin_verificar", detalle: lectura.motivo, marcar: ownerJid };
  }

  const detalle = lectura.estado;
  const marcar = ownerJid || lectura.estado === "open";
  const conMarca = guardada.session_linked_at !== null || marcar;
  // Agotado, o agotado antes de un «no se pudo verificar».
  const agotado =
    guardada.session_state === "agotado" ||
    (guardada.session_state === "sin_verificar" && guardada.session_known_state === "agotado");

  switch (lectura.estado) {
    case "open":
      return { estado: "conectado", detalle, marcar };
    case "refused":
      return { estado: "agotado", detalle, marcar };
    case "close":
      // Después de `refused`, Evolution deja la instancia en `close`: sigue
      // siendo «se agotaron los intentos» hasta que alguien empiece de nuevo,
      // con la marca o sin ella (un número que nunca se vinculó también agota
      // los códigos: 03/11/2026, con el número real).
      if (agotado) return { estado: "agotado", detalle, marcar };
      if (!conMarca) return { estado: "sin_vincular", detalle, marcar };
      return { estado: "caido", detalle, marcar };
    case "connecting": {
      // Depende de la marca, no del estado anterior (ajuste de Marcos del
      // 02/11/2026): si dependiera del estado, un canal que pasó por «no se
      // pudo verificar» y después lee `connecting` en cada chequeo quedaría
      // así para siempre, una caída real sin correo ni aviso.
      //
      // Sin marca, o en agotado, es una vinculación en curso: no cambia.
      // Con marca, la primera lectura puede ser la reconexión sola de
      // Evolution (B:428-431): no cambia y deja el detalle. La segunda seguida
      // es caído. `session_detail` lleva la cuenta: cualquier otra lectura la
      // pisa, y un `open` la vuelve a cero.
      const enCurso = !conMarca || agotado;
      const vigilado = ["conectado", "caido", "sin_verificar"].includes(guardada.session_state ?? "");
      if (!enCurso && vigilado && guardada.session_detail === "connecting") {
        return { estado: "caido", detalle, marcar };
      }
      return { estado: null, detalle, marcar };
    }
  }
}

export interface Transicion {
  canalId: string;
  workspaceId: string;
  de: SesionEstado | null;
  a: SesionEstado;
  /** true si `a` es caído o agotado: hay que mandar el correo. */
  avisar: boolean;
}

/**
 * Guarda una lectura: siempre la hora y el detalle; la marca si corresponde; y
 * el estado solo si cambió. Devuelve la transición, o null si no hubo.
 *
 * Solo escribe en la base: el receptor la llama antes del acuse, y el correo
 * va después (condición 1 de Marcos, 02/11/2026).
 */
export async function registrarLectura(
  servicio: SupabaseClient,
  canalId: string,
  lectura: LecturaDeSesion,
  ahora: Date,
  ownerJid = false,
): Promise<Transicion | null> {
  const { data: fila, error } = await servicio
    .from("channels")
    .select("id, workspace_id, session_state, session_detail, session_linked_at, session_known_state")
    .eq("id", canalId)
    .maybeSingle();
  if (error) throw new Error(`channels: ${error.message}`);
  if (!fila) throw new Error(`channels: no existe ${canalId}`);
  const guardada = fila as SesionGuardada & { id: string; workspace_id: string };

  const d = decidirEstado(guardada, lectura, ownerJid);
  const cuando = ahora.toISOString();

  const { error: errLectura } = await servicio
    .from("channels")
    .update({ session_checked_at: cuando, session_detail: d.detalle })
    .eq("id", canalId);
  if (errLectura) throw new Error(`channels: ${errLectura.message}`);

  if (d.marcar && guardada.session_linked_at === null) {
    // Condicionado a que siga vacía: la marca no se pisa nunca.
    const { error: errMarca } = await servicio
      .from("channels")
      .update({ session_linked_at: cuando })
      .eq("id", canalId)
      .is("session_linked_at", null);
    if (errMarca) throw new Error(`channels: ${errMarca.message}`);
  }

  if (d.estado === null || d.estado === guardada.session_state) return null;

  // El último estado conocido va con el estado, en el mismo `update`.
  const conocido = d.estado === "sin_verificar" ? {} : { session_known_state: d.estado };
  const { data: cambiadas, error: errEstado } = await servicio
    .from("channels")
    .update({ session_state: d.estado, session_changed_at: cuando, ...conocido })
    .eq("id", canalId)
    .or(`session_state.is.null,session_state.neq.${d.estado}`)
    .select("id");
  if (errEstado) throw new Error(`channels: ${errEstado.message}`);
  if (!cambiadas || cambiadas.length === 0) return null;

  return {
    canalId,
    workspaceId: guardada.workspace_id,
    de: guardada.session_state,
    a: d.estado,
    avisar:
      ESTADOS_QUE_AVISAN.includes(d.estado) &&
      !(guardada.session_state === "sin_verificar" && guardada.session_known_state === d.estado),
  };
}
