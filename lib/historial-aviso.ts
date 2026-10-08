/**
 * El aviso del hilo cuando el historial del proveedor no está entero en la
 * base (F27). Con la bandeja leyendo de la base, un hilo sin importar se vería
 * vacío o cortado sin explicación; esto lo dice.
 */
export interface EstadoDelHistorial {
  estado: "pendiente" | "completo" | "incompleto" | "no_disponible";
  canalActivo: boolean;
}

/** El aviso que corresponde a un historial, o nada si está completo. */
export function avisoDelHistorial(h: EstadoDelHistorial | null | undefined): string | null {
  if (!h || h.estado === "completo") return null;
  if (!h.canalActivo) return "La cuenta está desconectada: el historial anterior no se pudo traer.";
  if (h.estado === "no_disponible") return "Instagram ya no tiene el historial anterior de esta conversación.";
  if (h.estado === "incompleto") return "El historial de esta conversación es muy largo: se trajo una parte.";
  return "El historial anterior de esta conversación todavía no se importó. Se trae con «Sincronizar» en Canales.";
}
