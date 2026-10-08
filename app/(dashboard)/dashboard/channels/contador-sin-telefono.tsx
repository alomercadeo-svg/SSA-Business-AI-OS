import type { createClient } from "@/lib/supabase/server";

/**
 * Contador de mensajes que llegaron sin teléfono resuelto (F26, §11 «Pantalla:
 * Canales»). Es el dato que decide si el caso del `@lid` es marginal o si hay
 * que invertir más. Lo ve solo el Owner: la página lo renderiza con
 * `role === "owner"`, en el servidor, y el Admin no lo recibe.
 *
 * Cuenta con `contar_mensajes_sin_telefono` (00031), los entrantes de WhatsApp
 * de los últimos 7 días. **Hasta F27 da 0 de 0:** los entrantes recién se
 * guardan con F27. «Ver la cola» lleva a la bandeja con el filtro «Teléfono sin
 * resolver», que es de F35: se suma cuando exista, porque un link a la bandeja
 * sin ese filtro mostraría otra cosa que lo que promete.
 */
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/** El comienzo de la ventana. Fuera del componente: es un servidor, se calcula por pedido. */
function haceSieteDias(): string {
  return new Date(Date.now() - SIETE_DIAS_MS).toISOString();
}

export async function ContadorSinTelefono({
  supabase,
  workspaceId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  workspaceId: string;
}) {
  const { data, error } = await supabase.rpc("contar_mensajes_sin_telefono", {
    p_workspace: workspaceId,
    p_desde: haceSieteDias(),
  });
  if (error) {
    console.error("[canales] contador sin teléfono:", error.message);
    return (
      <p className="border-b border-border px-8 py-2 text-sm text-muted-foreground">
        Mensajes que llegaron sin teléfono resuelto: no se pudo calcular ahora. Recargá para volver a intentar.
      </p>
    );
  }
  const fila = Array.isArray(data) ? data[0] : null;
  const n = fila?.sin_telefono ?? 0;
  const m = fila?.total ?? 0;
  return (
    <p className="border-b border-border px-8 py-2 text-sm text-muted-foreground">
      Mensajes que llegaron sin teléfono resuelto, últimos 7 días: <span className="font-medium text-foreground tabular-nums">{n} de {m}</span>
    </p>
  );
}
