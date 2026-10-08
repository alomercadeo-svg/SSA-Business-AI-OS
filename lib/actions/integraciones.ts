"use server";

/**
 * Acciones de servidor de la pantalla de integraciones (F24).
 *
 * El rol se decide acá, en el servidor, y no en la pantalla: un Member que
 * llame a estas acciones a mano recibe un error y no toca nada. La RLS de
 * `integration_configs` y la de Vault lo frenarían igual; esto evita llegar.
 *
 * Ninguna acción devuelve una clave. Lo máximo que sale es el largo y los
 * últimos cuatro caracteres (`mascaraDeClave`).
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { setWorkspaceSecret, deleteWorkspaceSecret, getZernioApiKey } from "@/lib/vault";
import { createZernioClient } from "@/lib/zernio-client";
import {
  definicionDe,
  validarFormatoClave,
  validarRemitente,
  mascaraDeClave,
  PROVEEDORES,
  type Mascara,
  confirmacionCoincide,
} from "@/lib/integraciones";
import { verificarTodas, consultarProveedor } from "@/lib/integraciones-estado";
import { actorDe, etiquetaDeCanal, registrarAuditoria, type Cambios } from "@/lib/auditoria";

const RUTA = "/dashboard/settings/integrations";

type Resultado<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

type Contexto = NonNullable<Awaited<ReturnType<typeof getWorkspaceOrNull>>>;

async function contextoManager(): Promise<
  { ok: true; contexto: Contexto; workspaceId: string } | { ok: false; error: string }
> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar las integraciones." };
  const workspaceId = contexto.workspace.id;
  if (!workspaceId) return { ok: false, error: "No se pudo resolver el espacio de trabajo." };
  return { ok: true, contexto, workspaceId };
}

/**
 * F31: cada cambio de esta pantalla es un "cambio de configuración" y queda en
 * el historial (nota del 22/09/2026 en F31). De una clave se registra que se
 * guardó o se borró, nunca el valor.
 */
async function auditarConfiguracion(ctx: { contexto: Contexto; workspaceId: string }, que: string, cambios?: Cambios) {
  await registrarAuditoria({
    workspaceId: ctx.workspaceId,
    actor: actorDe(ctx.contexto.user),
    accion: "configuracion.cambiada",
    entidad: { tipo: "integracion", etiqueta: `Integraciones: ${que}` },
    cambios,
  });
}

/** La definición del proveedor, o null si no es ni del catálogo ni una fila del workspace. */
async function definicionDelWorkspace(
  supabase: Contexto["supabase"],
  workspaceId: string,
  proveedor: string
) {
  const { data: fila } = await supabase
    .from("integration_configs")
    .select("tipo, nombre")
    .eq("workspace_id", workspaceId)
    .eq("proveedor", proveedor)
    .maybeSingle();
  if (!fila && !PROVEEDORES[proveedor]) return null;
  return definicionDe(proveedor, fila?.tipo, fila?.nombre);
}

/**
 * Guarda la clave de un proveedor en Vault. Las de Zernio y Resend no pasan por
 * acá: se guardan con "Probar y guardar", que primero las prueba contra el
 * proveedor. La de Zernio además sincroniza los canales
 * (`/api/v1/channels/test-key`); la de Resend es `probarYGuardarResend`.
 */
export async function guardarClave(proveedor: string, valor: string): Promise<Resultado<{ mascara: Mascara | null }>> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const d = await definicionDelWorkspace(supabase, workspaceId, proveedor);
  if (!d) return { ok: false, error: "Esa integración no existe." };
  if (!d.editable) return { ok: false, error: `La clave de ${d.nombre} no se carga desde esta pantalla.` };
  if (proveedor === "zernio") return { ok: false, error: "La clave de Zernio se guarda con \"Probar y guardar\"." };
  if (proveedor === "resend") return { ok: false, error: "La clave de Resend se guarda con \"Probar y guardar\"." };

  const motivo = validarFormatoClave(d, valor);
  if (motivo) return { ok: false, error: motivo };

  const clave = valor.trim();
  const { error } = await setWorkspaceSecret(supabase, workspaceId, d.secreto, clave);
  if (error) return { ok: false, error: "No se pudo guardar la clave en Vault. No se guardó nada." };

  await supabase
    .from("integration_configs")
    .update({ estado: "sin_verificar", ultimo_error: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("proveedor", proveedor);

  await auditarConfiguracion(ctx, `clave de ${d.nombre} guardada`);
  revalidatePath(RUTA);
  return { ok: true, mascara: mascaraDeClave(clave) };
}

function configComoObjeto(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

/**
 * "Probar y guardar" de Resend (F23). Prueba la clave contra Resend ANTES de
 * guardarla, por el mismo camino que la verificación al abrir la pantalla
 * (`consultarProveedor`, que consulta `GET /domains`). Si Resend dice que la
 * clave es inválida, no se guarda nada.
 *
 * Una clave de solo envío responde 401 `restricted_api_key` a esa consulta, y
 * eso es "conectado": la clave sirve para mandar, que es lo único que se le
 * pide (mapeo en `estadoResend`).
 *
 * El remitente viaja en la misma acción porque sin él no sale ningún correo.
 * No es secreto: va en `config`.
 */
export async function probarYGuardarResend(
  valor: string,
  remitente: string
): Promise<Resultado<{ mascara: Mascara | null; estado: string; detalle: string | null }>> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const motivo = validarFormatoClave(PROVEEDORES.resend, valor);
  if (motivo) return { ok: false, error: motivo };
  const motivoRemitente = validarRemitente(remitente);
  if (motivoRemitente) return { ok: false, error: motivoRemitente };

  const clave = valor.trim();
  const d = await consultarProveedor("resend", clave);
  if (d.estado === "desconectado") {
    return { ok: false, error: "No pudimos conectar con Resend: la clave no es válida. Revisá que la copiaste completa." };
  }

  const { error } = await setWorkspaceSecret(supabase, workspaceId, PROVEEDORES.resend.secreto, clave);
  if (error) return { ok: false, error: "No se pudo guardar la clave en Vault. No se guardó nada." };

  const { data: fila } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("proveedor", "resend")
    .maybeSingle();
  const ahora = new Date().toISOString();
  await supabase
    .from("integration_configs")
    .update({
      estado: d.estado,
      ultimo_error: d.error,
      verificado_el: ahora,
      config: { ...configComoObjeto(fila?.config), remitente: remitente.trim(), detalle: d.detalle ?? null },
      updated_at: ahora,
    })
    .eq("workspace_id", workspaceId)
    .eq("proveedor", "resend");

  const remitenteAntes = configComoObjeto(fila?.config).remitente ?? null;
  await auditarConfiguracion(
    ctx,
    "clave de Resend guardada",
    remitenteAntes === remitente.trim() ? undefined : { remitente: { antes: remitenteAntes, despues: remitente.trim() } }
  );
  revalidatePath(RUTA);
  return { ok: true, mascara: mascaraDeClave(clave), estado: d.estado, detalle: d.detalle ?? null };
}

/** Cambia solo el remitente de Resend, sin tocar la clave. */
export async function guardarRemitenteResend(remitente: string): Promise<Resultado> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const motivo = validarRemitente(remitente);
  if (motivo) return { ok: false, error: motivo };

  const { data: fila } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("proveedor", "resend")
    .maybeSingle();
  const { error } = await supabase
    .from("integration_configs")
    .update({
      config: { ...configComoObjeto(fila?.config), remitente: remitente.trim() },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("proveedor", "resend");
  if (error) return { ok: false, error: "No se pudo guardar el remitente." };

  await auditarConfiguracion(ctx, "remitente de Resend", {
    remitente: { antes: configComoObjeto(fila?.config).remitente ?? null, despues: remitente.trim() },
  });
  revalidatePath(RUTA);
  return { ok: true };
}

/** Borra la clave de Vault. La integración queda "sin configurar". */
export async function borrarClave(proveedor: string): Promise<Resultado> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const d = await definicionDelWorkspace(supabase, workspaceId, proveedor);
  if (!d) return { ok: false, error: "Esa integración no existe." };
  // La de Zernio no se borra desde acá: sin ella dejan de salir las respuestas
  // de Instagram. Lo que se desconecta es la cuenta, con confirmación.
  if (!d.editable || proveedor === "zernio") return { ok: false, error: `La clave de ${d.nombre} no se borra desde esta pantalla.` };

  const { error } = await deleteWorkspaceSecret(supabase, workspaceId, d.secreto);
  if (error) return { ok: false, error: "No se pudo borrar la clave de Vault." };

  await supabase
    .from("integration_configs")
    .update({ estado: "sin_configurar", ultimo_error: null, verificado_el: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("proveedor", proveedor);

  await auditarConfiguracion(ctx, `clave de ${d.nombre} borrada`);
  revalidatePath(RUTA);
  return { ok: true };
}

/** Guarda el modelo por defecto de un proveedor de IA. No es un secreto: va en `config`. */
export async function guardarModelo(proveedor: string, modelo: string): Promise<Resultado> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const d = await definicionDelWorkspace(supabase, workspaceId, proveedor);
  if (!d?.conModelo) return { ok: false, error: "Esa integración no lleva modelo." };

  const m = modelo.trim();
  if (m && !/^[A-Za-z0-9._:/-]{1,100}$/.test(m)) {
    return { ok: false, error: "El nombre del modelo solo puede tener letras, números y . _ : / -" };
  }

  const { data: fila } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("proveedor", proveedor)
    .maybeSingle();
  const config = fila?.config && typeof fila.config === "object" && !Array.isArray(fila.config) ? fila.config : {};

  const { error } = await supabase
    .from("integration_configs")
    .update({ config: { ...config, modelo: m || null }, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("proveedor", proveedor);
  if (error) return { ok: false, error: "No se pudo guardar el modelo." };

  const modeloAntes = (config as Record<string, unknown>).modelo ?? null;
  if (modeloAntes !== (m || null)) {
    await auditarConfiguracion(ctx, `modelo por defecto de ${d.nombre}`, {
      modelo: { antes: modeloAntes, despues: m || null },
    });
  }
  revalidatePath(RUTA);
  return { ok: true };
}

/**
 * Al abrir la pantalla: le pregunta a cada proveedor configurado y escribe el
 * resultado. No devuelve los estados a propósito: le llegan a la pantalla por
 * Realtime, que es el mismo camino por el que llega un fallo de una operación
 * real. Si Realtime no anduviera, la pantalla no se actualizaría, y eso se ve;
 * un refresco acá lo escondería.
 */
export async function verificarIntegraciones(): Promise<Resultado> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  await verificarTodas(ctx.contexto.supabase, ctx.workspaceId);
  return { ok: true };
}

function estadoHttp(e: unknown): number | null {
  const s = (e as { statusCode?: unknown })?.statusCode;
  return typeof s === "number" ? s : null;
}

/**
 * Desconecta una cuenta de Instagram en Zernio.
 *
 * Pide que se escriba el nombre de la cuenta, y lo compara acá, en el servidor:
 * la cuenta conectada es la del negocio y recibe leads reales, y un clic no
 * puede cortar el único canal vivo (criterio de F24, 23/09/2026).
 *
 * NO BORRA EL CANAL. `DELETE /api/v1/channels/[channelId]` borra la fila y, en
 * cascada, las conversaciones y sus mensajes; acá el canal queda inactivo y el
 * historial se conserva, que es lo que exige el `CLAUDE.md`.
 */
export async function desconectarCuentaInstagram(channelId: string, confirmacion: string): Promise<Resultado> {
  const ctx = await contextoManager();
  if (!ctx.ok) return ctx;
  const { supabase } = ctx.contexto;
  const workspaceId = ctx.workspaceId;

  const { data: canal } = await supabase
    .from("channels")
    .select("id, username, late_account_id, platform, provider")
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!canal || canal.platform !== "instagram" || canal.provider !== "zernio") {
    return { ok: false, error: "No se encontró esa cuenta de Instagram." };
  }

  if (!confirmacionCoincide(confirmacion, canal.username)) {
    return { ok: false, error: `Para desconectar, escribí el nombre de la cuenta: @${canal.username}.` };
  }

  const apiKey = await getZernioApiKey(supabase, workspaceId);
  if (!apiKey) return { ok: false, error: "No hay clave de Zernio cargada, así que no se puede desconectar la cuenta." };

  try {
    const res = (await createZernioClient(apiKey).accounts.deleteAccount({
      path: { accountId: canal.late_account_id },
    })) as { error?: unknown; response?: { status?: number } } | undefined;
    // El SDK tira en las respuestas que no son 2xx, pero se contempla también
    // la forma con `error`, que es la que usa la ruta vieja.
    if (res?.error && res.response?.status !== 404) {
      return { ok: false, error: "Zernio no desconectó la cuenta. El canal sigue activo." };
    }
  } catch (e) {
    // 404: la cuenta ya no estaba en Zernio. Para nosotros, desconectada.
    if (estadoHttp(e) !== 404) {
      const detalle = e instanceof Error ? e.message : "error desconocido";
      return { ok: false, error: `Zernio no desconectó la cuenta (${detalle}). El canal sigue activo.` };
    }
  }

  // Un UPDATE que no toca ninguna fila no da error (la lección del Bloque 1),
  // así que se piden las filas de vuelta. Si falla o no toca ninguna, la cuenta
  // igual ya no está en Zernio: se audita la desconexión, con la marca de que el
  // CRM no quedó al día, y no se responde ok. No se promete qué hace después la
  // sincronización: depende de si quedan otras cuentas (hallazgo del 08/10/2026).
  const { data: tocadas, error: errorUpdate } = await supabase
    .from("channels")
    .update({ is_active: false })
    .eq("id", canal.id)
    .eq("workspace_id", workspaceId)
    .select("id");
  const crmActualizado = !errorUpdate && (tocadas?.length ?? 0) > 0;

  await registrarAuditoria({
    workspaceId,
    actor: actorDe(ctx.contexto.user),
    accion: "canal.desconectado",
    entidad: { tipo: "canal", id: canal.id, etiqueta: etiquetaDeCanal(canal) },
    detalle: crmActualizado ? { motivo: "desconectado_a_mano" } : { motivo: "desconectado_a_mano", crm_actualizado: false },
  });
  revalidatePath(RUTA);
  if (!crmActualizado) {
    return { ok: false, error: "La cuenta se desconectó en Zernio, pero el CRM no se actualizó: el canal sigue figurando activo." };
  }
  return { ok: true };
}
