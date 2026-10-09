"use server";

/**
 * El guardado de la pestaña General de Configuración.
 *
 * Hasta el 07/10/2026 corría en el navegador (`settings-view.tsx`), con el
 * cliente de Supabase del usuario. Pasó a acción de servidor por F31: desde el
 * navegador no hay forma de registrar en el historial quién cambió qué con un
 * autor confiable, y además el fork pone las mutaciones de la interfaz en
 * acciones de servidor. Guarda el nombre, las palabras clave globales, la zona
 * horaria y el horario de atención (F39, desde el 09/10/2026) y, si se
 * escriben, las claves de Zernio y de IA, que van a Vault.
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { SECRET_NAMES, setWorkspaceSecret } from "@/lib/vault";
import { actorDe, registrarAuditoria, type Cambios, type EventoAuditoria } from "@/lib/auditoria";
import { validarHorario, zonaValida } from "@/lib/horas-habiles";
import type { Json } from "@/lib/types/database";

type Resultado = { ok: true } | { ok: false; error: string };

const mismaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export async function guardarGeneral(entrada: {
  nombre: string;
  palabrasClave: string[];
  claveZernio?: string;
  claveIa?: string;
  /** F39: la zona IANA del negocio y su horario de atención (00033). */
  zonaHoraria?: string;
  horario?: unknown;
}): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar la configuración." };
  const { supabase, workspace, user } = contexto;

  const nombre = entrada.nombre.trim();
  if (!nombre) return { ok: false, error: "El nombre del espacio de trabajo no puede quedar vacío." };
  const palabras = (entrada.palabrasClave ?? []).map((k) => String(k).trim()).filter(Boolean);

  // F39: se validan en el servidor, no solo en el formulario. La base solo
  // exige que el horario sea un objeto (00033).
  const zona = entrada.zonaHoraria === undefined ? undefined : entrada.zonaHoraria.trim();
  if (zona !== undefined && !zonaValida(zona)) return { ok: false, error: "La zona horaria no es válida." };
  const horario = entrada.horario === undefined ? undefined : validarHorario(entrada.horario);
  if (horario === null) {
    return { ok: false, error: "El horario de atención no es válido: cada franja tiene que terminar después de empezar." };
  }

  const { data: antes } = await supabase
    .from("workspaces")
    .select("name, global_keywords, zona_horaria, horario_atencion")
    .eq("id", workspace.id)
    .single();

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({
      name: nombre,
      global_keywords: palabras,
      ...(zona !== undefined ? { zona_horaria: zona } : {}),
      ...(horario ? { horario_atencion: horario as unknown as Json } : {}),
    })
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
  if (zona !== undefined && antes && antes.zona_horaria !== zona) cambios.zona_horaria = { antes: antes.zona_horaria, despues: zona };
  if (horario && antes && JSON.stringify(validarHorario(antes.horario_atencion)) !== JSON.stringify(horario)) {
    cambios.horario_atencion = { antes: antes.horario_atencion, despues: horario };
  }
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
