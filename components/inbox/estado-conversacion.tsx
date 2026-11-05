import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El estado de la conversación en el encabezado del hilo (F35, tramo D de S8),
 * sin estado propio, para poder probarlo con datos fijos. «Abierta» o
 * «Cerrada» y un solo botón, «Cerrar» o «Reabrir», como el prototipo aprobado
 * (`docs/diseno/prototipo-fase1.html`, `close-conv`). El aviso va con
 * `role="status"`: la app no tiene avisos flotantes.
 */
export function VistaDelEstado({
  estado,
  ocupado = false,
  aviso = null,
  onCambiar,
}: {
  estado: string;
  ocupado?: boolean;
  aviso?: { texto: string; error: boolean } | null;
  onCambiar?: () => void;
}) {
  const cerrada = estado === "closed";
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-medium",
          cerrada ? "bg-muted text-muted-foreground" : "bg-green-100 text-green-700",
        )}
      >
        {cerrada ? "Cerrada" : "Abierta"}
      </span>
      <button
        type="button"
        onClick={onCambiar}
        disabled={ocupado}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {ocupado && <Loader2 className="h-3 w-3 animate-spin" />}
        {cerrada ? "Reabrir" : "Cerrar"}
      </button>
      {aviso && (
        <span role="status" className={cn("text-xs", aviso.error ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
          {aviso.texto}
        </span>
      )}
    </div>
  );
}
