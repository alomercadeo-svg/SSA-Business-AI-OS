/**
 * Las fechas de la lista y del hilo de la bandeja (tramo A de S8).
 *
 * Hasta el 03/11/2026 contaban bloques de 24 horas, no días del calendario, y
 * usaban la zona del navegador: un mensaje de ayer a las 23:00, visto hoy a
 * las 09:00, decía «Today», y en la lista mostraba la hora como si fuera de
 * hoy. Ahora todo es por día del calendario en la zona del negocio (§14), la
 * misma que usa la ficha.
 *
 * La lista y el hilo son `"use client"`: esto no importa nada de servidor.
 */
import { ZONA_DEL_NEGOCIO } from "./ficha";

const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_DEL_NEGOCIO, year: "numeric", month: "2-digit", day: "2-digit" });

/** El día del calendario en la zona del negocio, como número de días desde 1970. */
function diaDelNegocio(fecha: Date): number {
  const p = Object.fromEntries(partes.formatToParts(fecha).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

const anioDelNegocio = (fecha: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_DEL_NEGOCIO, year: "numeric" }).format(fecha);

const formato = (opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-CR", { timeZone: ZONA_DEL_NEGOCIO, ...opciones });

/** Cuántos días del calendario pasaron, en la zona del negocio. 0 es hoy. */
function diasAtras(fecha: Date, ahora: Date): number {
  return diaDelNegocio(ahora) - diaDelNegocio(fecha);
}

/** La lista: «08:05» hoy, «Ayer», el día abreviado en la semana, si no «15 oct» (con el año si es otro). */
export function horaDeLaLista(iso: string | null): string {
  if (!iso) return "";
  const fecha = new Date(iso);
  const ahora = new Date();
  const dias = diasAtras(fecha, ahora);
  if (dias <= 0) return formato({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fecha);
  if (dias === 1) return "Ayer";
  if (dias < 7) return formato({ weekday: "short" }).format(fecha).replace(/\.$/, "");
  if (anioDelNegocio(fecha) === anioDelNegocio(ahora)) return formato({ day: "numeric", month: "short" }).format(fecha).replace(/\.$/, "");
  return formato({ day: "numeric", month: "short", year: "numeric" }).format(fecha).replace(/\.(?= \d{4}$)/, "");
}

/** El separador del hilo: «Hoy», «Ayer», el día en la semana, si no «15 oct 2026». */
export function separadorDeDia(iso: string): string {
  const fecha = new Date(iso);
  const dias = diasAtras(fecha, new Date());
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 7) return formato({ weekday: "long" }).format(fecha);
  return formato({ day: "numeric", month: "short", year: "numeric" }).format(fecha).replace(/\.(?= \d{4}$)/, "");
}

/** Si entre dos mensajes seguidos cambia el día del calendario del negocio. */
export function cambiaDeDia(actual: string, anterior: string | undefined): boolean {
  if (!anterior) return true;
  return diaDelNegocio(new Date(actual)) !== diaDelNegocio(new Date(anterior));
}

/**
 * La hora de cada mensaje del hilo: «20:51», en 24 horas y en la zona del
 * negocio (tramo B, decidido por Marcos el 04/11/2026: la misma constante que
 * la lista y los separadores). Hasta el 04/11/2026 era `toLocaleTimeString`
 * del navegador: «08:51 PM», en la zona de quien mira.
 */
export function horaDelMensaje(iso: string): string {
  return formato({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
