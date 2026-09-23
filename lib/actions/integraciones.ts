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
import { definicionDe, validarFormatoClave, mascaraDeClave, PROVEEDORES, type Mascara } from "@/lib/integraciones";
import { verificarTodas } from "@/lib/integraciones-estado";

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
 * Guarda la clave de un proveedor en Vault. La de Zernio no pasa por acá: se
 * guarda con "Probar y guardar", que primero la valida contra Zernio y después
 * sincroniza los canales (`/api/v1/channels/test-key`).
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

  revalidatePath(RUTA);
  return { ok: true, mascara: mascaraDeClave(clave) };
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

const normalizarCuenta = (s: string | null | undefined) => (s ?? "").trim().replace(/^@/, "").toLowerCase();

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

  const esperado = normalizarCuenta(canal.username);
  if (!esperado || normalizarCuenta(confirmacion) !== esperado) {
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

  await supabase.from("channels").update({ is_active: false }).eq("id", canal.id).eq("workspace_id", workspaceId);

  revalidatePath(RUTA);
  return { ok: true };
}
