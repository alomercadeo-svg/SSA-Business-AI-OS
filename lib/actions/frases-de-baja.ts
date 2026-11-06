"use server";

/**
 * F34, ítem 8 del plan maestro: la lista de frases de baja del espacio
 * (`workspaces.frases_de_baja`, 00053). Solo Owner y Admin, como el resto de
 * Configuración; queda en el historial.
 */
import { revalidatePath } from "next/cache";
import { esManager, getWorkspaceOrNull } from "@/lib/workspace";
import { actorDe, registrarAuditoria } from "@/lib/auditoria";

const LARGO_MAXIMO_DE_FRASE = 80;
const CANTIDAD_MAXIMA = 50;

type Resultado = { ok: true; frases: string[] } | { ok: false; error: string };

export async function guardarFrasesDeBaja(texto: string): Promise<Resultado> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Solo Owner y Admin pueden cambiar las frases de baja." };
  const { supabase, workspace, user } = contexto;

  const frases = [
    ...new Set(
      String(texto ?? "")
        .split("\n")
        .map((f) => f.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
  if (frases.length === 0) return { ok: false, error: "Dejá al menos una frase: sin ninguna, nadie queda marcado aunque lo pida." };
  if (frases.length > CANTIDAD_MAXIMA) return { ok: false, error: `Son ${frases.length} frases; el máximo es ${CANTIDAD_MAXIMA}.` };
  const larga = frases.find((f) => f.length > LARGO_MAXIMO_DE_FRASE);
  if (larga) return { ok: false, error: `«${larga.slice(0, 30)}…» es muy larga: hasta ${LARGO_MAXIMO_DE_FRASE} caracteres por frase.` };

  const { data: antes } = await supabase.from("workspaces").select("frases_de_baja").eq("id", workspace.id).maybeSingle();
  const { data: actualizado, error } = await supabase
    .from("workspaces")
    .update({ frases_de_baja: frases })
    .eq("id", workspace.id)
    .select("id")
    .maybeSingle();
  // Una política que no deja pasar el UPDATE no da error: afecta cero filas.
  if (error || !actualizado) return { ok: false, error: "No se pudo guardar: revisá la conexión y volvé a intentar." };

  await registrarAuditoria({
    workspaceId: workspace.id,
    actor: actorDe(user),
    accion: "configuracion.cambiada",
    entidad: { tipo: "espacio", id: workspace.id, etiqueta: "Frases de baja" },
    cambios: { frases_de_baja: { antes: (antes as { frases_de_baja?: string[] } | null)?.frases_de_baja ?? null, despues: frases } },
  });
  revalidatePath("/dashboard/settings/frases-de-baja");
  return { ok: true, frases };
}
