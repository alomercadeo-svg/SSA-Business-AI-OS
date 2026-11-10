import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { origenPermitido } from "@/lib/asignacion";
import { miembrosDelEspacio } from "@/lib/miembros";
import { actorDe, registrarAuditoria, type EventoAuditoria } from "@/lib/auditoria";
import type { Database } from "@/lib/types/database";
import { MAX_FILAS_PARTE_1, prepararFila, type Campo } from "@/lib/importacion-csv";
import {
  RechazoDeLaBase,
  claveDeEtiqueta,
  controlDeMigracion,
  importarFilas,
  type AlmacenDeContactos,
  type DatosDeContacto,
} from "@/lib/importacion-contactos";

/**
 * F37, parte 1 (09/11/2026): `POST /api/v1/contacts/importar`.
 *
 * Esta noche, solo Owner y Admin (decidido por Marcos): un Member recibe 403,
 * controlado acá. Hasta 500 filas, en el momento (más de 500, en segundo
 * plano, es la parte 2).
 *
 * La pantalla manda las celdas crudas y el mapeo; cada fila se vuelve a
 * preparar acá (el teléfono se normaliza en el servidor). Buscar duplicados va
 * con la clave de servicio, acotado al espacio, porque la seguridad por filas
 * esconde los eliminados (00038) y uno eliminado tiene que verse para no
 * duplicarlo. Crear y cambiar contactos, etiquetas y campos va con la sesión
 * de quien importa: la seguridad por filas decide. `csv_imports` lo escribe
 * solo el servidor (00054: sin políticas de escritura).
 */
const PATRON_CODIGO = /^\+[1-9][0-9]{0,3}$/;
const CAMPOS_FIJOS = new Set([
  "nombre",
  "correo",
  "telefono",
  "pipedrive",
  "setter",
  "vendedor",
  "etiquetas",
  "no_importar",
  // F38
  "etapa",
  "estado_trato",
  "valor",
  "moneda",
  "fecha_cierre",
  "pipedrive_trato",
  "nota",
]);

/**
 * F38: un rechazo por una restricción de `00030` (código 23514) es de la fila,
 * no de la importación. Cualquier otro error sigue cortando, como antes.
 */
/**
 * La etapa y el estado llegan como texto de la planilla y los valida la base
 * (`00030`), a propósito: el rechazo se muestra por fila. Por eso el tipo se
 * afirma acá, en el borde, y no se filtra antes con una copia de la lista.
 */
type ContactoInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type ContactoUpdate = Database["public"]["Tables"]["contacts"]["Update"];

function errorDeContacto(error: { code?: string; message: string } | null, respaldo: string): Error {
  if (error?.code === "23514") {
    if (error.message.includes("contacts_pipeline_stage_check")) return new RechazoDeLaBase("pipeline_stage");
    if (error.message.includes("contacts_deal_status_check")) return new RechazoDeLaBase("deal_status");
  }
  return new Error(`contacts: ${error?.message ?? respaldo}`);
}

interface Pedido {
  nombreArchivo: string;
  etiquetaOrigen: string | null;
  codigoPais: string;
  asignarA: string | null;
  mapeo: Campo[];
  filas: string[][];
}

function leerPedido(c: unknown): Pedido | string {
  const p = (c ?? {}) as Partial<Pedido>;
  if (!Array.isArray(p.filas) || !p.filas.every((f) => Array.isArray(f) && f.every((v) => typeof v === "string"))) return "Pedido inválido.";
  if (!Array.isArray(p.mapeo) || !p.mapeo.every((m) => typeof m === "string" && (CAMPOS_FIJOS.has(m) || m.startsWith("campo:")))) return "Pedido inválido.";
  if (p.filas.length === 0) return "La planilla no tiene filas.";
  if (p.filas.length > MAX_FILAS_PARTE_1) return "Por ahora, hasta 500 filas por importación.";
  if (typeof p.codigoPais !== "string" || !PATRON_CODIGO.test(p.codigoPais)) return "El código de país tiene que ser como +506.";
  if (p.asignarA !== null && typeof p.asignarA !== "string") return "Pedido inválido.";
  return {
    nombreArchivo: typeof p.nombreArchivo === "string" ? p.nombreArchivo.slice(0, 200) : "planilla.csv",
    etiquetaOrigen: typeof p.etiquetaOrigen === "string" && p.etiquetaOrigen.trim() ? p.etiquetaOrigen.trim().slice(0, 60) : null,
    codigoPais: p.codigoPais,
    asignarA: p.asignarA ?? null,
    mapeo: p.mapeo,
    filas: p.filas,
  };
}

const escaparLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function POST(request: NextRequest) {
  if (!origenPermitido(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return NextResponse.json({ error: "Pedido rechazado: no viene de la aplicación." }, { status: 403 });
  }
  const ctx = await getWorkspaceOrNull();
  if (!ctx) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });
  if (!esManager(ctx.role)) {
    return NextResponse.json({ code: "solo_managers", error: "Por ahora, importar contactos es de Owner y Admin." }, { status: 403 });
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }
  const pedido = leerPedido(cuerpo);
  if (typeof pedido === "string") return NextResponse.json({ error: pedido }, { status: 400 });

  const { supabase, user } = ctx;
  const workspaceId = ctx.workspace.id;
  const servicio = await createServiceClient();

  const miembros = await miembrosDelEspacio(workspaceId);
  if (pedido.asignarA && !miembros.some((m) => m.id === pedido.asignarA)) {
    return NextResponse.json({ error: "Esa persona no es parte del equipo." }, { status: 400 });
  }
  const [tags, campos] = await Promise.all([
    supabase.from("tags").select("id, name").eq("workspace_id", workspaceId),
    supabase.from("custom_field_definitions").select("id, slug, type").eq("workspace_id", workspaceId),
  ]);
  if (tags.error || campos.error) return NextResponse.json({ error: "No se pudieron leer las etiquetas y los campos. Probá de nuevo." }, { status: 503 });

  // La etiqueta de origen de «Opciones» se crea la primera vez si no existe
  // (retrabajo del 09/11, a, decisión de la revisión, vetable): la propuso el
  // importador. Las de la planilla solo se usan si ya existen.
  const etiquetas = new Map((tags.data ?? []).map((t) => [claveDeEtiqueta(String(t.name)), t.id as string]));
  let etiquetaOrigenId: string | null = null;
  if (pedido.etiquetaOrigen) {
    etiquetaOrigenId = etiquetas.get(claveDeEtiqueta(pedido.etiquetaOrigen)) ?? null;
    if (!etiquetaOrigenId) {
      const { data: nueva, error: errEtiqueta } = await supabase
        .from("tags")
        .insert({ workspace_id: workspaceId, name: pedido.etiquetaOrigen })
        .select("id")
        .single();
      if (errEtiqueta || !nueva) return NextResponse.json({ error: "No se pudo crear la etiqueta de origen. Probá de nuevo." }, { status: 503 });
      etiquetaOrigenId = nueva.id as string;
      etiquetas.set(claveDeEtiqueta(pedido.etiquetaOrigen), etiquetaOrigenId);
    }
  }

  const { data: registro, error: errRegistro } = await servicio
    .from("csv_imports")
    .insert({ workspace_id: workspaceId, created_by: user.id, nombre_archivo: pedido.nombreArchivo, filas: pedido.filas.length })
    .select("id")
    .single();
  if (errRegistro || !registro) return NextResponse.json({ error: "No se pudo empezar la importación. Probá de nuevo." }, { status: 503 });

  const actor = actorDe(user);
  const eventos: EventoAuditoria[] = [];
  const almacen: AlmacenDeContactos = {
    async buscarPor(campo, valor) {
      let q = servicio.from("contacts").select("id, deleted_at, pipedrive_person_id").eq("workspace_id", workspaceId);
      q = campo === "email" ? q.ilike("email", escaparLike(valor)) : q.eq(campo, valor);
      const { data, error } = await q.order("deleted_at", { ascending: false, nullsFirst: true }).limit(1);
      if (error) throw new Error(`contacts: ${error.message}`);
      const c = data?.[0] as { id: string; deleted_at: string | null; pipedrive_person_id: string | null } | undefined;
      return c ? { id: c.id, eliminado: c.deleted_at !== null, pipedrivePersonId: c.pipedrive_person_id } : null;
    },
    async crear(datos) {
      const { data, error } = await supabase.from("contacts").insert({ workspace_id: workspaceId, ...datos } as ContactoInsert).select("id").single();
      if (error || !data) throw errorDeContacto(error, "sin id");
      return data.id as string;
    },
    async actualizar(id, datos) {
      const campos = Object.keys(datos) as (keyof DatosDeContacto)[];
      const { data: antes } = await supabase.from("contacts").select(campos.join(", ")).eq("id", id).maybeSingle();
      const { error } = await supabase.from("contacts").update(datos as ContactoUpdate).eq("id", id);
      if (error) throw errorDeContacto(error, "");
      const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
      for (const c of campos) {
        const previo = (antes as Record<string, unknown> | null)?.[c] ?? null;
        if (previo !== datos[c]) cambios[c] = { antes: previo, despues: datos[c] };
      }
      if (Object.keys(cambios).length) {
        eventos.push({ workspaceId, actor, accion: "contacto.editado", entidad: { tipo: "contacto", id }, cambios, detalle: { importacion: registro.id } });
      }
    },
    async ponerEtiquetas(id, tagIds) {
      const { error } = await supabase
        .from("contact_tags")
        .upsert(tagIds.map((tag_id) => ({ contact_id: id, tag_id })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (error) throw new Error(`contact_tags: ${error.message}`);
    },
    async crearEtiqueta(nombre) {
      const { data, error } = await supabase.from("tags").insert({ workspace_id: workspaceId, name: nombre.slice(0, 60) }).select("id").single();
      if (error || !data) throw new Error(`tags: ${error?.message ?? "sin id"}`);
      return data.id as string;
    },
    async ponerCampos(id, valores) {
      const ahora = new Date().toISOString();
      const { error } = await supabase
        .from("contact_custom_fields")
        .upsert(valores.map((v) => ({ contact_id: id, field_id: v.fieldId, value: v.value, updated_at: ahora })), { onConflict: "contact_id,field_id" });
      if (error) throw new Error(`contact_custom_fields: ${error.message}`);
    },
    // F38: la nota va con la clave de servicio para que el disparador de
    // `contact_notes` (00038) conserve la marca en `author_label`; con la
    // sesión, pondría el nombre de quien importa. Se busca antes, también
    // entre las eliminadas, para no duplicarla ni resucitarla.
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

  const filas = pedido.filas.map((valores, i) => prepararFila(valores, pedido.mapeo, { codigoPais: pedido.codigoPais, numero: i + 2 }));
  const resumen = await importarFilas(
    filas,
    {
      etiquetas,
      campos: new Map((campos.data ?? []).map((c) => [String(c.slug), { id: c.id as string, tipo: String(c.type) }])),
      miembros: new Map(miembros.map((m) => [m.etiqueta.toLowerCase(), m.id])),
    },
    almacen,
    { asignarA: pedido.asignarA, etiquetaOrigenId },
  );

  // F38, el control afirmativo: ids de trato distintos del archivo (también los
  // de filas con error) contra los del espacio, contados en la base.
  // El total del espacio es aparte: la API de la base devuelve hasta 1000
  // filas por pedido, así que el control del archivo se cuenta con su propia
  // lista de ids (hasta 500) y no depende de ese tope.
  let control: (ReturnType<typeof controlDeMigracion> & { medido: true }) | { medido: false } | null = null;
  if (pedido.mapeo.includes("pipedrive_trato")) {
    const idsDelArchivo = [...new Set(filas.map((f) => f.pipedriveTrato ?? "").filter(Boolean))];
    const base = () =>
      servicio.from("contacts").select("pipedrive_deal_id").eq("workspace_id", workspaceId).is("deleted_at", null).not("pipedrive_deal_id", "is", null);
    const [enArchivo, enEspacio] = await Promise.all([
      idsDelArchivo.length ? base().in("pipedrive_deal_id", idsDelArchivo) : Promise.resolve({ data: [], error: null }),
      base().limit(1000),
    ]);
    if (enArchivo.error || enEspacio.error) control = { medido: false };
    else {
      const encontrados = controlDeMigracion(idsDelArchivo, (enArchivo.data ?? []).map((c) => String(c.pipedrive_deal_id)));
      const total = controlDeMigracion([], (enEspacio.data ?? []).map((c) => String(c.pipedrive_deal_id)));
      control = { medido: true, enArchivo: encontrados.enArchivo, encontrados: encontrados.encontrados, enEspacio: total.enEspacio };
    }
  }

  for (const c of resumen.creadosIds) {
    eventos.push({ workspaceId, actor, accion: "contacto.creado", entidad: { tipo: "contacto", id: c.id, etiqueta: c.nombre }, detalle: { importacion: registro.id } });
  }
  eventos.push({
    workspaceId,
    actor,
    accion: "importacion.completada",
    entidad: { tipo: "importacion", id: registro.id, etiqueta: pedido.nombreArchivo },
    detalle: { filas: filas.length, creados: resumen.creados, actualizados: resumen.actualizados, con_error: resumen.conError },
  });
  await registrarAuditoria(eventos);
  await servicio
    .from("csv_imports")
    .update({
      creados: resumen.creados,
      actualizados: resumen.actualizados,
      con_error: resumen.conError,
      estado: "terminada",
      terminada_at: new Date().toISOString(),
    })
    .eq("id", registro.id);

  return NextResponse.json({
    importacion: registro.id,
    filas: filas.length,
    creados: resumen.creados,
    actualizados: resumen.actualizados,
    conError: resumen.conError,
    usaronCodigo: resumen.usaronCodigo,
    etiquetasCreadas: resumen.etiquetasCreadas,
    lineas: resumen.lineas,
    control,
  });
}
