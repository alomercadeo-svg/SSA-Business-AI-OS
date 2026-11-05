/**
 * El nombre de un setter o vendedor según la lista que tiene quien mira (F43,
 * pendiente de S8; D9 decidido en el chat de Marcos el 05/11/2026).
 *
 * Owner y Admin reciben el equipo entero: un id que no está es alguien que ya
 * no está en el equipo. Un Member recibe solo a sí mismo
 * (`miembrosParaLaBandeja`, lib/miembros-bandeja.ts), así que un id que no
 * está es otra persona del equipo, sin nombre: la página no lo trae.
 *
 * Sin React ni nada de servidor: la usan la lista, la ficha y el desplegable.
 */
export const YA_NO_ESTA = "Ya no está en el equipo";
export const OTRA_PERSONA = "Otra persona del equipo";

export function etiquetaDeMiembro(
  id: string | null,
  miembros: { id: string; etiqueta: string }[],
  equipoCompleto: boolean,
): string {
  if (!id) return "Sin asignar";
  return miembros.find((m) => m.id === id)?.etiqueta ?? (equipoCompleto ? YA_NO_ESTA : OTRA_PERSONA);
}
