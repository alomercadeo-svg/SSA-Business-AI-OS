"use server";

/**
 * F36, Configuración › Respuestas rápidas: crear, editar y eliminar. Solo Owner
 * y Admin: lo controla este servidor y, en la base, las políticas de la 00052.
 * Eliminar marca la fecha (`eliminar_respuesta_rapida`, que exige manager): la
 * purga de F30 la borra a los 30 días. Cada cambio queda en el historial como
 * «configuracion.cambiada» del espacio (F31), sin el texto de la respuesta.
 *
 * En la interfaz se llaman «Respuestas rápidas», nunca «plantillas».
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { actorDe, registrarAuditoria, type Cambios } from "@/lib/auditoria";
import { validarRespuesta } from "@/lib/respuestas-rapidas";

type Resultado = { ok: true } | { ok: false; error: string };
type Entrada = { nombre: string; atajo: string; contenido: string };

const RUTA = "/dashboard/settings/response-templates";

async function contextoManager() {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false as const, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false as const, error: "Solo Owner y Admin pueden cambiar las respuestas rápidas." };
  return { ok: true as const, contexto };
}

type Contexto = Extract<Awaited<ReturnType<typeof contextoManager>>, { ok: true }>["contexto"];

async function auditar(ctx: Contexto, que: string, cambios?: Cambios) {
  await registrarAuditoria({
    workspaceId: ctx.workspace.id,
    actor: actorDe(ctx.user),
    accion: "configuracion.cambiada",
    entidad: { tipo: "espacio", id: ctx.workspace.id, etiqueta: `Respuestas rápidas: ${que}` },
    cambios,
  });
}

const atajoRepetido = (atajo: string) => ({ ok: false as const, error: `Ya hay una respuesta rápida con el atajo «/${atajo}».` });

export async function crearRespuestaRapida(entrada: Entrada): Promise<Resultado> {
  const c = await contextoManager();
  if (!c.ok) return c;
  const v = validarRespuesta(entrada);
  if (!v.ok) return v;
  const { data, error } = await c.contexto.supabase
    .from("response_templates")
    .insert({ workspace_id: c.contexto.workspace.id, ...v.valor, created_by: c.contexto.user.id })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return atajoRepetido(v.valor.atajo);
  if (error || !data) {
    console.error("respuestas rápidas: no se pudo crear:", error?.message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
  await auditar(c.contexto, `creada «${v.valor.nombre}» (/${v.valor.atajo})`);
  revalidatePath(RUTA);
  return { ok: true };
}

export async function editarRespuestaRapida(id: string, entrada: Entrada): Promise<Resultado> {
  const c = await contextoManager();
  if (!c.ok) return c;
  const v = validarRespuesta(entrada);
  if (!v.ok) return v;
  const { supabase, workspace } = c.contexto;
  const { data: antes } = await supabase
    .from("response_templates")
    .select("id, nombre, atajo, contenido")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!antes) return { ok: false, error: "No se encontró esa respuesta rápida." };
  const { data, error } = await supabase
    .from("response_templates")
    .update(v.valor)
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return atajoRepetido(v.valor.atajo);
  if (error || !data) {
    console.error("respuestas rápidas: no se pudo editar:", error?.message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
  const cambios: Cambios = {};
  for (const k of ["nombre", "atajo"] as const) if (antes[k] !== v.valor[k]) cambios[k] = { antes: antes[k], despues: v.valor[k] };
  if (antes.contenido !== v.valor.contenido) cambios.contenido = { antes: "(texto anterior)", despues: "(texto nuevo)" };
  await auditar(c.contexto, `editada «${v.valor.nombre}» (/${v.valor.atajo})`, cambios);
  revalidatePath(RUTA);
  return { ok: true };
}

export async function eliminarRespuestaRapida(id: string): Promise<Resultado> {
  const c = await contextoManager();
  if (!c.ok) return c;
  const { supabase, workspace } = c.contexto;
  const { data: antes } = await supabase
    .from("response_templates")
    .select("id, nombre, atajo")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const { data: eliminada, error } = await supabase.rpc("eliminar_respuesta_rapida", { p_id: id });
  if (error) {
    console.error("respuestas rápidas: no se pudo eliminar:", error.message);
    return { ok: false, error: "No se pudo eliminar. Probá de nuevo." };
  }
  if (eliminada !== true || !antes) return { ok: false, error: "No se encontró esa respuesta rápida." };
  await auditar(c.contexto, `eliminada «${antes.nombre}» (/${antes.atajo})`);
  revalidatePath(RUTA);
  return { ok: true };
}
