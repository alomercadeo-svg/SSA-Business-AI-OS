/**
 * Correo saliente por Resend (F23). Solo servidor.
 *
 * `enviarCorreo` es LA función única que pide F23: todo correo del sistema sale
 * por acá, y los destinatarios llegan siempre explícitos. Quién recibe qué lo
 * decide quien llama: las alertas van a Owner y Admin (`destinatariosManagers`),
 * los avisos de una acción a quien la hizo, y una invitación a quien se invita.
 *
 * LA LISTA DE CORREOS ES CERRADA. Un tipo nuevo se escribe primero como
 * criterio de la funcionalidad que lo dispara, y necesita una migración: el
 * `check` de `email_log.tipo` (00027) no deja guardar otro.
 *
 * LOS REINTENTOS NO DEPENDEN DE UNA TAREA PROGRAMADA. Los crons del fork están
 * en `vercel.json`, que Railway no lee, y en el repo nada llama a `/api/cron/*`
 * (inferencia del 07/10/2026, ver §15 del plano). Por eso se reintenta en el
 * mismo proceso, con espera: hasta 3 reintentos después del primer intento,
 * solo para los errores que Resend documenta como pasajeros. Si el servidor se
 * reinicia a mitad de camino, la fila queda en `pendiente` y nadie la retoma.
 *
 * LA CABECERA `Idempotency-Key` es `correo-<id de la fila>`, la misma en cada
 * intento. Si un intento agota el tiempo pero Resend sí lo mandó, el reintento
 * no lo duplica: Resend respeta la clave 24 horas (documentación de
 * `POST /emails`, leída el 07/10/2026).
 *
 * NUNCA se escribe la clave en `ultimo_error`, en un log ni en la respuesta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceSecret, SECRET_NAMES } from "@/lib/vault";
import { registrarFalloDeResend } from "@/lib/integraciones-estado";
import type { Database, EmailEstado, EmailTipo, WebhookAlertCondition } from "@/lib/types/database";

type Cliente = SupabaseClient<Database>;

const URL_RESEND = "https://api.resend.com/emails";
const ESPERA_MS = 10_000;
/** Espera antes de cada reintento. Tres reintentos: "se reintenta hasta 3 veces". */
export const ESPERAS_REINTENTO_MS = [1_000, 4_000, 10_000];

// ── Destinatarios ───────────────────────────────────────────────────────────

/**
 * Dominios reservados para pruebas (RFC 2606 y RFC 6761). Los usuarios que
 * crean los verificadores son `@ssa-test.local`: un correo ahí rebota, y los
 * rebotes le bajan la reputación al dominio que manda.
 */
export function esDireccionDePrueba(email: string): boolean {
  const dominio = email.trim().toLowerCase().split("@")[1] ?? "";
  return (
    /\.(local|test|invalid|example|localhost)$/.test(dominio) ||
    /^example\.(com|net|org)$/.test(dominio)
  );
}

/** Owner y Admin del workspace, con su correo. Para los avisos del sistema. */
export async function destinatariosManagers(servicio: Cliente, workspaceId: string): Promise<string[]> {
  // Con el cliente de servicio: la RLS de `workspace_members` solo deja ver la
  // fila propia, y los correos viven en `auth.users`.
  const { data: miembros } = await servicio
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"]);

  const correos = await Promise.all(
    (miembros ?? []).map(async (m) => {
      const { data } = await servicio.auth.admin.getUserById(m.user_id);
      return data?.user?.email ?? null;
    })
  );
  return [...new Set(correos.filter((c): c is string => !!c).map((c) => c.toLowerCase()))];
}

// ── Configuración de Resend ─────────────────────────────────────────────────

async function configuracionResend(servicio: Cliente, workspaceId: string) {
  const clave = await getWorkspaceSecret(servicio, workspaceId, SECRET_NAMES.resend);
  const { data: fila } = await servicio
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("proveedor", "resend")
    .maybeSingle();
  const config = fila?.config && typeof fila.config === "object" && !Array.isArray(fila.config)
    ? (fila.config as Record<string, unknown>)
    : {};
  const remitente = typeof config.remitente === "string" ? config.remitente : null;
  return { clave, remitente };
}

// ── El envío ────────────────────────────────────────────────────────────────

export interface Correo {
  workspaceId: string;
  tipo: EmailTipo;
  /** Explícitos, siempre. Ver el encabezado. */
  para: string[];
  /** Lo que muestra la pestaña: «Owner y Admin», un nombre o la dirección. */
  paraEtiqueta: string;
  asunto: string;
  texto: string;
  html: string;
  alertaId?: string | null;
  inviteId?: string | null;
  claveTecho?: string | null;
  /** La fila ya creada por `reservar_correo_aviso`. Si no viene, se crea. */
  filaId?: string;
}

export interface OpcionesEnvio {
  /** Inyectable para los tests, que no esperan de verdad. */
  esperar?: (ms: number) => Promise<void>;
  /**
   * Si viene, el primer intento corre ya y los reintentos se le pasan a esta
   * función (en la práctica, `after()`), para no dejar esperando a quien
   * invitó. Si no viene, todo corre acá.
   */
  reintentarEnSegundoPlano?: (fn: () => Promise<void>) => void;
  servicio?: Cliente;
}

export interface ResultadoEnvio {
  id: string | null;
  estado: EmailEstado;
  error: string | null;
}

interface Intento {
  ok: boolean;
  reintentable: boolean;
  error: string | null;
  resendId?: string | null;
  status?: number;
  cuerpo?: unknown;
}

const esperarDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Los errores que Resend documenta como pasajeros
 * (https://resend.com/docs/api-reference/errors, leída el 07/10/2026). Las
 * cuotas diarias y mensuales también son 429, pero no se resuelven en segundos:
 * no se reintentan.
 */
export function esReintentable(status: number, nombre: string | null): boolean {
  if (status >= 500) return true;
  if (status === 429) return nombre === "rate_limit_exceeded";
  if (status === 409) return nombre === "concurrent_idempotent_requests";
  return false;
}

async function intentarUnaVez(clave: string, idempotencia: string, cuerpo: Record<string, unknown>): Promise<Intento> {
  try {
    const res = await fetch(URL_RESEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencia,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok) {
      const id = (json as { id?: unknown } | null)?.id;
      return { ok: true, reintentable: false, error: null, resendId: typeof id === "string" ? id : null };
    }
    const c = (json ?? {}) as { name?: unknown; message?: unknown };
    const nombre = typeof c.name === "string" ? c.name : null;
    const mensaje = typeof c.message === "string" ? c.message : null;
    return {
      ok: false,
      reintentable: esReintentable(res.status, nombre),
      error: `Resend respondió HTTP ${res.status}${nombre ? ` (${nombre})` : ""}${mensaje ? `: ${mensaje}` : ""}`.slice(0, 300),
      status: res.status,
      cuerpo: json,
    };
  } catch (e) {
    const nombre = (e as { name?: unknown })?.name;
    const porTiempo = nombre === "TimeoutError" || nombre === "AbortError";
    return {
      ok: false,
      reintentable: true,
      error: porTiempo ? "Resend no respondió a tiempo." : "No se pudo llegar a Resend (falla de red).",
    };
  }
}

/**
 * Manda un correo y lo deja registrado en `email_log`. Nunca tira: el resultado
 * dice qué pasó, y la fila también.
 */
export async function enviarCorreo(correo: Correo, opciones: OpcionesEnvio = {}): Promise<ResultadoEnvio> {
  const servicio = opciones.servicio ?? (await createServiceClient());
  const esperar = opciones.esperar ?? esperarDeVerdad;

  try {
    const para = [...new Set(correo.para.map((p) => p.trim().toLowerCase()).filter(Boolean))];
    const reales = para.filter((p) => !esDireccionDePrueba(p));

    let id = correo.filaId ?? null;
    if (!id) {
      const { data, error } = await servicio
        .from("email_log")
        .insert({
          workspace_id: correo.workspaceId,
          tipo: correo.tipo,
          clave_techo: correo.claveTecho ?? null,
          alerta_id: correo.alertaId ?? null,
          invite_id: correo.inviteId ?? null,
          para: reales.length ? reales : para,
          para_etiqueta: correo.paraEtiqueta,
          asunto: correo.asunto,
          estado: reales.length ? "pendiente" : "omitido_prueba",
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[correo] no se pudo registrar el correo:", error?.message ?? "sin fila");
        return { id: null, estado: "fallido", error: "No se pudo registrar el correo." };
      }
      id = data.id;
    }
    const filaId = id;

    const actualizar = (cambios: Database["public"]["Tables"]["email_log"]["Update"]) =>
      servicio.from("email_log").update(cambios).eq("id", filaId);

    if (reales.length === 0) {
      await actualizar({ estado: "omitido_prueba", ultimo_error: "Todos los destinatarios son direcciones de prueba." });
      return { id: filaId, estado: "omitido_prueba", error: null };
    }

    const { clave, remitente } = await configuracionResend(servicio, correo.workspaceId);
    if (!clave || !remitente) {
      const error = !clave
        ? "Resend no está configurado: falta la clave en Integraciones."
        : "Falta el remitente de Resend en Integraciones.";
      await actualizar({ estado: "fallido", ultimo_error: error });
      return { id: filaId, estado: "fallido", error };
    }

    const cuerpo = { from: remitente, to: reales, subject: correo.asunto, text: correo.texto, html: correo.html };
    const idempotencia = `correo-${filaId}`;

    const intentar = async (numero: number): Promise<ResultadoEnvio> => {
      const r = await intentarUnaVez(clave, idempotencia, cuerpo);
      if (r.ok) {
        await actualizar({
          estado: "enviado",
          intentos: numero,
          ultimo_error: null,
          resend_id: r.resendId ?? null,
          enviado_el: new Date().toISOString(),
        });
        return { id: filaId, estado: "enviado", error: null };
      }
      if (typeof r.status === "number") {
        await registrarFalloDeResend(servicio, correo.workspaceId, r.status, r.cuerpo);
      }
      const quedan = numero <= ESPERAS_REINTENTO_MS.length && r.reintentable;
      await actualizar({ estado: quedan ? "pendiente" : "fallido", intentos: numero, ultimo_error: r.error });
      if (!quedan) return { id: filaId, estado: "fallido", error: r.error };
      return { id: filaId, estado: "pendiente", error: r.error };
    };

    const reintentos = async (desde: number): Promise<ResultadoEnvio> => {
      let ultimo: ResultadoEnvio = { id: filaId, estado: "pendiente", error: null };
      for (let n = desde; n <= ESPERAS_REINTENTO_MS.length + 1; n++) {
        await esperar(ESPERAS_REINTENTO_MS[n - 2]);
        ultimo = await intentar(n);
        if (ultimo.estado !== "pendiente") return ultimo;
      }
      return ultimo;
    };

    const primero = await intentar(1);
    if (primero.estado !== "pendiente") return primero;

    if (opciones.reintentarEnSegundoPlano) {
      opciones.reintentarEnSegundoPlano(async () => {
        await reintentos(2);
      });
      return primero;
    }
    return await reintentos(2);
  } catch (e) {
    console.error("[correo] error inesperado:", e instanceof Error ? e.message : "desconocido");
    return { id: correo.filaId ?? null, estado: "fallido", error: "Error inesperado al mandar el correo." };
  }
}

// ── Avisos de `webhook_alerts` ──────────────────────────────────────────────

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function urlApp(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
}

/** Párrafos de texto plano a HTML, escapados. */
export function aHtml(parrafos: string[]): string {
  return parrafos
    .map((p) => `<p style="font-family:sans-serif;font-size:15px;line-height:1.5">${escaparHtml(p)}</p>`)
    .join("\n");
}

/**
 * Qué dice el correo de cada condición. Explica qué pasó y qué hacer, como pide
 * §11 para la pestaña de Alertas. El `detail` entra SOLO en las dos condiciones
 * de F39 (`canal_silencioso` y `suscripcion_incompleta`), cuyo detalle lo arma
 * nuestro código (`lib/vigilancia-canales.ts` y `lib/vigilancia-suscripcion.ts`)
 * y nombra los canales o el evento que falta. En las demás no: el de la
 * instancia desconocida lo elige quien manda el aviso.
 *
 * `webhook_unknown_instance` no está, a propósito: no tiene workspace y no se
 * avisa por correo hasta que se decida a quién (§15, 07/10/2026).
 */
export function contenidoDeAlerta(
  condicion: WebhookAlertCondition | string,
  ocurrencias: number,
  detalle: string | null = null
): { asunto: string; parrafos: string[] } {
  const canales = `${urlApp()}/dashboard/channels`;
  const vigilancia = `${urlApp()}/dashboard/settings/vigilancia`;
  switch (condicion) {
    case "canal_silencioso":
      return {
        asunto: "Un canal pasó su límite de horas sin recibir mensajes",
        parrafos: [
          "Uno o más canales pasaron más horas hábiles sin recibir mensajes que el límite que tienen configurado.",
          ...(detalle ? [detalle] : []),
          "Puede ser un período tranquilo, o puede ser que los mensajes no estén llegando al sistema. Conviene comprobar que la cuenta siga recibiendo mensajes y que el canal siga conectado.",
          "La alerta se cierra sola cuando todos los canales vigilados vuelven a estar dentro de su límite.",
          `El límite de cada canal se cambia en Configuración, Vigilancia de canales: ${vigilancia}`,
          `Revisalo en Canales: ${canales}`,
        ],
      };
    case "suscripcion_incompleta":
      return {
        asunto: "A la suscripción de avisos de Instagram le falta un evento",
        parrafos: [
          "La suscripción registrada en Zernio no incluye todos los avisos que el sistema necesita.",
          ...(detalle ? [detalle] : []),
          "Mientras falte, lo que llega por ese aviso no entra a la bandeja, aunque los demás mensajes sigan llegando.",
          "La alerta se cierra sola cuando la suscripción vuelve a estar completa.",
          `Revisalo en Configuración, Vigilancia de canales: ${vigilancia}`,
        ],
      };
    case "webhook_auth_failed":
      return {
        asunto: "WhatsApp está rechazando mensajes entrantes",
        parrafos: [
          ocurrencias === 1
            ? "El sistema rechazó un aviso de WhatsApp porque su autenticación no coincidió."
            : `El sistema rechazó ${ocurrencias} avisos de WhatsApp porque su autenticación no coincidió.`,
          "Cada rechazo es un mensaje de un lead que no entró a la bandeja, y no se puede recuperar: WhatsApp no lo vuelve a mandar.",
          "Suele pasar después de cambiar el secreto del webhook sin terminar el procedimiento, o después de actualizar Evolution. La alerta se cierra sola con el primer aviso que llegue bien.",
          `Revisalo en Canales: ${canales}`,
        ],
      };
    case "zernio_sync_cero_cuentas":
      return {
        asunto: "Zernio no devolvió ninguna cuenta de Instagram",
        parrafos: [
          "Al sincronizar los canales, Zernio respondió sin ninguna cuenta conectada. No se desactivó ningún canal.",
          "Puede ser un problema de la clave de Zernio, del perfil en Zernio o del propio Zernio. Mientras no se resuelva, conviene revisar que los mensajes de Instagram sigan entrando.",
          `Revisalo en Canales: ${canales}`,
        ],
      };
    default:
      return {
        asunto: "Hay una alerta abierta en los canales",
        parrafos: ["Se abrió una alerta en los canales de mensajería.", `Revisala en Canales: ${canales}`],
      };
  }
}

/**
 * El aviso por correo de una alerta de `webhook_alerts`. Va a Owner y Admin del
 * workspace, como máximo uno por tipo por hora (el techo de F23). Se llama
 * después de abrir o actualizar la alerta, dentro de `after()`.
 *
 * Abrir una alerta con `record_webhook_alert` directo NO manda correo: hay que
 * llamar a esta función. Es a propósito, y es lo que deja a los verificadores
 * abrir alertas sin mandarle correos a nadie. F39 tiene que llamarla.
 *
 * Nunca tira.
 */
export async function notificarAlerta(alertaId: string, opciones: OpcionesEnvio = {}): Promise<ResultadoEnvio | null> {
  try {
    const servicio = opciones.servicio ?? (await createServiceClient());
    const { data: alerta } = await servicio
      .from("webhook_alerts")
      .select("id, workspace_id, source, alert_condition, detail, occurrences, resolved_at")
      .eq("id", alertaId)
      .maybeSingle();
    if (!alerta || alerta.resolved_at) return null;

    // Sin workspace (la instancia desconocida) no hay Owner ni Admin de quién
    // decir: queda sin correo hasta que se decida (§15, 07/10/2026).
    if (!alerta.workspace_id) return null;

    const { asunto, parrafos } = contenidoDeAlerta(alerta.alert_condition, alerta.occurrences, alerta.detail);
    const para = (await destinatariosManagers(servicio, alerta.workspace_id)).filter((p) => !esDireccionDePrueba(p));
    const claveTecho = `${alerta.source}:${alerta.alert_condition}`;

    if (para.length === 0) {
      await servicio.from("email_log").insert({
        workspace_id: alerta.workspace_id,
        tipo: "alerta_webhook",
        clave_techo: claveTecho,
        alerta_id: alerta.id,
        para: [],
        para_etiqueta: "Owner y Admin",
        asunto,
        estado: "omitido_prueba",
        ultimo_error: "El workspace no tiene Owner ni Admin con una dirección real.",
      });
      return { id: null, estado: "omitido_prueba", error: null };
    }

    const { data: reserva, error } = await servicio.rpc("reservar_correo_aviso", {
      p_workspace_id: alerta.workspace_id,
      p_tipo: "alerta_webhook",
      p_clave: claveTecho,
      p_alerta_id: alerta.id,
      p_para: para,
      p_para_etiqueta: "Owner y Admin",
      p_asunto: asunto,
    });
    const fila = Array.isArray(reserva) ? reserva[0] : null;
    if (error || !fila) {
      console.error("[correo] no se pudo reservar el aviso:", error?.message ?? "sin fila");
      return null;
    }
    if (!fila.reservado) return { id: fila.id, estado: "omitido_techo", error: null };

    return await enviarCorreo(
      {
        workspaceId: alerta.workspace_id,
        tipo: "alerta_webhook",
        para,
        paraEtiqueta: "Owner y Admin",
        asunto,
        texto: parrafos.join("\n\n"),
        html: aHtml(parrafos),
        alertaId: alerta.id,
        claveTecho,
        filaId: fila.id,
      },
      { ...opciones, servicio }
    );
  } catch (e) {
    console.error("[correo] no se pudo avisar la alerta:", e instanceof Error ? e.message : "desconocido");
    return null;
  }
}

// ── Invitaciones ────────────────────────────────────────────────────────────

const ZONA = "America/Costa_Rica";

/**
 * El correo de una invitación al equipo. Va a quien se invita, que es el
 * destinatario explícito de esa acción. El link se arma con
 * `NEXT_PUBLIC_APP_URL`: el servidor no sabe desde qué dirección se abrió la
 * pantalla.
 */
export function contenidoDeInvitacion(datos: {
  inviteId: string;
  espacio: string;
  invitador: string;
  rol: string;
  vence: string;
}): { asunto: string; parrafos: string[]; link: string } {
  const link = `${urlApp()}/invite/${datos.inviteId}`;
  const fecha = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: ZONA }).format(
    new Date(datos.vence)
  );
  const rol = datos.rol === "admin" ? "Admin" : "Member";
  return {
    asunto: `Te invitaron a ${datos.espacio}`,
    link,
    parrafos: [
      `${datos.invitador} te invitó a sumarte a ${datos.espacio} como ${rol}.`,
      `Para aceptar, entrá a este link: ${link}`,
      `La invitación vence el ${fecha}. Si no esperabas este correo, podés ignorarlo.`,
    ],
  };
}
