import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/workspace";
import { origenPermitido } from "@/lib/asignacion";
import { dependenciasDeRespuesta } from "@/lib/respuesta-privada-servidor";
import { enviarRespuestaPrivada } from "@/lib/respuesta-privada";

/**
 * F40 (ítem 6 de la sesión de cierre, 10/11/2026):
 * `POST /api/v1/comentarios/<id de comment_logs>/respuesta-privada` con
 * `{ mensaje }`. Hasta 7 días desde el comentario y una sola vez; si no
 * corresponde, 409 **sin llamar a Zernio** (`lib/respuesta-privada.ts`).
 *
 * Solo Owner y Admin (decisión de la sesión, vetable): un comentario no tiene
 * alcance por lead (§13, «`comment_logs` sin alcance por lead»), así que un
 * Member podría escribirle a alguien fuera de su alcance.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ comentarioId: string }> }) {
  if (!origenPermitido(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return NextResponse.json({ error: "Pedido rechazado: no viene de la aplicación." }, { status: 403 });
  }
  const { contexto, error } = await requireManager();
  if (error) return error;
  const { comentarioId } = await params;
  let cuerpo: { mensaje?: unknown } = {};
  try {
    cuerpo = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const servicio = await createServiceClient();
  const r = await enviarRespuestaPrivada(
    comentarioId,
    contexto.workspace.id,
    typeof cuerpo.mensaje === "string" ? cuerpo.mensaje : "",
    dependenciasDeRespuesta(servicio),
  );
  return NextResponse.json(
    r.status === 200 ? { ok: true, messageId: r.messageId ?? null } : { code: r.motivo ?? null, error: r.error },
    { status: r.status },
  );
}
