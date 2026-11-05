import { cn } from "@/lib/utils";
import { estadoDeVentana, textoDeVentana } from "@/lib/ventana-instagram";

/**
 * La ventana de Instagram como texto (F40, S9 tramo A). En la lista, solo lo
 * que pide atención (el criterio reescrito el 05/11/2026): «Ventana cerrada»
 * en gris y discreto, y el aviso de que vence en ámbar (D12, decidido el
 * 05/11/2026: con los datos de hoy, «Ventana cerrada» está en casi todas las
 * filas de Instagram; lo que pide actuar es lo que vence). En el encabezado,
 * siempre el estado. WhatsApp no muestra nada.
 */
export function MarcaDeVentana({
  conversacion,
  ahora,
  lugar,
}: {
  conversacion: { platform: string | null; window_expires_at?: string | null };
  ahora: number;
  lugar: "lista" | "encabezado";
}) {
  const e = estadoDeVentana(conversacion, ahora);
  const t = textoDeVentana(e, lugar);
  if (!e || !t) return null;
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "shrink-0 text-[11px]",
        e.estado === "cerrada" && "text-muted-foreground",
        e.estado === "por_vencer" && "font-medium text-amber-700 dark:text-amber-400",
        e.estado === "abierta" && "text-green-700 dark:text-green-400",
      )}
    >
      {t}
    </span>
  );
}
