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

/** Texto que ve quien sincroniza cuando Zernio no devuelve ninguna cuenta. */
export const AVISO_CERO_CUENTAS = "Zernio devolvió cero cuentas: no se desactivó ningún canal";

/** Error cuando la respuesta de Zernio no trae una lista. */
export const ERROR_FORMA_INESPERADA =
  "Zernio respondió sin una lista de cuentas: la sincronización no tocó ningún canal";

/** Condición de `webhook_alerts` que abre una sincronización con cero cuentas. */
export const ALERTA_CERO_CUENTAS = "zernio_sync_cero_cuentas";

/** Lo mínimo de una cuenta de Zernio que hace falta para decidir. */
interface CuentaParaPlan {
  _id?: string;
  profileId?: string | { _id?: string; isOverLimit?: boolean } | null;
}

interface PerfilParaPlan {
  _id?: string;
  isOverLimit?: boolean;
}

export type PlanDeSincronizacion =
  | { error: string }
  | {
      error: null;
      /** Ids de los canales que hay que desactivar. */
      aDesactivar: string[];
      /** Zernio devolvió cero cuentas y había canales de Zernio activos. */
      ceroCuentas: boolean;
      /** `_id` de las cuentas cuyo perfil excede el límite del plan. */
      excedidas: Set<string>;
      /** `_id` de todas las cuentas que trajo Zernio. */
      vigentes: Set<string | undefined>;
    };

function idDePerfil(perfil: CuentaParaPlan["profileId"]): string | undefined {
  if (!perfil) return undefined;
  return typeof perfil === "string" ? perfil : perfil._id;
}

/**
 * Qué hace una sincronización con lo que respondió Zernio, ANTES de escribir
 * nada. Deuda de §15 del plano, resuelta el 06/10/2026.
 *
 * LOS TRES CASOS QUE NO PUEDEN DESACTIVAR, Y EL QUE SÍ
 *
 * 1. **Forma inesperada.** Si `accounts` o `profiles` no son una lista, error y
 *    nada más. Antes, `res.data?.accounts ?? []` convertía una respuesta rara en
 *    una lista vacía, y una lista vacía apaga todo.
 * 2. **Cero cuentas con canales de Zernio activos.** No desactiva nada y lo
 *    avisa. Que la cuenta del negocio desaparezca de golpe junto con todas las
 *    demás es mucho más probable un problema de Zernio o de la clave que una
 *    desconexión real, y el costo de equivocarse es la bandeja muda. Si de
 *    verdad no hay cuentas, la alerta lo dice y la persona decide.
 * 3. **Cuenta de un perfil que excede el límite del plan.** Se pide con
 *    `includeOverLimit: true`, así que la cuenta viene en la lista y cuenta
 *    como vigente. La marca de exceso NO está en la cuenta (`SocialAccount` no
 *    tiene ninguna, `@zernio/node` 0.2.519, dist/index.d.ts:5632): está en el
 *    perfil, `Profile.isOverLimit` (dist/index.d.ts:5191). Se cruza por
 *    `profileId`, que puede venir como texto o como el perfil entero
 *    (dist/index.d.ts:5635). Se usa la marca explícita y no "la que falta sin
 *    el parámetro", porque inferir por ausencia es justo el error que esto
 *    arregla.
 * 4. **La cuenta que falta, con otras presentes, SÍ se desactiva.** Es la
 *    limpieza de siempre, por `debeDesactivarseCanal`. Si este caso dejara de
 *    funcionar, los tres anteriores pasarían igual: por eso tiene test propio.
 */
export function planDeSincronizacion(entrada: {
  cuentas: unknown;
  perfiles: unknown;
  canales: readonly (CanalParaReglas & { id: string })[];
}): PlanDeSincronizacion {
  if (!Array.isArray(entrada.cuentas) || !Array.isArray(entrada.perfiles)) {
    return { error: ERROR_FORMA_INESPERADA };
  }
  const cuentas = entrada.cuentas as CuentaParaPlan[];
  const perfiles = entrada.perfiles as PerfilParaPlan[];

  const vigentes = new Set<string | undefined>(
    cuentas.map((c) => c?._id).filter((id): id is string => Boolean(id)),
  );

  const perfilesExcedidos = new Set(
    perfiles.filter((p) => p?.isOverLimit === true && p._id).map((p) => p._id as string),
  );
  const excedidas = new Set<string>();
  for (const c of cuentas) {
    if (!c?._id) continue;
    const perfil = c.profileId;
    const marcadoEnLaCuenta = typeof perfil === "object" && perfil?.isOverLimit === true;
    const id = idDePerfil(perfil);
    if (marcadoEnLaCuenta || (id && perfilesExcedidos.has(id))) excedidas.add(c._id);
  }

  const hayZernioActivo = entrada.canales.some((c) => c.provider === "zernio" && c.is_active);
  if (vigentes.size === 0 && hayZernioActivo) {
    return { error: null, aDesactivar: [], ceroCuentas: true, excedidas, vigentes };
  }

  const aDesactivar = entrada.canales
    .filter((c) => debeDesactivarseCanal(c, vigentes))
    .map((c) => c.id);
  return { error: null, aDesactivar, ceroCuentas: false, excedidas, vigentes };
}
