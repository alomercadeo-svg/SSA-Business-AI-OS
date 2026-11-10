/**
 * F37, parte 2: el proceso en segundo plano con sus dependencias reales
 * (Supabase con la clave de servicio, el historial y el correo de F23). Solo
 * servidor. Lo llaman la subida por tandas y la tarea programada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createServiceClient } from "@/lib/supabase/server";
import { registrarAuditoria } from "@/lib/auditoria";
import { miembrosDelEspacio } from "@/lib/miembros";
import { notificarFinDeImportacion } from "@/lib/correo";
import { claveDeEtiqueta } from "@/lib/importacion-contactos";
import { almacenSupabase, medirControl } from "@/lib/importacion-almacen";
import { colaSupabase, importacionesPendientes, procesarImportacion, type DependenciasDeProceso } from "@/lib/importacion-segundo-plano";

type Cliente = SupabaseClient<Database>;

export function dependenciasReales(servicio: Cliente): DependenciasDeProceso {
  return {
    cola: colaSupabase(servicio),
    ahora: () => new Date(),
    // Sin sesión: la clave de servicio, acotada al espacio. El rol de Owner o
    // Admin se comprobó al empezar la importación.
    almacenPara: (imp, eventos) =>
      almacenSupabase({ escritura: servicio, servicio, workspaceId: imp.workspaceId, importacionId: imp.id, actor: imp.opciones.actor, eventos }),
    catalogosPara: async (imp) => {
      const [tags, campos, miembros] = await Promise.all([
        servicio.from("tags").select("id, name").eq("workspace_id", imp.workspaceId),
        servicio.from("custom_field_definitions").select("id, slug, type").eq("workspace_id", imp.workspaceId),
        miembrosDelEspacio(imp.workspaceId),
      ]);
      if (tags.error || campos.error) throw new Error("No se pudieron leer las etiquetas y los campos.");
      return {
        etiquetas: new Map((tags.data ?? []).map((t) => [claveDeEtiqueta(String(t.name)), t.id as string])),
        campos: new Map((campos.data ?? []).map((c) => [String(c.slug), { id: c.id as string, tipo: String(c.type) }])),
        miembros: new Map(miembros.map((m) => [m.etiqueta.toLowerCase(), m.id])),
      };
    },
    auditar: async (eventos) => {
      // De a 500 por pedido: una importación de 10.000 filas son 10.000 altas.
      for (let i = 0; i < eventos.length; i += 500) await registrarAuditoria(eventos.slice(i, i + 500));
    },
    medirControl: (imp, ids) => medirControl(servicio, imp.workspaceId, ids),
    avisar: async (imp, r) => {
      await notificarFinDeImportacion(servicio, {
        workspaceId: imp.workspaceId,
        usuarioId: imp.creadoPor,
        id: imp.id,
        nombreArchivo: imp.nombreArchivo,
        filas: imp.filas,
        creados: r.creados,
        actualizados: r.actualizados,
        conError: r.conError,
        estado: r.estado,
        control: r.control,
      });
    },
  };
}

export async function correrImportacion(id: string) {
  const servicio = await createServiceClient();
  return procesarImportacion(id, dependenciasReales(servicio));
}

/** Para la tarea programada: retoma las que esperan sin nadie que las procese. */
export async function reanudarImportaciones(servicio: Cliente): Promise<number> {
  const ids = await importacionesPendientes(servicio, new Date());
  for (const id of ids) await procesarImportacion(id, dependenciasReales(servicio));
  return ids.length;
}
