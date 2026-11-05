/**
 * La columna «Última interacción» de Contactos (F43, tramo B de S9; decidido
 * por Marcos el 05/11/2026): «Hoy», «Ayer», «Hace N días» y «Nunca», por día
 * del calendario en la zona del negocio, como la bandeja (lib/fechas-bandeja.ts).
 *
 * El reloj viene de afuera: la página lo fija en el servidor y lo pasa a la
 * vista, así el HTML del servidor y el del navegador coinciden.
 *
 * Sin React ni nada de servidor.
 */
import { ZONA_DEL_NEGOCIO } from "./ficha";

const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_DEL_NEGOCIO, year: "numeric", month: "2-digit", day: "2-digit" });

function diaDelNegocio(fecha: Date): number {
  const p = Object.fromEntries(partes.formatToParts(fecha).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

export function ultimaInteraccion(iso: string | null, ahora: Date): string {
  if (!iso) return "Nunca";
  const dias = diaDelNegocio(ahora) - diaDelNegocio(new Date(iso));
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  return `Hace ${dias} días`;
}
