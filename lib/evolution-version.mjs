/**
 * La versión de Evolution API que este código espera.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ANTES DE CAMBIAR ESTOS VALORES                                            │
 * │                                                                           │
 * │ Leer el `webhook.controller.ts` de la versión nueva y confirmar que       │
 * │ `jwt_key` sigue existiendo y firmando igual.                              │
 * │                                                                           │
 * │ NO ES OPCIONAL, y el motivo es que el mecanismo con el que autenticamos   │
 * │ TODOS los webhooks entrantes está verificado en el código pero NO         │
 * │ documentado: no aparece en la documentación oficial ni en el CHANGELOG.   │
 * │ No documentado es no soportado, así que puede desaparecer en una versión  │
 * │ nueva sin que figure en ninguna parte.                                     │
 * │                                                                           │
 * │ Y la forma en que nos enteraríamos sería la peor posible: los webhooks    │
 * │ dejan de traer el header `Authorization`, el receptor sigue fallando      │
 * │ cerrado con 401, y Evolution descarta cada evento sin reintentar. Mensajes│
 * │ de leads perdidos en silencio hasta que alguien mire la bandeja vacía.    │
 * │                                                                           │
 * │ QUÉ LEER, en la versión nueva:                                            │
 * │   src/api/integrations/event/webhook/webhook.controller.ts                │
 * │     · el bloque que lee 'jwt_key' de los headers de la instancia y arma   │
 * │       `Authorization: Bearer`        (en la 2.3.7: líneas 78 a 86)        │
 * │     · generateJwtToken(), que firma HS256 con exp a 600 s                 │
 * │                                      (en la 2.3.7: líneas 287 a 305)      │
 * │                                                                           │
 * │ El equivalente de nuestro lado está en lib/evolution-webhook.ts.          │
 * │                                                                           │
 * │ ── SEGUNDA COSA QUE HAY QUE REVISAR, Y ES DE SIGNO CONTRARIO ─────────    │
 * │                                                                           │
 * │ Confirmar si `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` **empezó a        │
 * │ funcionar**. Hasta la 2.3.7 se lee y no se consume en el camino de        │
 * │ `fetchInstances`, así que ese endpoint devuelve el `token` de la          │
 * │ instancia con la variable en `false`. Medido el 17/09/2026, con su        │
 * │ control positivo: se confirmó en Railway que la variable existe y dice    │
 * │ `false`.                                                                  │
 * │                                                                           │
 * │ Eso es una fuga de credencial que hoy nos conviene, y por eso hay que     │
 * │ decirlo con incomodidad: `scripts/setup-evolution-channel.mjs` recupera   │
 * │ el token de una instancia ya creada leyéndolo de ahí, en vez de borrar    │
 * │ la instancia y rehacerla. **Esa recuperación se apoya en que la variable  │
 * │ siga rota.**                                                              │
 * │                                                                           │
 * │ Si una versión nueva la arregla, el camino no destructivo deja de         │
 * │ funcionar. No falla en silencio —el script lo detecta y manda al camino   │
 * │ destructivo, que se conservó a propósito como respaldo— pero conviene     │
 * │ enterarse acá y no en medio de una recuperación.                          │
 * │                                                                           │
 * │ QUÉ LEER: `emit()` y el camino de `fetchInstances` en                     │
 * │   src/api/services/channel.service.ts                                     │
 * │ Lo que NO cambia con la versión: el token viaja igual en el cuerpo de     │
 * │ cada webhook, así que `lib/evolution-log-crudo.test.ts` sigue siendo la   │
 * │ defensa real.                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * POR QUÉ ESTE ARCHIVO ES .mjs Y NO .ts
 * Para que `scripts/verify-evolution-deploy.mjs` lo importe directo. La
 * alternativa era dejar la constante en TypeScript y que el verificador la
 * extrajera con una expresión regular, y un control que saca su propio valor
 * parseando texto tiene una forma más de fallar en silencio: si la regex deja de
 * matchear, el control no falla, simplemente deja de comparar.
 *
 * POR QUÉ SON DOS CONSTANTES Y NO UNA
 * El tag de Docker lleva `v` y el `package.json` de Evolution no. Son dos
 * cadenas distintas y hay que mantener las dos: el servidor reporta `2.3.7` en
 * `GET /`, mientras que la imagen se llama `v2.3.7`. Compararlas entre sí sin
 * tener en cuenta la `v` haría que el verificador fallara siempre.
 *
 * `lib/evolution-version.test.ts` comprueba que las dos no se desincronicen, y
 * corre en cada `npm test` sin depender de que exista un despliegue.
 */

/** La imagen exacta que va en Railway. Nunca `latest`. */
export const EVOLUTION_IMAGEN = "evoapicloud/evolution-api:v2.3.7";

/** Lo que el servidor reporta en `GET /`, desde su package.json. Sin la `v`. */
export const EVOLUTION_VERSION_ESPERADA = "2.3.7";

/**
 * Por qué la imagen va fijada y no en `latest`.
 *
 * Comprobado contra la API de Docker Hub el 16 de septiembre de 2026: el tag
 * `latest` apunta a un build del 6 de mayo de 2026, digest `sha256:96662553…`,
 * que NO corresponde a ninguna release etiquetada. `v2.3.7` es del 5 de
 * diciembre de 2025, digest `sha256:1bd8afc4…`.
 *
 * La plantilla oficial de Railway usa `latest`, así que desplegar con ella
 * entrega algo distinto de lo que uno cree estar desplegando.
 */
export const MOTIVO_DE_FIJAR_LA_VERSION =
  "latest apunta a un build que no corresponde a ninguna release etiquetada";
