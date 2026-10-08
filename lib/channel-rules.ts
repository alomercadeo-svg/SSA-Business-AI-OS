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
  canales: readonly (CanalParaReglas & { id: string; platform_account_id?: string | null })[];
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

  // Una cuenta que volvió con otra ranura (F26, 08/10/2026) sigue vigente
  // aunque su ranura vieja ya no venga: la sincronización le cambia la ranura
  // a esa fila en vez de apagarla.
  const identidadesVigentes = new Set(
    cuentas.map((c) => platformUserIdDe(c)).filter((id): id is string => id !== null),
  );
  const aDesactivar = entrada.canales
    .filter((c) => debeDesactivarseCanal(c, vigentes))
    .filter((c) => !(c.platform_account_id && identidadesVigentes.has(c.platform_account_id)))
    .map((c) => c.id);
  return { error: null, aDesactivar, ceroCuentas: false, excedidas, vigentes };
}

// ── La identidad de un canal es la cuenta, no la ranura (F26) ───────────────

/**
 * El identificador de la cuenta en la plataforma, tal como lo manda Zernio.
 *
 * El SDK (0.2.519) no lo declara en `SocialAccount`, pero llega en la raíz de
 * cada cuenta de `GET /v1/accounts`. Verificado el 07/10/2026 con un GET de
 * solo lectura: la cuenta de Instagram del negocio trae `platformUserId` como
 * texto, y además `metadata.instagramScopedId`. Si no viene, o viene vacío, es
 * nulo: la ausencia nunca se interpreta como "otra cuenta".
 */
export function platformUserIdDe(cuenta: unknown): string | null {
  const v = (cuenta as { platformUserId?: unknown } | null)?.platformUserId;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  return v.trim() || null;
}

/** Sin plataforma de un lado no se puede decir que sean distintas. */
function mismaPlataforma(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || a === b;
}

export interface CanalParaIdentidad {
  id: string;
  late_account_id: string | null;
  platform_account_id: string | null;
  is_active: boolean;
  /** Para no cruzar plataformas al buscar por identidad. Opcional en los tests. */
  platform?: string | null;
  created_at?: string | null;
}

function masReciente<C extends CanalParaIdentidad>(canales: readonly C[]): C | undefined {
  return [...canales].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

export type DecisionDeCuenta<C extends CanalParaIdentidad> =
  /** No hay fila para esta cuenta: se crea. */
  | { tipo: "crear"; identidad: string | null }
  /**
   * Es la misma cuenta: se actualizan los datos de presentación. Con
   * `actualizarRanura`, la cuenta volvió con otro `_id` de Zernio y la fila
   * pasa a apuntar a la ranura nueva.
   */
  | { tipo: "existente"; canal: C; completarIdentidad: string | null; actualizarRanura?: string }
  /** La ranura de Zernio pasó a otra cuenta: la fila vieja se desactiva y se crea otra. */
  | { tipo: "reemplazar"; viejo: C; identidad: string };

/**
 * Qué hacer con una cuenta que trajo la sincronización (criterio de F26 del
 * 22/09/2026).
 *
 * Lo medido ese día: Zernio le dio a `@alomercadeo` el mismo `_id` que tenía
 * `@theconsultour`, y la sincronización renombró la fila. Todo lo que colgaba
 * de ella pasó a colgar de otra cuenta, y la tarjeta mostraba la fecha de
 * conexión de la vieja. La regla:
 *
 * - **Misma ranura y mismo `platformUserId`:** es la misma cuenta. Se actualiza
 *   el nombre de usuario si cambió, que es legítimo: una cuenta puede cambiar su
 *   handle sin dejar de ser ella.
 * - **Misma ranura, la fila activa sin identidad registrada:** es la primera
 *   vez que se observa. Se completa con la que trae Zernio. No hay forma de
 *   saber si antes era otra; desde acá en adelante sí.
 * - **Misma ranura, la fila activa con OTRA identidad:** no se renombra. Se
 *   desactiva, se crea un canal nuevo y queda en el historial.
 * - **La cuenta no trae `platformUserId`:** no se decide nada sobre la
 *   identidad y se sigue como antes del 07/10/2026. Una ausencia nunca
 *   desactiva un canal.
 * - **Solo filas inactivas en esa ranura:** si alguna es de esta misma cuenta,
 *   o no tiene identidad registrada, se toma esa, sin reactivarla (reactivar es
 *   a mano, `activarCanal`). Si todas son de otras cuentas, se crea una nueva.
 * - **La misma cuenta con OTRA ranura** (hueco anotado el 08/10/2026): si por
 *   ranura no aparece esta cuenta, se busca por `platform_account_id` en la
 *   misma plataforma, la activa primero. Esa fila es la cuenta: se toma, con
 *   `actualizarRanura`, y no se reactiva. Antes se creaba otra fila de la misma
 *   cuenta y el historial quedaba colgando de la vieja.
 */
export function decidirCanalDeCuenta<C extends CanalParaIdentidad>(
  cuenta: { _id?: string; platformUserId?: unknown; platform?: string | null },
  canales: readonly C[],
): DecisionDeCuenta<C> {
  const identidad = platformUserIdDe(cuenta);
  const candidatos = canales.filter((c) => c.late_account_id === cuenta._id);
  const activo = candidatos.find((c) => c.is_active);

  if (!identidad) {
    const canal = activo ?? candidatos[0];
    return canal ? { tipo: "existente", canal, completarIdentidad: null } : { tipo: "crear", identidad: null };
  }

  const misma = candidatos.filter((c) => c.platform_account_id === identidad);
  const mismaActiva = misma.find((c) => c.is_active) ?? (activo ? undefined : misma[0]);
  if (mismaActiva) return { tipo: "existente", canal: mismaActiva, completarIdentidad: null };

  if (activo) {
    return activo.platform_account_id === null
      ? { tipo: "existente", canal: activo, completarIdentidad: identidad }
      : { tipo: "reemplazar", viejo: activo, identidad };
  }

  // Sin fila activa en esta ranura, la cuenta puede tener su fila en otra
  // ranura (Zernio le dio otro `_id`): la fila de la cuenta manda.
  if (cuenta._id) {
    const deLaCuenta = canales.filter(
      (c) =>
        c.platform_account_id === identidad &&
        c.late_account_id !== cuenta._id &&
        mismaPlataforma(c.platform, cuenta.platform),
    );
    const enOtraRanura = deLaCuenta.find((c) => c.is_active) ?? masReciente(deLaCuenta);
    if (enOtraRanura) {
      return { tipo: "existente", canal: enOtraRanura, completarIdentidad: null, actualizarRanura: cuenta._id };
    }
  }

  const inactivaSinIdentidad = candidatos.find((c) => c.platform_account_id === null);
  if (inactivaSinIdentidad) return { tipo: "existente", canal: inactivaSinIdentidad, completarIdentidad: null };
  return { tipo: "crear", identidad };
}
