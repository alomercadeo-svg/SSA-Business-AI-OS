/**
 * Reglas que dependen del proveedor de un canal.
 *
 * Existen como módulo aparte, y no sueltas dentro de las rutas, porque las dos
 * son decisiones con una mitad silenciosa: si se equivocan, no fallan, dejan de
 * hacer algo. Un `if` mal escrito adentro de un bucle de 80 líneas no se puede
 * probar sin montar media ruta; acá sí.
 *
 * El fork asumía un solo proveedor, Zernio, y esa suposición está cableada en
 * varios lugares. La migración 00022 agrega `channels.provider` para poder
 * distinguirlos.
 */

/** Forma mínima para decidir, sin arrastrar la fila entera del canal. */
export interface CanalParaReglas {
  provider: string;
  late_account_id: string | null;
  is_active: boolean;
}

/**
 * ¿Hay que desactivar este canal porque su cuenta de Zernio ya no existe?
 *
 * LAS DOS MITADES, Y LAS DOS IMPORTAN.
 *
 * **Que no desactive lo que no es de Zernio.** Un canal de Evolution tiene
 * `late_account_id` en nulo, porque no tiene cuenta de Zernio. Sin la guarda de
 * proveedor, `cuentasVigentes.has(null)` da false siempre, así que el canal de
 * WhatsApp quedaría desactivado cada vez que alguien apreta "Sincronizar" en la
 * pantalla de canales. Y el receptor de `/api/webhooks/evolution` busca el canal
 * con `is_active = true`: a partir de ese momento rechazaría todos los mensajes
 * entrantes, sin error y sin síntoma. La bandeja simplemente dejaría de recibir,
 * después de apretar un botón que no tiene ninguna relación aparente.
 *
 * **Que sí desactive lo que sí es de Zernio.** Esta es la mitad fácil de
 * romper mientras se arregla la otra: una guarda demasiado amplia hace que la
 * sincronización deje de limpiar, y eso tampoco da ningún error. Los canales
 * muertos se quedarían para siempre marcados como activos.
 *
 * Las dos mitades tienen su test, una afirmativa y una negativa.
 */
export function debeDesactivarseCanal(
  canal: CanalParaReglas,
  cuentasVigentes: ReadonlySet<string | undefined>,
): boolean {
  if (canal.provider !== "zernio") return false;
  if (!canal.is_active) return false;
  return !cuentasVigentes.has(canal.late_account_id ?? undefined);
}
