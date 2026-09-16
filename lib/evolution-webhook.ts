/**
 * Autenticación de los webhooks entrantes de Evolution API.
 *
 * Evolution NO firma el cuerpo del webhook. No hay HMAC, no hay nada
 * equivalente al mecanismo de Zernio. Lo que sí tiene, verificado en el código
 * de la versión 2.3.7 (`src/api/integrations/event/webhook/webhook.controller.ts`,
 * líneas 78 a 86 y 287 a 305), es el header `jwt_key`: al registrar el webhook
 * de una instancia se le pasa un secreto compartido, Evolution lo borra del
 * objeto de headers antes de enviar —así que nunca viaja por el cable— y en
 * cada entrega firma un JWT HS256 nuevo que manda en `Authorization: Bearer`.
 *
 * QUÉ PRUEBA ESTE TOKEN Y QUÉ NO
 * Prueba quién manda, no qué manda: la firma no está atada al cuerpo. Contra la
 * amenaza que importa acá, que es la inyección de mensajes falsos por parte de
 * alguien que descubre la URL del webhook, eso alcanza: sin el secreto no se
 * puede fabricar un token válido. La diferencia con el HMAC de Zernio solo
 * aparece si alguien puede interceptar y modificar el tráfico TLS entre dos
 * servicios del mismo proyecto de Railway, que es un atacante en la red y no el
 * escenario que estamos defendiendo. El replay lo cubre la idempotencia.
 *
 * LOS CLAIMS QUE TRAE, verificados en la misma fuente:
 *
 *     { iat, exp: iat + 600, app: 'evolution', action: 'webhook' }
 *
 * Cuatro, y ninguno identifica la instancia. Tampoco hay `iss`, `aud`, `sub` ni
 * `jti`. La consecuencia es de diseño y está en el receptor: el token no se
 * puede atar al canal por sus claims, así que lo que ata el evento al canal es
 * el secreto. El `instance` del cuerpo es una pista NO CONFIABLE que sirve para
 * elegir qué secreto probar; si la verificación pasa, el que mandó conocía ese
 * secreto, y recién ahí el `instance` queda autenticado hacia atrás.
 *
 * FUNCIONALIDAD NO DOCUMENTADA
 * `jwt_key` no aparece en la documentación oficial ni en el CHANGELOG del
 * repositorio. Está verificado en el código de la 2.3.7 y funciona, pero nadie
 * se comprometió a mantenerlo: puede desaparecer en la 2.4.0 sin figurar en el
 * changelog, porque nunca figuró que existía. Por eso la imagen está fijada en
 * `v2.3.7`, por eso hay que re-verificar este archivo contra el código fuente
 * en cada actualización de versión, y por eso el receptor alerta ante cualquier
 * rechazo: es la forma en que nos enteraríamos.
 *
 * Ver `docs/investigacion-evolution-api.md`, Pregunta 1.
 */

import { jwtVerify, errors as joseErrors } from "jose";

/** Proveedor con el que se registran las alertas de este receptor. */
export const EVOLUTION_SOURCE = "evolution";

/** Condiciones de alerta del receptor. Coinciden con `webhook_alerts.alert_condition`. */
export const EVOLUTION_ALERTS = {
  /** El token no verificó: firma inválida, vencido, ausente o mal formado. */
  authFailed: "webhook_auth_failed",
  /** Llegó un aviso para una instancia que no existe en nuestra base. */
  unknownInstance: "webhook_unknown_instance",
} as const;

/**
 * Tolerancia de reloj, en segundos.
 *
 * El default de `jose` es cero. Un desfasaje de pocos segundos entre el reloj
 * de Railway y el nuestro haría fallar la verificación, y un rechazo acá no es
 * recuperable: Evolution corta los reintentos y descarta el mensaje. Un minuto
 * de tolerancia sobre una ventana de diez no debilita nada apreciable y elimina
 * una clase entera de pérdida silenciosa.
 */
const TOLERANCIA_RELOJ_S = 60;

export type MotivoRechazo =
  | "sin_header"
  | "formato_invalido"
  | "firma_invalida"
  | "vencido";

export type ResultadoVerificacion =
  | { ok: true; claims: Record<string, unknown>; secretoUsado: "actual" | "anterior" }
  | { ok: false; motivo: MotivoRechazo };

/** Extrae el token de un header `Authorization: Bearer <token>`. */
function extraerBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token ? token : null;
}

/**
 * Verifica el token de una entrega de Evolution contra una lista de secretos.
 *
 * La lista, y no un secreto solo, es el mecanismo de rotación: durante la
 * ventana se aceptan el secreto nuevo y el viejo. El orden importa poco para la
 * seguridad y mucho para el diagnóstico, así que el primero es el actual y el
 * resultado dice cuál de los dos funcionó. Cuando `secretoUsado` es "anterior"
 * y la rotación ya se dio por terminada, eso es la señal de que Evolution
 * todavía no tomó el nuevo.
 *
 * POR QUÉ `algorithms: ['HS256']` ESTÁ FIJADO, Y POR QUÉ NO SE PUEDE SACAR
 * Sin la lista explícita, la verificación acepta cualquier algoritmo que el
 * propio token declare en su header. Eso habilita dos ataques clásicos:
 * `alg: none`, que declara que no hay firma y por lo tanto no hay nada que
 * verificar; y la confusión de algoritmo, donde un token firmado con un
 * algoritmo asimétrico se verifica usando la clave pública como si fuera un
 * secreto simétrico. Los dos convierten "hace falta el secreto" en "no hace
 * falta nada".
 *
 * El día que alguien lo saque para "simplificar", porque Evolution siempre
 * manda HS256 y la lista parece redundante, abre las dos puertas sin darse
 * cuenta y nada falla hasta que alguien lo explota. No se saca.
 */
export async function verificarTokenEvolution(
  secretos: string[],
  authorization: string | null,
): Promise<ResultadoVerificacion> {
  const token = extraerBearer(authorization);
  if (!token) return { ok: false, motivo: "sin_header" };

  const utilizables = secretos.filter((s) => typeof s === "string" && s.length > 0);
  if (utilizables.length === 0) return { ok: false, motivo: "firma_invalida" };

  // Se arrastra el motivo más informativo entre los intentos: si el token está
  // vencido, decirlo es más útil que "firma inválida", y no filtra nada.
  let motivo: MotivoRechazo = "firma_invalida";

  for (const [i, secreto] of utilizables.entries()) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secreto), {
        algorithms: ["HS256"],
        clockTolerance: TOLERANCIA_RELOJ_S,
      });
      return {
        ok: true,
        claims: payload as Record<string, unknown>,
        secretoUsado: i === 0 ? "actual" : "anterior",
      };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) motivo = "vencido";
      else if (
        err instanceof joseErrors.JWSInvalid ||
        err instanceof joseErrors.JWTInvalid
      ) {
        // Tres segmentos que no son un JWT, base64url roto, header ilegible.
        if (motivo !== "vencido") motivo = "formato_invalido";
      }
      // JWSSignatureVerificationFailed y JOSEAlgNotAllowed (alg: none, otro
      // algoritmo) caen en "firma_invalida", que es el default.
    }
  }

  return { ok: false, motivo };
}

/**
 * Chequeo de liveness sobre los claims constantes, que NO rechaza.
 *
 * `app: 'evolution'` y `action: 'webhook'` son constantes fijas del código de
 * Evolution. Como control de seguridad valen cero: cualquiera que tenga el
 * secreto puede ponerles el valor que quiera, así que no agregan ninguna
 * garantía sobre quién mandó el evento.
 *
 * Como control de liveness, en cambio, son un riesgo real: si una versión
 * futura cambia esa constante y nosotros rechazáramos por ella, cada mensaje
 * daría 401, Evolution cortaría los reintentos y se perderían todos. La
 * asimetría es deliberada: se registra la sorpresa y se procesa igual. Que
 * aparezca este warning es la señal de que hay que releer el código de
 * Evolution contra este archivo.
 */
export function avisarSiLosClaimsCambiaron(claims: Record<string, unknown>): void {
  if (claims.app !== "evolution" || claims.action !== "webhook") {
    console.warn(
      `[evolution-webhook] los claims constantes cambiaron: app=${String(claims.app)} ` +
      `action=${String(claims.action)}. Se esperaba app=evolution action=webhook. ` +
      `El evento se procesa igual a propósito, pero hay que re-verificar ` +
      `webhook.controller.ts contra lib/evolution-webhook.ts: puede ser una ` +
      `actualización de versión que cambió el mecanismo.`
    );
  }
}

// ── Idempotencia ────────────────────────────────────────────────────────────

/** Forma mínima de la clave de un mensaje de Evolution. */
export interface ClaveMensaje {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
}

/**
 * Clave de idempotencia para el ledger `webhook_events`.
 *
 * DOS DECISIONES, LAS DOS CON MOTIVO.
 *
 * El prefijo `evolution:` no es decorativo. `webhook_events` es una tabla
 * compartida con el receptor de Zernio, cuya clave primaria es un `event_id`
 * suelto. Sin prefijo, un id de Evolution podría coincidir con uno de Zernio y
 * uno de los dos eventos se descartaría como duplicado sin serlo.
 *
 * La terna `(remoteJid, id, fromMe)` y no `key.id` pelado, porque el id lo
 * genera el cliente que envía el mensaje, no un servidor central: es único
 * dentro de la conversación, no globalmente. La propia tabla `Message` de
 * Evolution no tiene restricción de unicidad sobre ese id y guarda con
 * `skipDuplicates`, así que los duplicados son esperables, no excepcionales.
 * Ver `docs/investigacion-evolution-api.md`, Pregunta 2.
 */
export function claveIdempotencia(instancia: string, key: ClaveMensaje): string | null {
  const jid = key?.remoteJid;
  const id = key?.id;
  if (!jid || !id) return null;
  return `evolution:${instancia}:${jid}:${id}:${key.fromMe ? "1" : "0"}`;
}
