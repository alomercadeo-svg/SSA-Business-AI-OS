import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { origenPermitido } from "@/lib/asignacion";
import { miembrosDelEspacio } from "@/lib/miembros";
import { actorDe } from "@/lib/auditoria";
import { claveDeEtiqueta } from "@/lib/importacion-contactos";
import { leerInicio, leerTanda, tandasCompletas } from "@/lib/importacion-pedidos";
import { correrImportacion } from "@/lib/importacion-proceso";
import type { Json } from "@/lib/types/database";

/**
 * F37, parte 2 (ítem 2 de la sesión de cierre, 10/11/2026):
 * `POST /api/v1/contacts/importar/tandas`. Tres pasos, cada uno un pedido chico:
 *
 *   1. `empezar`: valida el mapeo y el total (hasta 10.000 filas), crea la
 *      etiqueta de origen si hace falta y la fila de `csv_imports` en
 *      «subiendo». Devuelve su id.
 *   2. `tanda`: una tanda de hasta 500 filas, con su número. Repetir una
 *      tanda la reemplaza (un reintento del navegador no duplica).
 *   3. `procesar`: con todas las tandas subidas, la deja «en_cola». Hasta 500
 *      filas, espera el proceso y responde con el resumen; con más, responde
 *      enseguida (202) y el proceso corre después de la respuesta.
 *
 * Solo Owner y Admin (como la parte 1), controlado acá en cada paso; y cada
 * tanda tiene que ser de una importación del espacio activo empezada por
 * quien la manda. `csv_imports` y `csv_import_lotes` los escribe solo el
 * servidor (00054 y 00057).
 */
export async function POST(request: NextRequest) {
  if (!origenPermitido(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return NextResponse.json({ error: "Pedido rechazado: no viene de la aplicación." }, { status: 403 });
  }
  const ctx = await getWorkspaceOrNull();
  if (!ctx) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });
  if (!esManager(ctx.role)) {
    return NextResponse.json({ code: "solo_managers", error: "Por ahora, importar contactos es de Owner y Admin." }, { status: 403 });
  }
  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const { supabase, user } = ctx;
  const workspaceId = ctx.workspace.id;
  const servicio = await createServiceClient();

  if (cuerpo.accion === "empezar") {
    const inicio = leerInicio(cuerpo);
    if (typeof inicio === "string") return NextResponse.json({ error: inicio }, { status: 400 });
    if (inicio.asignarA) {
      const miembros = await miembrosDelEspacio(workspaceId);
      if (!miembros.some((m) => m.id === inicio.asignarA)) return NextResponse.json({ error: "Esa persona no es parte del equipo." }, { status: 400 });
    }
    // La etiqueta de origen se crea acá, con la sesión, como en la parte 1.
    let etiquetaOrigenId: string | null = null;
    if (inicio.etiquetaOrigen) {
      const { data: tags, error } = await supabase.from("tags").select("id, name").eq("workspace_id", workspaceId);
      if (error) return NextResponse.json({ error: "No se pudieron leer las etiquetas. Probá de nuevo." }, { status: 503 });
      etiquetaOrigenId = (tags ?? []).find((t) => claveDeEtiqueta(String(t.name)) === claveDeEtiqueta(inicio.etiquetaOrigen!))?.id ?? null;
      if (!etiquetaOrigenId) {
        const { data: nueva, error: e } = await supabase.from("tags").insert({ workspace_id: workspaceId, name: inicio.etiquetaOrigen }).select("id").single();
        if (e || !nueva) return NextResponse.json({ error: "No se pudo crear la etiqueta de origen. Probá de nuevo." }, { status: 503 });
        etiquetaOrigenId = nueva.id as string;
      }
    }
    const opciones = { mapeo: inicio.mapeo, codigoPais: inicio.codigoPais, asignarA: inicio.asignarA, etiquetaOrigenId, actor: actorDe(user) };
    const { data: registro, error } = await servicio
      .from("csv_imports")
      .insert({
        workspace_id: workspaceId,
        created_by: user.id,
        nombre_archivo: inicio.nombreArchivo,
        filas: inicio.total,
        lotes: inicio.tandas,
        en_segundo_plano: inicio.enSegundoPlano,
        estado: "subiendo",
        opciones: opciones as unknown as Json,
      })
      .select("id")
      .single();
    if (error || !registro) return NextResponse.json({ error: "No se pudo empezar la importación. Probá de nuevo." }, { status: 503 });
    return NextResponse.json({ importacion: registro.id, tandas: inicio.tandas, enSegundoPlano: inicio.enSegundoPlano });
  }

  // Los dos pasos que siguen son sobre una importación ya empezada.
  const id = typeof cuerpo.importacion === "string" ? cuerpo.importacion : null;
  if (!id) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const { data: imp } = await servicio
    .from("csv_imports")
    .select("id, workspace_id, created_by, estado, filas, lotes, en_segundo_plano, opciones")
    .eq("id", id)
    .maybeSingle();
  if (!imp || imp.workspace_id !== workspaceId || imp.created_by !== user.id) {
    return NextResponse.json({ error: "Esa importación no existe." }, { status: 404 });
  }

  if (cuerpo.accion === "tanda") {
    if (imp.estado !== "subiendo") return NextResponse.json({ error: "Esa importación ya no recibe filas." }, { status: 409 });
    const columnas = ((imp.opciones as { mapeo?: unknown[] } | null)?.mapeo ?? []).length;
    const tanda = leerTanda(cuerpo, { tandas: imp.lotes, columnas });
    if (typeof tanda === "string") return NextResponse.json({ error: tanda }, { status: 400 });
    const { error } = await servicio
      .from("csv_import_lotes")
      .upsert({ import_id: id, numero: tanda.numero, filas: tanda.filas as unknown as Json, cantidad: tanda.filas.length, procesado_at: null }, { onConflict: "import_id,numero" });
    if (error) return NextResponse.json({ error: "No se pudo subir esa parte del archivo. Probá de nuevo." }, { status: 503 });
    return NextResponse.json({ ok: true, numero: tanda.numero });
  }

  if (cuerpo.accion === "procesar") {
    if (imp.estado === "subiendo") {
      const { data: subidas, error } = await servicio.from("csv_import_lotes").select("numero, cantidad").eq("import_id", id);
      if (error) return NextResponse.json({ error: "No se pudo leer el archivo subido. Probá de nuevo." }, { status: 503 });
      if (!tandasCompletas({ total: imp.filas, tandas: imp.lotes }, (subidas ?? []).map((t) => ({ numero: t.numero, filas: t.cantidad })))) {
        return NextResponse.json({ error: "Falta subir una parte del archivo. Probá de nuevo." }, { status: 409 });
      }
      const { error: e2 } = await servicio.from("csv_imports").update({ estado: "en_cola" }).eq("id", id).eq("estado", "subiendo");
      if (e2) return NextResponse.json({ error: "No se pudo empezar la importación. Probá de nuevo." }, { status: 503 });
    }
    if (imp.en_segundo_plano) {
      after(async () => {
        try {
          await correrImportacion(id);
        } catch (e) {
          console.error("[importacion] el proceso en segundo plano falló:", id, e instanceof Error ? e.message : String(e));
        }
      });
      return NextResponse.json({ importacion: id, enSegundoPlano: true }, { status: 202 });
    }
    await correrImportacion(id);
    return NextResponse.json({ importacion: id, enSegundoPlano: false });
  }

  return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
}
