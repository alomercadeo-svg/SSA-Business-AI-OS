import { getWorkspace } from "@/lib/workspace";
import { armarEmbudo, filtroDeEmbudo, type ContactoDelEmbudo } from "@/lib/embudo";
import { TableroEmbudo } from "@/components/embudo/tablero-embudo";

type Parametros = Record<string, string | string[] | undefined>;

/** Hasta cuántos contactos con etapa se leen; si hay más, la pantalla lo dice. */
const LIMITE = 1000;

/**
 * El Embudo (10/11/2026): pantalla fuera del plano, decidida por Marcos para
 * la entrega; criterios a escribir después. Solo lectura.
 *
 * La lectura va con la sesión de quien mira, nunca con la clave de servicio:
 * la seguridad por filas existente decide qué ve cada uno (un Member, solo lo
 * suyo; la 00038 ya oculta los eliminados, y el filtro de abajo lo dice
 * explícito).
 */
export default async function EmbudoPage({ searchParams }: { searchParams: Promise<Parametros> }) {
  const { workspace, supabase } = await getWorkspace();
  const params = await searchParams;
  const filtro = filtroDeEmbudo(params.estado);

  const { data, error, count } = await supabase
    .from("contacts")
    .select("id, display_name, pipeline_stage, deal_status, deal_value, deal_currency, deal_closed_at", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .not("pipeline_stage", "is", null)
    .is("deleted_at", null)
    .order("display_name", { ascending: true })
    .limit(LIMITE);
  // Un error no se muestra como «no hay contactos»: la pantalla de error lo dice.
  if (error) throw new Error("No se pudo leer el embudo.");

  const embudo = armarEmbudo((data ?? []) as ContactoDelEmbudo[], filtro);
  return <TableroEmbudo embudo={embudo} filtro={filtro} total={count ?? embudo.cantidades.todos} limite={LIMITE} />;
}
