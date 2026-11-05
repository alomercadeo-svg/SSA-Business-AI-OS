import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El estado de la conversación en el encabezado del hilo (F35, tramo D de S8),
 * sin estado propio, para poder probarlo con datos fijos. «Abierta» o
 * «Cerrada» como texto y un solo botón, «Cerrar» o «Reabrir». El botón es el
 * del prototipo aprobado (`docs/diseno/prototipo-fase1.html`, `close-conv`);
 * el prototipo no muestra el estado, y se dejó como texto (05/11/2026). El aviso va con
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
      {/* El estado es texto, sin recuadro: el único con forma de botón es el
          de al lado (S8, tramo 7; decidido el 05/11/2026). */}
      <span
        className={cn(
          "text-xs font-medium",
          cerrada ? "text-muted-foreground" : "text-green-700 dark:text-green-400",
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
