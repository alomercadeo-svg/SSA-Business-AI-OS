/**
 * F37: el almacén de contactos de la importación, sobre Supabase. Lo usan la
 * importación en el momento (`POST /api/v1/contacts/importar`, con la sesión
 * de quien importa para escribir) y la de segundo plano
 * (`lib/importacion-segundo-plano.ts`, con la clave de servicio, porque ya no
 * hay sesión; el rol se comprobó al empezar).
 *
 * Buscar duplicados va siempre con la clave de servicio, acotado al espacio:
 * la seguridad por filas esconde los eliminados (00038) y uno eliminado tiene
 * que verse para no duplicarlo. Las notas también, para que el disparador de
 * `contact_notes` conserve la marca en `author_label`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Actor, EventoAuditoria } from "@/lib/auditoria";
import { RechazoDeLaBase, type AlmacenDeContactos, type DatosDeContacto } from "@/lib/importacion-contactos";

type Cliente = SupabaseClient<Database>;
type ContactoInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type ContactoUpdate = Database["public"]["Tables"]["contacts"]["Update"];

/**
 * F38: un rechazo por una restricción de `00030` (código 23514) es de la fila,
 * no de la importación. Cualquier otro error sigue cortando.
 */
export function errorDeContacto(error: { code?: string; message: string } | null, respaldo: string): Error {
  if (error?.code === "23514") {
    if (error.message.includes("contacts_pipeline_stage_check")) return new RechazoDeLaBase("pipeline_stage");
    if (error.message.includes("contacts_deal_status_check")) return new RechazoDeLaBase("deal_status");
  }
  return new Error(`contacts: ${error?.message ?? respaldo}`);
}

const escaparLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function almacenSupabase(p: {
  /** Con qué se crean y cambian contactos, etiquetas y campos. */
  escritura: Cliente;
  servicio: Cliente;
  workspaceId: string;
  importacionId: string;
  actor: Actor;
  /** Donde se juntan las ediciones para el historial. */
  eventos: EventoAuditoria[];
}): AlmacenDeContactos {
  const { escritura, servicio, workspaceId, importacionId, actor, eventos } = p;
  return {
    async buscarPor(campo, valor) {
      let q = servicio.from("contacts").select("id, deleted_at, pipedrive_person_id").eq("workspace_id", workspaceId);
      q = campo === "email" ? q.ilike("email", escaparLike(valor)) : q.eq(campo, valor);
      const { data, error } = await q.order("deleted_at", { ascending: false, nullsFirst: true }).limit(1);
      if (error) throw new Error(`contacts: ${error.message}`);
      const c = data?.[0] as { id: string; deleted_at: string | null; pipedrive_person_id: string | null } | undefined;
      return c ? { id: c.id, eliminado: c.deleted_at !== null, pipedrivePersonId: c.pipedrive_person_id } : null;
    },
    async crear(datos) {
      const { data, error } = await escritura.from("contacts").insert({ workspace_id: workspaceId, ...datos } as ContactoInsert).select("id").single();
      if (error || !data) throw errorDeContacto(error, "sin id");
      return data.id as string;
    },
    async actualizar(id, datos) {
      const campos = Object.keys(datos) as (keyof DatosDeContacto)[];
      const { data: antes } = await escritura.from("contacts").select(campos.join(", ")).eq("id", id).maybeSingle();
      const { error } = await escritura.from("contacts").update(datos as ContactoUpdate).eq("id", id);
      if (error) throw errorDeContacto(error, "");
      const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
      for (const c of campos) {
        const previo = (antes as Record<string, unknown> | null)?.[c] ?? null;
        if (previo !== datos[c]) cambios[c] = { antes: previo, despues: datos[c] };
      }
      if (Object.keys(cambios).length) {
        eventos.push({ workspaceId, actor, accion: "contacto.editado", entidad: { tipo: "contacto", id }, cambios, detalle: { importacion: importacionId } });
      }
    },
    async ponerEtiquetas(id, tagIds) {
      const { error } = await escritura
        .from("contact_tags")
        .upsert(tagIds.map((tag_id) => ({ contact_id: id, tag_id })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (error) throw new Error(`contact_tags: ${error.message}`);
    },
    async crearEtiqueta(nombre) {
      const { data, error } = await escritura.from("tags").insert({ workspace_id: workspaceId, name: nombre.slice(0, 60) }).select("id").single();
      if (error || !data) throw new Error(`tags: ${error?.message ?? "sin id"}`);
      return data.id as string;
    },
    async ponerCampos(id, valores) {
      const ahora = new Date().toISOString();
      const { error } = await escritura
        .from("contact_custom_fields")
        .upsert(valores.map((v) => ({ contact_id: id, field_id: v.fieldId, value: v.value, updated_at: ahora })), { onConflict: "contact_id,field_id" });
      if (error) throw new Error(`contact_custom_fields: ${error.message}`);
    },
    async ponerNota(contactoId, marca, texto) {
      const { data: previa, error: errPrevia } = await servicio
        .from("contact_notes")
        .select("id")
        .eq("contact_id", contactoId)
        .eq("author_label", marca)
        .eq("body", texto)
        .limit(1);
      if (errPrevia) throw new Error(`contact_notes: ${errPrevia.message}`);
      if (previa?.length) return false;
      const { error } = await servicio.from("contact_notes").insert({ workspace_id: workspaceId, contact_id: contactoId, author_label: marca, body: texto });
      if (error) throw new Error(`contact_notes: ${error.message}`);
      return true;
    },
  };
}

/** F38, el control: ids de trato distintos del archivo encontrados en el espacio, y el total del espacio. */
export async function medirControl(servicio: Cliente, workspaceId: string, idsDelArchivo: string[]) {
  const ids = [...new Set(idsDelArchivo.filter(Boolean))];
  const base = () =>
    servicio.from("contacts").select("pipedrive_deal_id").eq("workspace_id", workspaceId).is("deleted_at", null).not("pipedrive_deal_id", "is", null);
  // De a 300 ids por pedido: la lista va en la dirección.
  const encontrados = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await base().in("pipedrive_deal_id", ids.slice(i, i + 300));
    if (error) return { medido: false as const };
    for (const c of data ?? []) encontrados.add(String(c.pipedrive_deal_id));
  }
  const { count, error } = await servicio
    .from("contacts")
    .select("pipedrive_deal_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .not("pipedrive_deal_id", "is", null);
  if (error) return { medido: false as const };
  return { medido: true as const, enArchivo: ids.length, encontrados: encontrados.size, enEspacio: count ?? 0 };
}
