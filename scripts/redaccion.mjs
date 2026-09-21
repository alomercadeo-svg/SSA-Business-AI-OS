/**
 * Redacción de secretos en la salida de los scripts.
 *
 * ── POR QUÉ ESTO ES UN FILTRO Y NO UNA REGLA DE ESTILO ──────────────────────
 *
 * El 21 de septiembre de 2026 una consulta a `GET /v1/webhooks/settings`
 * imprimió el secreto de firma del webhook en la terminal. El endpoint lo
 * devuelve en texto plano junto con la configuración, así que cualquiera que
 * vuelque esa respuesta lo expone sin darse cuenta: no hay nada en el nombre del
 * endpoint que avise.
 *
 * La reacción obvia —"acordate de no imprimir el secreto"— no sirve, porque
 * depende de que quien escriba el próximo script sepa que ese campo viene ahí.
 * El que lo imprimió ya sabía la regla.
 *
 * Por eso esto intercepta la salida en vez de pedir cuidado en cada llamada.
 * Un `console.log` de la respuesta entera sigue siendo una mala idea, pero deja
 * de ser una filtración: el valor se reemplaza por su forma redactada aunque
 * venga anidado adentro de un JSON.
 *
 * **Redactar es lo urgente, rotar viene después.** Mientras el valor salga por
 * pantalla cada vez que alguien consulte la configuración, rotarlo solo cambia
 * qué cadena queda expuesta la próxima vez.
 */

/**
 * La forma redactada: longitud y últimos cuatro caracteres, nunca el valor.
 *
 * Los últimos cuatro alcanzan para contestar "¿es el mismo que tengo acá?" sin
 * entregar nada utilizable, que es el único uso legítimo de ver un secreto.
 */
export function redactar(valor) {
  if (typeof valor !== "string" || valor.length === 0) return "(vacío)";
  if (valor.length <= 8) return `(${valor.length} caracteres, oculto)`;
  return `(${valor.length} caracteres, termina en ${valor.slice(-4)})`;
}

/**
 * Reemplaza cada secreto conocido por su forma redactada dentro de un texto.
 *
 * Trabaja sobre la cadena final, no sobre el objeto, justamente para atrapar el
 * caso que importa: el valor serializado adentro de un JSON, donde ninguna
 * comprobación por nombre de campo lo encontraría.
 */
export function filtrarSalida(texto, secretos) {
  let salida = String(texto);
  for (const s of secretos) {
    // Un secreto muy corto haría un reemplazo destructivo sobre texto común.
    if (typeof s !== "string" || s.length < 8) continue;
    salida = salida.split(s).join(redactar(s));
  }
  return salida;
}

/**
 * Instala el filtro sobre `console`.
 *
 * Devuelve una función para sumar secretos que se descubren en el camino: la
 * clave de la API se conoce al arrancar, pero el secreto del webhook aparece
 * recién cuando se consulta la configuración, o sea justo en la respuesta que
 * hay que proteger. Sumarlo apenas se lee cierra esa ventana.
 */
export function protegerSalida(secretosIniciales = []) {
  const secretos = new Set(secretosIniciales.filter((s) => typeof s === "string" && s.length >= 8));

  const formatear = (args) =>
    args.map((a) => (typeof a === "string" ? filtrarSalida(a, secretos) : a));

  for (const metodo of ["log", "error", "warn", "info"]) {
    const original = console[metodo].bind(console);
    console[metodo] = (...args) => original(...formatear(args));
  }

  return function sumarSecreto(valor) {
    if (typeof valor === "string" && valor.length >= 8) secretos.add(valor);
  };
}
