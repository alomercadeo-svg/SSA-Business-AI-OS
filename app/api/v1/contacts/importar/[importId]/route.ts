import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceOrNull } from "@/lib/workspace";
import { resumenDeImportacion } from "@/lib/importacion-progreso";

/**
 * F37, parte 2: `GET /api/v1/contacts/importar/<id>`, el avance y el resumen de
 * una importación, para la barra de progreso y para volver al detalle desde el
 * correo. Se lee con la sesión de quien pregunta: la seguridad por filas de
 * `csv_imports` (00054) deja ver a Owner y Admin todas las del espacio, y a
 * cada uno las suyas.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  const ctx = await getWorkspaceOrNull();
  if (!ctx) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });
  const { importId } = await params;
  const { data, error } = await ctx.supabase
    .from("csv_imports")
    .select("id, workspace_id, nombre_archivo, filas, procesadas, creados, actualizados, con_error, usaron_codigo, estado, en_segundo_plano, lineas, etiquetas_creadas, control, error, created_at, terminada_at")
    .eq("id", importId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo leer la importación. Probá de nuevo." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Esa importación no existe." }, { status: 404 });
  return NextResponse.json(resumenDeImportacion(data), { headers: { "Cache-Control": "no-store" } });
}
