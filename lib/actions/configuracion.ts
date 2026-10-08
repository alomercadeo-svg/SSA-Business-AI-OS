"use server";

/**
 * El guardado de la pestaña General de Configuración.
 *
 * Hasta el 07/10/2026 corría en el navegador (`settings-view.tsx`), con el
 * cliente de Supabase del usuario. Pasó a acción de servidor por F31: desde el
 * navegador no hay forma de registrar en el historial quién cambió qué con un
 * autor confiable, y además el fork pone las mutaciones de la interfaz en
 * acciones de servidor. Lo que guarda no cambió: el nombre, las palabras clave
 * globales y, si se escriben, las claves de Zernio y de IA, que van a Vault.
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { SECRET_NAMES, setWorkspaceSecret } from "@/lib/vault";
import { actorDe, registrarAuditoria, type Cambios, type EventoAuditoria } from "@/lib/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

const mismaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export async function guardarGeneral(entrada: {
  nombre: string;
  palabrasClave: string[];
  claveZernio?: string;
  claveIa?: string;
}): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar la configuración." };
  const { supabase, workspace, user } = contexto;

  const nombre = entrada.nombre.trim();
  if (!nombre) return { ok: false, error: "El nombre del espacio de trabajo no puede quedar vacío." };
  const palabras = (entrada.palabrasClave ?? []).map((k) => String(k).trim()).filter(Boolean);

  const { data: antes } = await supabase
    .from("workspaces")
    .select("name, global_keywords")
    .eq("id", workspace.id)
    .single();

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({ name: nombre, global_keywords: palabras })
    .eq("id", workspace.id)
    .select("id")
    .single();
  if (updateError) return { ok: false, error: "No se pudo guardar: revisá la conexión y volvé a intentar." };

  const actor = actorDe(user);
  const eventos: EventoAuditoria[] = [];
  const cambios: Cambios = {};
  if (antes && antes.name !== nombre) cambios.name = { antes: antes.name, despues: nombre };
  const palabrasAntes = ((antes?.global_keywords as string[] | null) ?? []).map(String);
  if (!mismaLista(palabrasAntes, palabras)) cambios.global_keywords = { antes: palabrasAntes, despues: palabras };
  if (Object.keys(cambios).length) {
    eventos.push({
      workspaceId: workspace.id,
      actor,
      accion: "configuracion.cambiada",
      entidad: { tipo: "espacio", id: workspace.id, etiqueta: "General" },
      cambios,
    });
  }

  const claves: Array<[string | undefined, (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES], string]> = [
    [entrada.claveZernio, SECRET_NAMES.zernio, "Zernio"],
    [entrada.claveIa, SECRET_NAMES.aiGateway, "IA"],
  ];
  for (const [valor, secreto, nombreClave] of claves) {
    if (!valor?.trim()) continue;
    const { error } = await setWorkspaceSecret(supabase, workspace.id, secreto, valor.trim());
    if (error) {
      await registrarAuditoria(eventos);
      return { ok: false, error: `No se pudo guardar la clave de ${nombreClave}.` };
    }
    eventos.push({
      workspaceId: workspace.id,
      actor,
      accion: "configuracion.cambiada",
      entidad: { tipo: "integracion", etiqueta: `General: clave de ${nombreClave} guardada` },
    });
  }

  await registrarAuditoria(eventos);
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
