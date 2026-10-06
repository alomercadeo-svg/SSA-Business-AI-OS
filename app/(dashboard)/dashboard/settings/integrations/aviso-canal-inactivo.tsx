import { AlertTriangle } from "lucide-react";

/**
 * Aviso visible de canal inactivo (05/10/2026). Los receptores rechazan los
 * mensajes de un canal inactivo, y la sincronización con Zernio puede apagar
 * uno sola. Para volver a encenderlo está "Activar", en la pantalla de Canales.
 * Sin hooks, para poder convertirlo a HTML en un test.
 */
export function AvisoCanalInactivo({ activo }: { activo: boolean }) {
  if (activo) return null;
  return (
    <p className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Inactivo: no se reciben mensajes de este canal
    </p>
  );
}
