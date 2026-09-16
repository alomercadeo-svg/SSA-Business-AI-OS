import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceSecret, SECRET_NAMES } from "@/lib/vault";
import {
  avisarSiLosClaimsCambiaron,
  claveIdempotencia,
  EVOLUTION_ALERTS,
  EVOLUTION_SOURCE,
  verificarTokenEvolution,
  type ClaveMensaje,
  type MotivoRechazo,
} from "@/lib/evolution-webhook";
import { procesarEventoEvolution } from "@/lib/evolution-processor";
import type { Database } from "@/lib/types/database";

/**
 * Receptor de los webhooks de Evolution API (F22).
 *
 * EL ORDEN DE ESTE ARCHIVO NO ES ARBITRARIO, y el motivo está verificado en el
 * código de Evolution 2.3.7: los códigos 400, 401, 403, 404 y 422 están en la
 * lista por defecto de `WEBHOOK_RETRY_NON_RETRYABLE_STATUS_CODES`. Cuando
 * devolvemos cualquiera de ellos, Evolution registra el error, CORTA LOS
 * REINTENTOS y descarta el evento. No hay cola de reproceso, no hay segunda
 * oportunidad: el mensaje del lead se perdió y no queda ningún síntoma.
 *
 * De ahí salen las tres decisiones que gobiernan el archivo:
 *
 *   1. Se sigue fallando cerrado. La alternativa, aceptar lo que no se puede
 *      verificar, es peor: convierte la bandeja en un buzón abierto.
 *   2. Todo rechazo registra una alerta. Con Zernio un 401 es ruido esperable
 *      de internet; acá es la señal de que estamos perdiendo mensajes.
 *   3. Se acusa con 200 ANTES de procesar. El bucle de reintentos de Evolution
 *      bloquea, con un timeout de 30 segundos por defecto.
 *
 * QUÉ HACE Y QUÉ NO HACE TODAVÍA
 * Este bloque construye la cañería: autentica, controla duplicados, acusa y
 * encola. El contenido del mensaje no se guarda: eso es F27, en el Bloque 3.
 *
 * DE AHÍ SALE UNA REGLA DURA: el número de WhatsApp no se vincula hasta que F27
 * esté construido y probado. Si se vincula antes, cada mensaje real se pierde
 * de la peor forma posible, que es en silencio y con acuse de éxito: el
 * receptor responde 200, Evolution da la entrega por buena y no reintenta, no
 * hay error y no se dispara ninguna alerta. El único síntoma serían
 * conversaciones con leads que nunca existieron.
 *
 * Ver `docs/investigacion-evolution-api.md` y `docs/requerimientos-bloques-2-3-4.md` §4.7.
 */

// ── Forma del payload ───────────────────────────────────────────────────────

/**
 * Cuerpo de una entrega de Evolution.
 *
 * `apikey` está declarado para dejar constancia de que VIENE, no para usarlo:
 * es el token de la instancia, que autoriza mandar mensajes y borrarla. Por eso
 * el despliegue va con `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` y por
 * eso ningún log de este archivo escribe el cuerpo crudo. Nunca se usa como
 * mecanismo de autenticación: es una credencial reutilizable que no caduca, o
 * sea lo contrario de lo que queremos.
 */
interface EvolutionPayload {
  event?: string;
  instance?: string;
  /** Objeto en `messages.upsert`, array en `messages.set` (sincronización de historial). */
  data?: unknown;
  date_time?: string;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

interface MensajeEvolution {
  key?: ClaveMensaje;
  messageType?: string;
  messageTimestamp?: number;
}

type CanalEvolution = Pick<
  Database["public"]["Tables"]["channels"]["Row"],
  "id" | "workspace_id" | "platform" | "provider" | "instance_name"
>;

/** Columnas del canal que necesita el receptor. Nunca `*`: la fila tiene secretos. */
const COLUMNAS_CANAL = "id, workspace_id, platform, provider, instance_name";

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    return await manejarWebhook(request);
  } catch (err) {
    // Sin el cuerpo: trae la API key de la instancia.
    console.error("[evolution] error del handler:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function manejarWebhook(request: NextRequest) {
  const body = await request.text();

  let payload: EvolutionPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const instancia = typeof payload.instance === "string" ? payload.instance.trim() : "";
  if (!instancia) {
    return NextResponse.json({ error: "Missing instance" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // ── 1. Canal, a partir de una pista que todavía no es confiable ───────────
  //
  // `instance` viene del cuerpo, que en este punto no está autenticado. No se
  // le cree: sirve únicamente para elegir QUÉ SECRETO probar. Si la
  // verificación del token pasa, el que mandó conocía ese secreto, y recién ahí
  // el `instance` queda autenticado hacia atrás. Es el mismo orden que usa el
  // receptor de Zernio, que busca el canal por `account.id` del cuerpo y
  // después resuelve el secreto de ese canal.
  const { data: canal } = await supabase
    .from("channels")
    .select(COLUMNAS_CANAL)
    .eq("instance_name", instancia)
    .eq("provider", "evolution")
    .eq("is_active", true)
    .maybeSingle<CanalEvolution>();

  if (!canal) {
    // Un 404 también corta los reintentos, así que también es un mensaje
    // perdido. El caso que importa no es una sonda de internet: es que alguien
    // renombre la instancia en Evolution o que se edite la fila del canal. A
    // partir de ese momento cada mensaje real cae acá y se pierde.
    await registrarAlerta(supabase, EVOLUTION_ALERTS.unknownInstance, {
      detalle: instancia,
    });
    console.error(
      `[evolution] instancia desconocida: "${instancia}". Cada aviso para esta ` +
      `instancia se descarta sin reintento. Revisá el nombre en Evolution y en channels.instance_name.`
    );
    return NextResponse.json({ error: "Unknown instance" }, { status: 404 });
  }

  // ── 2. Verificación del token ─────────────────────────────────────────────
  //
  // Los dos secretos, no uno: durante la ventana de rotación se aceptan el
  // nuevo y el viejo. Si solo se aceptara el nuevo, todos los avisos firmados
  // con el viejo se rechazarían con 401 hasta que Evolution tome el nuevo, y
  // esos mensajes no vuelven. El procedimiento está en docs/despliegue-evolution.md.
  const secretos = await resolverSecretos(supabase, canal.workspace_id);

  if (secretos.length === 0) {
    await registrarAlerta(supabase, EVOLUTION_ALERTS.authFailed, {
      workspaceId: canal.workspace_id,
      channelId: canal.id,
      detalle: "sin secreto configurado en Vault",
    });
    console.error(
      `[evolution] rechazado: el canal ${canal.id} no tiene webhook secret en Vault. ` +
      `Registrá el webhook de la instancia con su jwt_key antes de recibir eventos.`
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const verificacion = await verificarTokenEvolution(
    secretos,
    request.headers.get("authorization")
  );

  if (!verificacion.ok) {
    await registrarAlerta(supabase, EVOLUTION_ALERTS.authFailed, {
      workspaceId: canal.workspace_id,
      channelId: canal.id,
      detalle: verificacion.motivo,
    });
    logRechazo(instancia, verificacion.motivo);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  avisarSiLosClaimsCambiaron(verificacion.claims);

  if (verificacion.secretoUsado === "anterior") {
    // No es un error: durante la rotación es lo esperado. Fuera de ella
    // significa que Evolution todavía no tomó el secreto nuevo, y que borrar el
    // anterior ahora empezaría a perder mensajes.
    console.warn(
      `[evolution] la instancia "${instancia}" firmó con el secreto ANTERIOR. ` +
      `Si la rotación ya terminó, Evolution no tomó el nuevo: no borres el anterior todavía.`
    );
  }

  // ── 3. La alerta se apaga sola cuando el canal vuelve a funcionar ─────────
  await resolverAlertas(supabase, canal, instancia);

  // ── 4. Idempotencia ───────────────────────────────────────────────────────
  //
  // `messages.upsert` trae un objeto y `messages.set` (historial) trae un
  // array. Las dos formas se reclaman por separado, una clave por mensaje: un
  // lote del que ya procesamos la mitad no puede descartarse entero.
  const mensajes = extraerMensajes(payload.data);
  const claves = mensajes
    .map((m) => claveIdempotencia(instancia, m.key ?? {}))
    .filter((c): c is string => c !== null);

  const nuevas = await reclamarEventos(supabase, claves);

  if (claves.length > 0 && nuevas.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // ── 5. Acusar ANTES de procesar ───────────────────────────────────────────
  //
  // `after()` corre después de que la respuesta salió. El orden es la
  // afirmación central de F22 y tiene su test: el bucle de reintentos de
  // Evolution bloquea mientras espera, así que nada pesado puede correr antes
  // del 200.
  const paraProcesar = mensajes.filter((m) => {
    const clave = claveIdempotencia(instancia, m.key ?? {});
    return clave === null || nuevas.includes(clave);
  });

  after(async () => {
    try {
      await procesarEventoEvolution({
        supabase,
        canal,
        evento: payload.event ?? "",
        instancia,
        mensajes: paraProcesar,
      });
    } catch (err) {
      console.error("[evolution] error procesando el evento:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

// ── Secretos ────────────────────────────────────────────────────────────────

/**
 * Secretos aceptables, el actual primero y el anterior después.
 *
 * El anterior existe solo durante la ventana de rotación y se borra de Vault
 * cuando se confirmó que Evolution ya usa el nuevo. Que esté presente no es un
 * problema de seguridad: sigue siendo un secreto que solo conoce quien lo tiene.
 */
async function resolverSecretos(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string
): Promise<string[]> {
  const [actual, anterior] = await Promise.all([
    getWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.evolutionWebhookSecret),
    getWorkspaceSecret(supabase, workspaceId, SECRET_NAMES.evolutionWebhookSecretPrevious),
  ]);
  return [actual, anterior].filter((s): s is string => typeof s === "string" && s.length > 0);
}

// ── Alertas ─────────────────────────────────────────────────────────────────

/**
 * Registra la condición, o incrementa la que ya está abierta.
 *
 * Nunca lanza: una alerta que falla no puede convertir un 401 en un 500, porque
 * el 500 sí se reintenta y cambiaría el comportamiento del receptor. Se loguea
 * y se sigue.
 */
async function registrarAlerta(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  condicion: (typeof EVOLUTION_ALERTS)[keyof typeof EVOLUTION_ALERTS],
  opts: { workspaceId?: string; channelId?: string; detalle?: string }
): Promise<void> {
  const { error } = await supabase.rpc("record_webhook_alert", {
    p_source: EVOLUTION_SOURCE,
    p_condition: condicion,
    p_workspace_id: opts.workspaceId ?? null,
    p_channel_id: opts.channelId ?? null,
    p_detail: opts.detalle ?? null,
  });
  if (error) console.error("[evolution] no se pudo registrar la alerta:", error.message);
}

/**
 * Apaga las condiciones que este aviso válido desmiente.
 *
 * Son dos, y se cierran con criterios distintos a propósito:
 *
 *   * `webhook_auth_failed` es del workspace, y un aviso válido de ese
 *     workspace prueba que la autenticación volvió a funcionar.
 *   * `webhook_unknown_instance` es una alerta de sistema que agrupa todas las
 *     instancias desconocidas. Solo la cierra un aviso válido DE LA INSTANCIA
 *     que figura en su detalle, que es la prueba de que el renombre o la fila
 *     del canal se arreglaron. Un aviso de otra instancia no prueba nada sobre
 *     esta, y cerrarla sería apagar una alarma que sigue sonando por un motivo
 *     que no se resolvió.
 */
async function resolverAlertas(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  canal: CanalEvolution,
  instancia: string
): Promise<void> {
  const cerrar = async (
    condicion: (typeof EVOLUTION_ALERTS)[keyof typeof EVOLUTION_ALERTS],
    args: { p_workspace_id: string | null; p_detail_match: string | null }
  ) => {
    const { error } = await supabase.rpc("resolve_webhook_alert", {
      p_source: EVOLUTION_SOURCE,
      p_condition: condicion,
      ...args,
    });
    if (error) console.error("[evolution] no se pudo cerrar la alerta:", error.message);
  };

  await Promise.all([
    cerrar(EVOLUTION_ALERTS.authFailed, {
      p_workspace_id: canal.workspace_id,
      p_detail_match: null,
    }),
    cerrar(EVOLUTION_ALERTS.unknownInstance, {
      p_workspace_id: null,
      p_detail_match: instancia,
    }),
  ]);
}

/** Log del rechazo: instancia y motivo, nunca el token ni el cuerpo. */
function logRechazo(instancia: string, motivo: MotivoRechazo): void {
  const explicacion: Record<MotivoRechazo, string> = {
    sin_header: "no vino el header Authorization. ¿El webhook se registró con jwt_key?",
    formato_invalido: "el token no tiene forma de JWT.",
    firma_invalida: "la firma no verifica con ninguno de los secretos configurados.",
    vencido: "el token está vencido. Revisá el reloj del servidor de Evolution.",
  };
  console.error(
    `[evolution] 401 para la instancia "${instancia}": ${explicacion[motivo]} ` +
    `Evolution NO reintenta este aviso: el mensaje se perdió.`
  );
}

// ── Payload ─────────────────────────────────────────────────────────────────

/**
 * Normaliza las dos formas del payload a una lista.
 *
 * `messages.upsert` trae un objeto suelto; `messages.set`, el evento de
 * sincronización de historial, trae un array que puede ser grande. Distinto
 * envoltorio, mismo destino.
 */
function extraerMensajes(data: unknown): MensajeEvolution[] {
  if (Array.isArray(data)) return data as MensajeEvolution[];
  if (data && typeof data === "object") return [data as MensajeEvolution];
  return [];
}

/**
 * Reclama las claves en el ledger `webhook_events` y devuelve las que eran
 * nuevas. Un `insert` en lote con `ignoreDuplicates` no dice cuáles entraron,
 * así que se reclama una por una: los lotes de historial son el único caso
 * grande y no están en el camino caliente de un mensaje en vivo.
 *
 * Un fallo que no sea colisión (tabla ausente, error transitorio) falla ABIERTO
 * y deja pasar el evento, igual que el receptor de Zernio: perder un mensaje es
 * peor que procesarlo dos veces.
 */
async function reclamarEventos(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  claves: string[]
): Promise<string[]> {
  const nuevas: string[] = [];
  for (const clave of claves) {
    const { error } = await supabase.from("webhook_events").insert({ event_id: clave });
    if (!error) {
      nuevas.push(clave);
      continue;
    }
    if (error.code === "23505") continue; // ya procesado
    console.error("[evolution] fallo al reclamar el evento:", error.message);
    nuevas.push(clave);
  }
  return nuevas;
}
