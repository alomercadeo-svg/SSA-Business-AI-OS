/**
 * Detección del estado de las integraciones (F24). Solo servidor.
 *
 * Dos momentos, y ninguno periódico (el motivo está en F24):
 *   1. Al abrir la pantalla: `verificarTodas` le pregunta a cada proveedor
 *      configurado y escribe el resultado. Llega a la pantalla por Realtime.
 *   2. Cuando una operación real falla por credenciales o conexión:
 *      `registrarFalloDeZernio`, desde los envíos por Zernio, y
 *      `registrarFalloDeResend`, desde los correos de F23. La IA no tiene
 *      operaciones todavía: llega con la Fase 2.
 *
 * "Sin verificar" es "no se pudo preguntar": red caída, tiempo agotado, error
 * del proveedor o límite de consultas. Nunca se convierte en "desconectado",
 * que es solo para una clave que el proveedor rechazó (401 o 403).
 *
 * LOS ENDPOINTS, verificados contra la documentación oficial el 23/09/2026:
 *   - Resend:    GET https://api.resend.com/domains, `Authorization: Bearer`.
 *   - OpenAI:    GET https://api.openai.com/v1/models, `Authorization: Bearer`.
 *   - Anthropic: GET https://api.anthropic.com/v1/models, `x-api-key` y
 *                `anthropic-version: 2023-06-01`.
 *   - Google:    GET https://generativelanguage.googleapis.com/v1beta/models?key=…
 *   - Zernio:    `accounts.listAccounts()`, lo mismo que ya usan test-key y sync.
 *   - Evolution: GET {EVOLUTION_API_URL}/instance/fetchInstances con `apikey`,
 *                lo mismo que usa `scripts/verify-evolution-deploy.mjs`.
 *
 * RESEND tiene su propio mapeo, `estadoResend`, porque un 401 o un 403 no
 * alcanzan para decir "desconectado". La lista completa de estados de dominio
 * no está documentada: se considera verificado solo el que dice exactamente
 * `verified`.
 *
 * NUNCA se lee el cuerpo de la respuesta de Evolution: `fetchInstances` trae el
 * token de cada instancia. Nunca se escribe una clave en `ultimo_error`, en
 * `config` ni en un log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IntegrationEstado } from "@/lib/types/database";
import { getWorkspaceSecret } from "@/lib/vault";
import { createZernioClient } from "@/lib/zernio-client";
import { definicionDe, resumenWebhook } from "@/lib/integraciones";

export interface Deteccion {
  estado: IntegrationEstado;
  error: string | null;
  /** Dato no secreto para mostrar: el dominio verificado, cuántas cuentas. */
  detalle?: string | null;
  /** Otros datos no secretos que se guardan en `config`, como el registro del webhook. */
  extra?: Record<string, unknown>;
}

const ESPERA_MS = 8000;

export function estadoPorHttp(status: number): Deteccion {
  if (status >= 200 && status < 300) return { estado: "conectado", error: null };
  if (status === 401 || status === 403) {
    return { estado: "desconectado", error: `El proveedor rechazó la clave (HTTP ${status}).` };
  }
  if (status === 429) {
    return { estado: "sin_verificar", error: "El proveedor limitó las consultas (HTTP 429). Se vuelve a preguntar al abrir la pantalla." };
  }
  return { estado: "sin_verificar", error: `El proveedor respondió HTTP ${status}, que no dice si la clave sirve.` };
}

/**
 * El estado que deja un fallo de una operación real, o null si el fallo no es
 * de credenciales ni de conexión (un 400 por un mensaje mal armado no dice nada
 * de la integración).
 */
export function estadoPorFallo(e: unknown): Deteccion | null {
  const status = (e as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number") {
    if (status === 401 || status === 403) return estadoPorHttp(status);
    if (status >= 500 || status === 429) return estadoPorHttp(status);
    return null;
  }
  const nombre = (e as { name?: unknown })?.name;
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return { estado: "sin_verificar", error: "El proveedor no respondió a tiempo." };
  }
  if (e instanceof TypeError) {
    return { estado: "sin_verificar", error: "No se pudo llegar al proveedor (falla de red)." };
  }
  return null;
}

async function porHttp(
  url: string,
  headers: Record<string, string>
): Promise<{ d: Deteccion; status?: number; res?: { json: () => Promise<unknown> } }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(ESPERA_MS) });
    return { d: estadoPorHttp(res.status), status: res.status, res };
  } catch (e) {
    return { d: estadoPorFallo(e) ?? { estado: "sin_verificar", error: "No se pudo preguntarle al proveedor." } };
  }
}

function conTiempo<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rechazar) =>
      setTimeout(() => rechazar(Object.assign(new Error("tiempo agotado"), { name: "TimeoutError" })), ESPERA_MS)
    ),
  ]);
}

/** Le pregunta a un proveedor si la clave sirve. Nunca devuelve la clave. */
export async function consultarProveedor(proveedor: string, clave: string): Promise<Deteccion> {
  switch (proveedor) {
    case "zernio": {
      try {
        const zernio = createZernioClient(clave);
        const res = (await conTiempo(zernio.accounts.listAccounts())) as {
          data?: { accounts?: unknown[] };
        };
        const n = res?.data?.accounts?.length;
        return {
          estado: "conectado",
          error: null,
          detalle: typeof n === "number" ? `${n} ${n === 1 ? "cuenta" : "cuentas"} en Zernio.` : null,
          extra: { webhook: await leerWebhook(zernio) },
        };
      } catch (e) {
        return estadoPorFallo(e) ?? { estado: "sin_verificar", error: "Zernio respondió algo que no dice si la clave sirve." };
      }
    }
    case "evolution": {
      const base = process.env.EVOLUTION_API_URL;
      if (!base) return { estado: "sin_configurar", error: "Falta EVOLUTION_API_URL en el servidor." };
      // El cuerpo NO se lee: trae el token de cada instancia.
      const { d } = await porHttp(`${base.replace(/\/$/, "")}/instance/fetchInstances`, { apikey: clave });
      return d;
    }
    case "resend": {
      const { d, status, res } = await porHttp("https://api.resend.com/domains", { Authorization: `Bearer ${clave}` });
      let cuerpoLeido: unknown = null;
      if (res) {
        try {
          cuerpoLeido = await res.json();
        } catch {
          cuerpoLeido = null;
        }
      }
      if (res && (status === 400 || status === 401 || status === 403)) {
        return estadoResend(status!, cuerpoLeido);
      }
      if (d.estado !== "conectado" || !res) return d;
      try {
        const cuerpo = cuerpoLeido as { data?: { name?: string; status?: string }[] };
        const verificado = cuerpo?.data?.find((x) => x.status === "verified")?.name;
        return { ...d, detalle: verificado ? `Dominio verificado: ${verificado}.` : "Ningún dominio verificado en Resend." };
      } catch {
        return d;
      }
    }
    case "openai":
      return (await porHttp("https://api.openai.com/v1/models", { Authorization: `Bearer ${clave}` })).d;
    case "anthropic":
      return (await porHttp("https://api.anthropic.com/v1/models", { "x-api-key": clave, "anthropic-version": "2023-06-01" })).d;
    case "google":
      return (await porHttp(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave)}`, {})).d;
    default:
      return { estado: "sin_verificar", error: "Todavía no hay forma de preguntarle a este proveedor." };
  }
}

/**
 * El mapeo de Resend para `GET /domains`. Un 401 o un 403 no alcanzan para
 * decir "desconectado": Resend usa esos códigos también para claves válidas
 * con permisos limitados. "Desconectado" es solo cuando Resend dice que la
 * clave es inválida, no está activa o está suspendida.
 *
 * Qué está medido y qué no (los nombres de error, contra
 * https://resend.com/docs/api-reference/errors):
 *   - 400 `validation_error` "API key is invalid": MEDIDO el 05/10/2026 con una
 *     clave inventada (`lib/fixtures/resend-domains-clave-invalida.json`). Se
 *     exige el mensaje exacto porque `validation_error` cubre también otras
 *     validaciones; si Resend lo cambia, cae en "sin verificar", el lado seguro.
 *   - 401 `restricted_api_key`, clave de solo envío: MEDIDO el 07/10/2026 con la
 *     clave real (`lib/fixtures/resend-domains-clave-solo-envio.json`).
 *   - 403 `restricted_api_key` (no activa), `suspended_api_key` e
 *     `invalid_permission`: documentados, no medidos.
 */
export function estadoResend(status: number, cuerpo: unknown): Deteccion {
  const c = cuerpo && typeof cuerpo === "object" ? (cuerpo as { name?: unknown; message?: unknown }) : {};
  const nombre = typeof c.name === "string" ? c.name : null;
  const mensaje = typeof c.message === "string" ? c.message : null;

  if (status === 400) {
    if (nombre === "validation_error" && mensaje === "API key is invalid") {
      return { estado: "desconectado", error: "Resend dice que la clave es inválida." };
    }
    return { estado: "sin_verificar", error: "Resend respondió HTTP 400, que no dice si la clave sirve." };
  }
  if (status === 401) {
    if (nombre === "restricted_api_key") {
      // Medido el 07/10/2026 con la clave real de solo envío.
      return {
        estado: "conectado",
        error: null,
        detalle: "Clave de solo envío: el estado del dominio no se puede consultar con esta clave.",
      };
    }
    return { estado: "sin_verificar", error: "Resend rechazó la consulta (HTTP 401) y no dice por qué." };
  }
  if (status === 403) {
    if (nombre === "restricted_api_key") return { estado: "desconectado", error: "Resend dice que la clave no está activa." };
    if (nombre === "suspended_api_key") return { estado: "desconectado", error: "Resend dice que la clave está suspendida." };
    return { estado: "sin_verificar", error: "Resend respondió HTTP 403: la clave no tiene permiso para consultar dominios." };
  }
  return estadoPorHttp(status);
}

/**
 * El registro del webhook de Zernio, leído con `GET /v1/webhooks/settings`
 * (`webhooks.getWebhookSettings`, verificado en el SDK). Solo lectura.
 *
 * La respuesta trae el secreto de firma en texto plano. Acá se resume y se
 * descarta: sale como máscara (largo y últimos cuatro) y nunca se registra.
 * Si no se puede leer, el estado de Zernio no cambia: queda dicho en el
 * registro del webhook.
 */
async function leerWebhook(zernio: ReturnType<typeof createZernioClient>) {
  const verificado_el = new Date().toISOString();
  try {
    const res = (await conTiempo(zernio.webhooks.getWebhookSettings())) as { data?: unknown };
    return { ...resumenWebhook(res?.data ?? res), verificado_el, error: null };
  } catch {
    return { registrado: false, url: null, activo: null, eventos: [], secreto: null, otros: 0, verificado_el, error: "No se pudo leer el registro del webhook en Zernio." };
  }
}

type Cliente = SupabaseClient<Database>;

function conDetalle(config: unknown, detalle: string | null | undefined, extra?: Record<string, unknown>) {
  const base = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  return { ...base, ...(extra ?? {}), detalle: detalle ?? null };
}

/**
 * Al abrir la pantalla: le pregunta a cada proveedor configurado y escribe el
 * resultado en su fila. Las consultas van en paralelo, cada una con su tiempo
 * máximo, así que una integración lenta no frena a las demás.
 */
export async function verificarTodas(supabase: Cliente, workspaceId: string): Promise<void> {
  const { data: filas } = await supabase
    .from("integration_configs")
    .select("proveedor, tipo, nombre, config")
    .eq("workspace_id", workspaceId);

  await Promise.all(
    (filas ?? []).map(async (f) => {
      const d = definicionDe(f.proveedor, f.tipo, f.nombre);
      const clave = await getWorkspaceSecret(supabase, workspaceId, d.secreto);
      const r: Deteccion = clave
        ? await consultarProveedor(f.proveedor, clave)
        : { estado: "sin_configurar", error: null, detalle: null };
      const ahora = new Date().toISOString();
      await supabase
        .from("integration_configs")
        .update({
          estado: r.estado,
          ultimo_error: r.error,
          verificado_el: ahora,
          config: conDetalle(f.config, r.detalle, r.extra),
          updated_at: ahora,
        })
        .eq("workspace_id", workspaceId)
        .eq("proveedor", f.proveedor);
    })
  );
}

/**
 * Un envío por Zernio falló. Si fue por credenciales o por conexión, se anota
 * en la integración de Zernio y le llega a la pantalla abierta por Realtime.
 *
 * Nunca tira: el envío que falló ya tiene su propio manejo de error, y esto es
 * un aviso de más, no una condición para seguir.
 */
export async function registrarFalloDeZernio(supabase: Cliente, workspaceId: string, error: unknown): Promise<void> {
  try {
    const d = estadoPorFallo(error);
    if (!d) return;
    const ahora = new Date().toISOString();
    await supabase
      .from("integration_configs")
      .update({ estado: d.estado, ultimo_error: `Falló un envío: ${d.error}`, verificado_el: ahora, updated_at: ahora })
      .eq("workspace_id", workspaceId)
      .eq("proveedor", "zernio");
  } catch (e) {
    console.error("integraciones: no se pudo registrar el fallo de Zernio:", e instanceof Error ? e.message : "desconocido");
  }
}

/**
 * Un envío por Resend falló (F23). Solo cambia la tarjeta cuando Resend dice
 * que la clave es inválida, no está activa o está suspendida: los mismos casos
 * en que `estadoResend` dice "desconectado". Cualquier otro fallo (un remitente
 * de un dominio no verificado, un límite de envíos) es del correo, no de la
 * integración, y queda en `email_log`.
 *
 * Nunca tira, por lo mismo que `registrarFalloDeZernio`.
 */
export async function registrarFalloDeResend(
  supabase: Cliente,
  workspaceId: string,
  status: number,
  cuerpo: unknown
): Promise<void> {
  try {
    const d = estadoResend(status, cuerpo);
    if (d.estado !== "desconectado") return;
    const ahora = new Date().toISOString();
    await supabase
      .from("integration_configs")
      .update({ estado: d.estado, ultimo_error: `Falló un envío: ${d.error}`, verificado_el: ahora, updated_at: ahora })
      .eq("workspace_id", workspaceId)
      .eq("proveedor", "resend");
  } catch (e) {
    console.error("integraciones: no se pudo registrar el fallo de Resend:", e instanceof Error ? e.message : "desconocido");
  }
}
