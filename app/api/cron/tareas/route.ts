import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { correrTareas } from "@/lib/tareas-programadas";

/**
 * POST /api/cron/tareas: corre las tareas programadas (`lib/tareas-programadas.ts`).
 * Lo llama el servicio «vigilancia-cron» de Railway.
 *
 * El secreto va SOLO en `Authorization: Bearer <CRON_SECRET>`. Nunca en la
 * dirección: las rutas del fork aceptan `?key=` (`app/api/cron/jobs/route.ts:34-38`),
 * y una dirección termina en los registros de cualquier proxy. Se compara en
 * tiempo constante, sobre los hashes para que el largo no importe. Sin
 * `CRON_SECRET` en el servidor, falla cerrada.
 */
function autorizado(encabezado: string | null, secreto: string | undefined): boolean {
  if (!secreto) return false;
  if (!encabezado?.startsWith("Bearer ")) return false;
  const dado = createHash("sha256").update(encabezado.slice("Bearer ".length)).digest();
  const esperado = createHash("sha256").update(secreto).digest();
  return timingSafeEqual(dado, esperado);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const servicio = (await createServiceClient()) as unknown as SupabaseClient;
  const resumen = await correrTareas({ servicio, ahora: new Date() });
  // Un espacio fallido responde 500: `curl --fail` lo marca como fallido en
  // Railway. La marca de última ejecución no avanza para ese espacio.
  return NextResponse.json(resumen, { status: resumen.fallidas > 0 ? 500 : 200 });
}
