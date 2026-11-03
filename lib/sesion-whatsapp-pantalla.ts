/**
 * Lo que la pantalla de Canales dice de la sesión de WhatsApp (F32), y el
 * pedido del código QR para reconectar. Sin dependencias de servidor: el texto
 * lo usa un componente de cliente.
 *
 * LOS ESTADOS, con su explicación en lenguaje claro (§11, Pantalla: Canales):
 * conectado, caído, «no se pudo verificar», «se agotaron los intentos» y «sin
 * vincular» (este último, decisión de Marcos del 02/11/2026). Los textos salen
 * del prototipo aprobado el 06/10/2026, con dos cambios: el reintento es cada
 * 10 minutos (el servicio «vigilancia-cron»), no cada 5, y «sin vincular» no
 * promete fecha.
 *
 * UN CHEQUEO VIEJO NO ES UN ESTADO. Si la última lectura tiene más de
 * `MINUTOS_PARA_VENCER` (30), la pantalla dice «no se pudo verificar» con el
 * último estado conocido: una sesión que se muestra conectada porque así quedó
 * guardada hace dos días es una pantalla mintiendo (§14).
 */
import type { SesionEstado } from "@/lib/types/database";
import { haceCuanto, MINUTOS_PARA_VENCER } from "@/lib/tareas-estado";

export interface SesionDelCanal {
  session_state: SesionEstado | null;
  session_checked_at: string | null;
  session_changed_at: string | null;
}

export interface TextoDeSesion {
  estado: SesionEstado;
  etiqueta: string;
  tono: "ok" | "peligro" | "aviso" | "neutro";
  explicacion: string;
  /** «Verificado hace 2 min», o que todavía no se verificó. */
  verificado: string;
  boton: "Reconectar" | "Vincular número" | null;
}

const NOMBRES: Record<SesionEstado, string> = {
  conectado: "conectado",
  caido: "caído",
  agotado: "se agotaron los intentos",
  sin_verificar: "no se pudo verificar",
  sin_vincular: "sin vincular",
};

export function textoDeSesion(canal: SesionDelCanal, ahora: Date = new Date()): TextoDeSesion {
  const verificadoEl = canal.session_checked_at;
  const verificado = verificadoEl
    ? `Verificado ${haceCuanto(verificadoEl, ahora)}`
    : "Todavía no se verificó: el chequeo corre cada 10 minutos.";
  const viejo =
    !verificadoEl || ahora.getTime() - new Date(verificadoEl).getTime() > MINUTOS_PARA_VENCER * 60_000;
  const guardado = canal.session_state;

  if (!guardado || guardado === "sin_verificar" || viejo) {
    const ultimo = guardado && guardado !== "sin_verificar" ? ` Último estado conocido: ${NOMBRES[guardado]}.` : "";
    return {
      estado: "sin_verificar",
      etiqueta: "No se pudo verificar",
      tono: "aviso",
      explicacion: `El último chequeo no obtuvo respuesta. No significa que esté caído; se reintenta en 10 minutos.${ultimo}`,
      verificado,
      boton: guardado === "sin_vincular" ? "Vincular número" : "Reconectar",
    };
  }

  const desde = canal.session_changed_at ? ` (${haceCuanto(canal.session_changed_at, ahora)})` : "";
  switch (guardado) {
    case "conectado":
      return { estado: guardado, etiqueta: "Conectado", tono: "ok", explicacion: "Los mensajes entran con normalidad.", verificado, boton: null };
    case "caido":
      return {
        estado: guardado,
        etiqueta: "Caído",
        tono: "peligro",
        explicacion: `La sesión se cortó${desde}. Hay que volver a escanear el código desde el teléfono del negocio.`,
        verificado,
        boton: "Reconectar",
      };
    case "agotado":
      return {
        estado: guardado,
        etiqueta: "Se agotaron los intentos",
        tono: "peligro",
        explicacion: "WhatsApp ya no acepta más códigos para esta vinculación. Hay que empezar la vinculación de cero.",
        verificado,
        boton: "Reconectar",
      };
    case "sin_vincular":
      return {
        estado: guardado,
        etiqueta: "Sin vincular",
        tono: "neutro",
        explicacion: "El servicio está listo, pero el número todavía no se vinculó.",
        verificado,
        boton: "Vincular número",
      };
  }
}

// ── El código QR ────────────────────────────────────────────────────────────

export type RespuestaDeCodigo =
  | { tipo: "qr"; imagen: string }
  | { tipo: "conectado" }
  | { tipo: "sin_codigo" }
  | { tipo: "error"; motivo: string };

/**
 * La respuesta de `GET /instance/connect/{instancia}` de Evolution 2.3.7
 * (`instance.controller.ts:309-341`): con la sesión abierta devuelve el estado;
 * conectando, el QR actual; cerrada, arranca la vinculación y devuelve el QR a
 * los 2 s, que puede venir todavía sin imagen. Los errores vuelven con 200 y
 * `{ error: true }`. El mensaje crudo no se muestra.
 */
export function interpretarConnect(status: number, cuerpo: unknown): RespuestaDeCodigo {
  if (status < 200 || status >= 300) return { tipo: "error", motivo: `http_${status}` };
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  if (c.error === true) return { tipo: "error", motivo: "evolution" };
  const instancia = c.instance as { state?: unknown } | undefined;
  if (instancia && instancia.state === "open") return { tipo: "conectado" };
  const imagen = typeof c.base64 === "string" ? c.base64 : null;
  // Solo un PNG en data URL: es lo que arma Evolution (`qrcode.toDataURL`).
  if (imagen && imagen.startsWith("data:image/png;base64,")) return { tipo: "qr", imagen };
  return { tipo: "sin_codigo" };
}

/** Pide el código. Nunca tira. Ni el cuerpo ni la imagen van a un log. */
export async function pedirCodigoQR(
  instancia: string,
  token: string,
  c: { url: string; fetch?: typeof fetch },
): Promise<RespuestaDeCodigo> {
  const f = c.fetch ?? fetch;
  try {
    const res = await f(`${c.url.trim().replace(/\/$/, "")}/instance/connect/${encodeURIComponent(instancia)}`, {
      headers: { apikey: token },
      signal: AbortSignal.timeout(15_000),
    });
    let cuerpo: unknown = null;
    try {
      cuerpo = await res.json();
    } catch {
      cuerpo = null;
    }
    return interpretarConnect(res.status, cuerpo);
  } catch {
    return { tipo: "error", motivo: "sin_respuesta" };
  }
}

/** Qué se le dice a quien aprieta el botón cuando no hay código. */
export function textoDeMotivo(motivo: string): string {
  switch (motivo) {
    case "sin_credencial":
      return "Falta la credencial de la instancia de WhatsApp. Hay que volver a guardarla antes de reconectar.";
    case "sin_configurar":
      return "Falta la dirección del servicio de WhatsApp en la configuración del servidor.";
    case "sin_respuesta":
      return "El servicio de WhatsApp no respondió. Probá de nuevo en unos minutos.";
    case "http_401":
      return "El servicio de WhatsApp rechazó la credencial de la instancia.";
    default:
      return "El servicio de WhatsApp respondió con un error. Probá de nuevo en unos minutos.";
  }
}
