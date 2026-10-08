/**
 * Normalización de teléfonos a E.164 (§14, F25).
 *
 * §14 es la única definición del plano: "signo más, código de país y número,
 * solo dígitos, sin espacios ni separadores, hasta 15 dígitos en total". Esto
 * la aplica al pie de la letra y no hace nada más:
 *
 *   - Saca espacios, guiones, puntos y paréntesis, que son separadores.
 *   - Exige el `+` adelante. **No adivina el código de país**: un número sin
 *     código no se puede normalizar sin suponer de dónde es, y el código por
 *     defecto es configuración de F38. Sin eso, se rechaza.
 *   - El primer dígito no puede ser 0: ningún código de país empieza con 0.
 *   - Hasta 15 dígitos. **Sin mínimo**, porque §14 no lo fija. Si algún día
 *     hace falta uno, se propone como cambio al plano, no se pone acá.
 *
 * Un número que no cumple devuelve null y no se guarda: "un número que no se
 * puede normalizar no se guarda con un valor inventado". La base hace cumplir
 * lo mismo con un `check` (00029), para el camino que se olvide de llamar acá.
 */

const SEPARADORES = /[\s\-.()]/g;
export const E164 = /^\+[1-9][0-9]{0,14}$/;

export function normalizarTelefono(entrada: string | null | undefined): string | null {
  if (typeof entrada !== "string") return null;
  const limpio = entrada.replace(SEPARADORES, "");
  return E164.test(limpio) ? limpio : null;
}

/** El motivo, en lenguaje claro, de por qué un teléfono no se aceptó. */
export function motivoTelefonoInvalido(entrada: string): string {
  const limpio = entrada.replace(SEPARADORES, "");
  if (!limpio) return "Escribí el teléfono.";
  if (!limpio.startsWith("+")) return "Falta el código de país: empezá con + (por ejemplo, +506 7034 9182).";
  if (/[^+0-9]/.test(limpio)) return "El teléfono solo puede tener números, además del + del principio.";
  if (limpio.startsWith("+0")) return "El código de país no puede empezar con 0.";
  if (limpio.length - 1 > 15) return "Tiene más de 15 dígitos: revisá que no sobre ninguno.";
  return "Ese teléfono no se puede guardar así. Revisalo.";
}
