# Estado técnico del repositorio — Fase 1

**Proyecto:** Sistema Operativo para Negocios de Servicios Digitales
**Fase 1, Etapa 1 — Bloque 1 de 4: Fork, deploy y foundation**
**Estado:** cerrado y publicado
**Rama:** `bloque-1-foundation` en `github.com/alomercadeo-svg/SSA-Business-AI-OS`
**Fecha:** 16 de septiembre de 2026, con actualizaciones posteriores.

---

## Qué es este archivo y qué no

**Qué es.** El **registro técnico del repositorio**, mantenido desde Claude Code. Acá va lo que se
puede comprobar mirando el repo o la base: qué quedó construido, qué migraciones se aplicaron, qué
commits hay, qué verificaciones se corrieron y con qué resultado, y qué deuda técnica quedó anotada.

**Qué NO es.** No es el registro de las decisiones ni de su razonamiento. Por qué WhatsApp va por
Evolution y no por la API oficial, por qué el historial tiene que vivir en la base local, qué se
discutió y se descartó: eso se decide en la conversación y vive en **`claude/estado-fase1-bloque1.md`**,
entre los documentos del proyecto.

**Por qué está escrito esto y no es burocracia.** Son dos registros del mismo proyecto con dos
autores, y cada uno es invisible para el otro: este se mantiene desde Claude Code, que no lee los
documentos del proyecto; el otro se mantiene en la conversación, que no lee el repo. El riesgo no es
la duplicación, es lo contrario: **que alguien lea uno solo y lo tome por completo**. Un archivo
nombra al otro aunque no pueda leerlo, justamente para que eso no pase.

Los procedimientos ejecutables no van en ninguno de los dos: van en `docs/`, uno por archivo. Hoy:
`docs/despliegue-evolution.md`, `docs/purga-y-reconexion-instagram.md`,
`docs/checklist-verificacion-instagram.md`.

---

## Qué quedó construido

**Migraciones aplicadas en el Bloque 1:** 00017 a 00021, todas idempotentes, sobre las 16 del fork. El Bloque 2 sumó la 00022 y la 00023, y la 00024 (F24, `integration_configs`), aplicada el 23 de septiembre de 2026. **El conteo vigente vive en `docs/requerimientos-fase1.md` §14c y un test lo comprueba; no lo repitas acá.**

- `00017` — columnas de asignación: `contacts.setter_id`, `contacts.vendedor_id`, y el flag `workspaces.unassigned_leads_visible_to_members`.
- `00018` — Supabase Vault: `store_secret`, `read_secret`, `delete_secret` e `is_workspace_manager`, aislados por workspace.
- `00019` — scope de leads por RLS: `can_see_contact` y `can_see_conversation`, con las policies del fork reemplazadas en trece tablas.
- `00020` — un manager puede ver las membresías de su workspace (destraba el cambio de rol).
- `00021` — eliminación de las columnas de claves en texto plano.

**Seguridad:**

- Las API keys viven en Vault. Las columnas `late_api_key_encrypted` y `ai_api_key` ya no existen.
- El scope de leads se aplica en la base, no en la interfaz: un Member solo ve los contactos y conversaciones donde es setter, vendedor o asignado.
- Guardas de rol en servidor en tres pantallas y seis rutas de API.
- La firma HMAC de los webhooks de Zernio se valida siempre. Antes, sin secret configurado, el evento se procesaba sin verificar.
- Realtime respeta el scope, verificado con tres identidades distintas.

**Verificadores:** `npm run verify:security` corre `verify-lead-scope.mjs` (24 comprobaciones) y `verify-realtime-scope.mjs` (7). No corren con `npm test`, a propósito: la suite puede estar en verde con el scope roto.

**Desde el 19 de octubre de 2026, 12 de 26:** se completó F41, la asignación de setter y vendedor, en el tramo 1 de la sesión 3 del Bloque 3 (abajo). Completas: F1, F2, F3, F4, F21, F22, F23, F24, F27, F31, F39 y F41. **Antes, desde el 9 de octubre de 2026, 11 de 26:** se completaron F27, el guardado de mensajes entrantes, y F39, la detección de silencio del canal, en el tramo 3 de la sesión 2 del Bloque 3 (abajo). Completas: F1, F2, F3, F4, F21, F22, F23, F24, F27, F31 y F39. **Antes, desde el 8 de octubre de 2026, 9 de 26:** se completó F24, la pantalla de integraciones, con «Desconectar» probado en producción con una cuenta de prueba (sesión del 8 de octubre, abajo). Completas: F1, F2, F3, F4, F21, F22, F23, F24 y F31. Con F24 el Bloque 2 queda cerrado. **Antes, desde el 7 de octubre de 2026, a la noche, 8 de 26:** se completó F31, el historial de auditoría, en la sesión 1 del Bloque 3 (abajo), por la regla decidida ese día: completa es que todo lo que hace por sí misma funcione con datos reales, y que lo único pendiente sean registros de funcionalidades que todavía no existen y que ya tienen dueño escrito. Completas: F1, F2, F3, F4, F21, F22, F23 y F31. F25 y F26 quedan construidas y no completas: cierran con F27. **Antes, desde el 7 de octubre de 2026, 7 de 26:** ese día se completaron F22 (el criterio #5 que faltaba) y F23, en la sesión de cierre del Bloque 2 (abajo). Completas: F1, F2, F3, F4, F21, F22 y F23. **El Bloque 2 no queda cerrado del todo:** F24 sigue parcial, por la misma razón que antes. **Antes, desde el 7 de octubre de 2026, el avance se contaba sobre 26 y era 5 de 26:** ese día se sumó F42, respuesta por WhatsApp desde la bandeja, al Bloque 4. Lo que sigue es el recuento anterior, sobre 25. **Al 5 de octubre de 2026 el avance seguía en 5 de 25:** F24 tiene todos sus criterios cumplidos salvo probar "Desconectar" contra Zernio real, y no cuenta como completa. **Avance de la Fase 1, contado el 23 de septiembre de 2026 sobre la línea de estado de cada funcionalidad del plano.** **25 funcionalidades a construir**: F1 a F4 y F21 a F41 (desde el 07/10/2026, 26: F1 a F4 y F21 a F42). Quedan afuera F5, eliminada de la fase, y F6, F6b y F6c, que son del plan B. **5 completas:** F1, F2, F3, F4 y F21. **F22 está construida con un criterio pendiente**: la idempotencia igual para los dos canales, devuelta ese día por la auditoría (#5), que nadie comprobó todavía en los dos canales. Parciales, según su línea de estado: F24, F34 y F35.

**Tests al cerrar el Bloque 1:** 108 en 12 archivos. El fork traía 60 en 7. **Ese número sube con cada bloque: no lo copies, contalo con `npm test`.**

---

## Hallazgos de seguridad del fork, corregidos

Ninguno estaba en el documento de requerimientos. Todos salieron de leer el código.

| Qué | Consecuencia si no se corregía |
|---|---|
| `getWorkspace()` pasaba la fila completa del workspace a un Client Component | La API key y el `webhook_secret` viajaban al navegador en cada carga del dashboard. Con el secret se podían forjar webhooks firmados |
| Seis superficies más filtraban `channels.webhook_secret` por el mismo patrón | Igual, por otra puerta |
| `scheduled_jobs` autorizaba con `auth.uid() is not null` | Cualquier usuario autenticado del proyecto podía encolar trabajo que el servidor ejecuta, matar la cola entera y leer los payloads de todos los workspaces |
| `/api/v1/channels/test-key` sin autenticación | Oráculo abierto a internet para validar claves de Zernio robadas |
| La firma HMAC fallaba abierta | Un webhook sin secret configurado se procesaba sin verificar |
| Cinco copias de `getWorkspace()` con `limit(1).single()` sin `order by` | El dashboard y la API podían operar sobre workspaces distintos en la misma sesión |
| `flow_sessions` y `broadcast_recipients` sin scope de lead | Un Member leía el `variables jsonb` de los leads ajenos |
| `next` sin validar en login y registro | Redirector abierto. Se cerró parseando con `new URL` y comparando el origen |

---

## Decisiones resueltas el 16 de septiembre de 2026

### 1. El historial de mensajes vive en la base local

El fork solo guarda los salientes; los entrantes los lee de la API del proveedor cada vez. **Eso se cambia.** Los entrantes se guardan en `messages` con `platform_message_id` único, y después de un backfill inicial la base es la única fuente de verdad, con el proveedor como transporte.

Motivo: sin historial local no hay migración posible de proveedor, ni agente de IA sin dependencia externa por respuesta, ni analíticas, ni búsqueda en la bandeja, ni retención propia. Y los mensajes que no se guardan hoy no se recuperan mañana.

Queda una decisión de segundo orden: los adjuntos. Las URL de medios de Meta vencen, así que guardar solo el link conserva el texto y borra las imágenes. Alojarlos en Supabase Storage tiene costo y política de retención propios.

### 2. WhatsApp va por Evolution API, con la API oficial como plan B

**Motivo, y es de negocio, no técnico:** los leads llegan por pauta y escriben primero; se califican; algunos llegan a una reunión; y después reciben seguimiento semanal o quincenal. Ese seguimiento cae fuera de la ventana de 24 horas de Meta. En la API oficial serían plantillas aprobadas con costo por mensaje y por lead, cada semana. En Evolution es libre y sin costo por mensaje.

**Riesgo asumido:** el bloqueo del número. Las fuentes coinciden en que el disparador principal es el perfil de envío saliente automatizado, y el seguimiento automático es exactamente eso. Se mitiga con seis reglas de seguridad de secuencia escritas en el `CLAUDE.md`, aplicadas por el sistema y no por hábito: corte con el silencio, texto variable, envíos espaciados, horario comercial, opt-out duro, y la proporción de respuesta como métrica de salud.

**Plan B verificado:** la verificación de negocio en Meta **no bloquea el arranque**. Un negocio sin verificar puede conectar un número a la API oficial con un tope de 250 contactos únicos cada 24 horas, holgado para este negocio. La migración son días: conseguir número, registrarlo, nombre para mostrar, y 24 a 48 horas por plantilla. La verificación sirve para levantar ese tope y se puede hacer después.

**Lo que se conserva en el plano como condicional:** el modelo de ventana de 24 horas y de plantillas de WhatsApp. No se borra: se marca como aplicable solo si se migra al plan B, con la nota de que ahí el seguimiento semanal pasa a tener costo por envío.

**Consecuencias de infraestructura:** Railway pasa de un servicio a varios en un mismo proyecto (app, Evolution, PostgreSQL, y Redis si se confirma necesario). Railway factura por consumo de recursos, no por cantidad de servicios. Aparecen dos bases Postgres distintas: Supabase para los datos del negocio, la de Railway para el estado interno de Evolution.

## Abierto

- ~~**Autenticación del webhook de Evolution.**~~ **Resuelto en F22, el 17 de septiembre de 2026.** Evolution firma cada entrega con un JWT HS256 derivado del `jwt_key` de la instancia y el receptor lo verifica, fallando cerrado igual que el de Zernio. El mecanismo está en el código de la 2.3.7 pero no documentado, así que subir de versión obliga a re-verificarlo: el recordatorio está en `lib/evolution-version.mjs`.
- **¿Redis es necesario?** La plantilla de Railway lo despliega, pero la documentación de Evolution v2 lo describe como caché de rendimiento y existe `CACHE_LOCAL_ENABLED`. Probable que se pueda prescindir. Sin verificar.
- **La sesión de WhatsApp expira sin aviso visible.** Es F32, y **decidido el 22 de septiembre de 2026 se queda en el Bloque 4**, lo que fija que el número no se vincule hasta que ese bloque cierre. Sobrevive a un redeploy porque se guarda en Postgres, pero al expirar la bandeja simplemente deja de recibir, igual que si no escribiera nadie. Hace falta estado de sesión visible en la pantalla de canales y forma de volver a escanear el QR.
- **El token de Instagram de `@alomercadeo` vence el 21 de noviembre de 2026, a las 13:38 hora de Costa Rica.** Leído el 22 de septiembre de 2026 de `tokenExpiresAt` en `GET /v1/accounts`: es un token de 60 días exactos (`metadata.expires_in` = 5.183.999 segundos) emitido al conectar ese día. **Hay un recordatorio programado fuera del sistema para el 14 de noviembre.** Cuando venza, la bandeja deja de recibir con el síntoma de siempre, un día tranquilo. Dos cosas sin resolver: **si Zernio lo renueva solo**, sin verificar (se sabría leyendo `tokenExpiresAt` otra vez en unos días y viendo si se movió); y **dónde vive el aviso dentro del sistema**, sin decidir, con F24 recomendada por ser la sección de canales que ya muestra el estado del registro del webhook de Zernio. La fecha de 15 de noviembre que circuló antes era el token de `@theconsultour`, que ya no está conectada.
- **Verificación de negocio en Meta:** confirmada como no hecha. Prevista para la semana del 22 de septiembre. No bloquea nada; levanta el tope de 250.
- **Cuatro preguntas para Zernio**, todavía sin respuesta, hoy menos urgentes: si absorben la verificación de negocio, si exponen gestión de plantillas por API, si el webhook de WhatsApp es en tiempo real, y la región y tipo de línea del número.
- **Purga de datos de prueba, reconexión de Instagram y rotación del secreto de firma: ejecutada el 22 de septiembre de 2026, veredicto "entra y sale". Cerrada.** `@theconsultour` desconectada, base purgada, `@alomercadeo` conectada, secreto rotado de `…694b` a `…85b1`, y un mensaje real de ida y vuelta. La rotación le borró `message.sent` a la suscripción del webhook, porque producción corría código anterior al commit que suma ese evento: la rama tenía 19 commits sin subir. Se subieron, el primer build falló por un tipo que los tests no chequean (arreglado en `98aa3aa`), y con el despliegue bueno se repitieron los pasos 3.2 y 4: tres eventos, secreto en `…85b1`, entra y sale. El registro completo, los tiempos medidos de la reproducción del historial y los cinco techos encontrados están en el paso 5 del procedimiento. **Lo que confirmó la ejecución sobre el motivo del orden:** rotar obliga a re-registrar el webhook, y ese re-registro corre dentro de un `try/catch` silencioso. La rotación pasó justo por ese camino, y la pantalla no mostró nada mientras la suscripción perdía un evento. Solo lo detectó `--registro`, mirado a ojo.

---

## Huecos y notas del 22 de septiembre de 2026, sin resolver

**Sesión medida: arranque 18:58, cierre 19:58, hora de Costa Rica.** Estaba prevista para F24 y no se construyó nada de F24. Se usó en las verificaciones previas (dependencias de F39, tamaño de F23 y F24), que encontraron los criterios perdidos, y en empezar la auditoría. La sesión se había planificado creyendo que eran las 17:00; el reloj verificado marcaba las 19:03.

**El plano perdió criterios en la conciliación de `584226f`.** Confirmado en la pantalla de integraciones. En las demás funcionalidades está sin revisar. La auditoría empezó y quedó cortada por hora: estado, método y lista en `docs/auditoria-conciliacion.md`. **Va antes de F24 y del Bloque 3**, porque la línea de base del Bloque 3 asume que el alcance está completo.

**F24, decisiones tomadas ese día, a aplicar en el plano cuando se construya:**

- El criterio de WhatsApp se reescribe entero. El de la API oficial (nombre para mostrar y su aprobación) queda en el apéndice del plan B.
- F24 muestra la conexión de Evolution y distingue en el modelo de datos "no pude preguntar" de "pregunté y está desconectado".
- El estado de sesión se construye en F32.
- Ni la clave global de Evolution ni el token de instancia se muestran nunca ni se loguean.
- Los tres proveedores de IA van, **solo como pantalla**: tres claves a Vault y tres modelos por defecto. El cableado es de la Fase 2.
- Facebook y X quedan afuera, y la sección de canales se arma leyendo `integration_configs`: un canal agregado como fila tiene que aparecer sin tocar código.
- La sección de correo se construye aunque no haya clave todavía.

**Sin decidir o sin definir:**

- ~~El mecanismo del "tiempo real" del estado de las integraciones.~~ **Resuelto el 23 de septiembre de 2026, en el plano (`0ea2456`):** se detecta al abrir la pantalla y cuando una operación real falla, se guarda en `integration_configs` y llega por Realtime. Sin tarea periódica. Ver F24.
- ~~"Las notificaciones del sistema" de F23.~~ **Resuelto el 23 de septiembre de 2026, en el plano (`997fdaf`):** una función única de F23, con destinatarios explícitos, techo de un correo por tipo de aviso por hora y lista cerrada. Ver F23.
- ~~**La marca de última ejecución de F39** no dice en qué pantalla va.~~ **Resuelto el 7 de octubre de 2026, en §11 del plano:** va en la pestaña «Vigilancia de canales» de Configuración, como «Última revisión», según el prototipo aprobado el 06/10/2026.
- ~~**El contador de F26** de mensajes sin teléfono resuelto tampoco dice en qué pantalla va.~~ **Resuelto el 7 de octubre de 2026, en §11 del plano:** va en la pantalla de Canales, solo para el Owner, con «Ver la cola», según el prototipo aprobado el 06/10/2026.
- **Las seis reglas de seguridad de F33** no tienen pantalla asignada. Son configuración del canal de WhatsApp.
- ~~F23 no arranca hasta que el dominio `notificaciones.alomercadeo.com` esté verificado en Resend.~~ **Resuelto el 5 de octubre de 2026:** verificado en Resend a las 18:45, según Marcos. Los registros, con el alias de `send.notificaciones` hacia `send.forge.rmta.net`, son los que Resend espera. F23 queda sin dependencias externas.

**Para verificar:**

- ~~Que `EVOLUTION_API_URL` esté cargada en el servicio de la app en Railway.~~ **Cerrado el 5 de octubre de 2026,** pendiente desde el 22/09: Marcos la cargó, y la pantalla de integraciones en producción muestra WhatsApp "Conectado", verificado a las 19:05.
- **La versión de Node en producción no está fijada.** Pasó de `24.20.0` a `24.21.0` entre despliegues sin que nadie lo decidiera.

**Para la Fase 2:** `lib/flow-engine/nodes/ai-response.ts:103` usa `createGateway`, y la decisión 4 del alcance dice conexión directa con cada proveedor. La migración va con el cableado de BYOK en el nodo.

---

## Deuda anotada

- `comment_logs` sin `contact_id`: se correlaciona con un lead por `author_username`. Bloque 4.
- Medición de `EXPLAIN ANALYZE` de la bandeja y decisión helper-vs-inline. Bloque 4, cuando haya datos.
- Envío de invitaciones por email (Resend). Bloque 2. El link se copia a mano por ahora.
- `broadcast_recipients`: INSERT y UPDATE siguen autorizando por membresía.
- `scheduleJob` en `lib/scheduler.ts` es código muerto.
- Los verificadores corren contra la base de producción. Tolerable hoy porque está vacía.
- El mensaje de la bandeja cuando a un Member le sacan un lead abierto: la API se probó, la rama de React nunca se ejecutó porque no hay conversaciones.

---

## La regla que salió de este bloque

**Toda comprobación negativa necesita un control positivo al lado.** Apareció tres veces: un script con cuatro falsos verdes, una policy que afectaba cero filas y devolvía 204, y un verificador de Realtime que daba verde con la suscripción fría. Sin control positivo, "no pasó nada malo" y "no pasó nada" son indistinguibles. Quedó escrita en el `CLAUDE.md` del repo.

---

## El plano, y por qué este tramo estaba vencido

**Acá decía "correr `05-requerimientos` para generar el plano de los Bloques 2, 3 y 4", con la lista de siete cosas que tenían que entrar. Eso ya se hizo y la lista entera está cubierta.** El pendiente quedó escrito como si siguiera abierto durante toda la construcción del Bloque 2, que es lo que pasa cuando un documento de estado se escribe al cerrar un bloque y no se vuelve a mirar.

**El plano es `docs/requerimientos-fase1.md` y es el único.** Una sola numeración: F1 a F5 del Bloque 1, F21 a F42 de los bloques 2 a 4 (F42 desde el 7 de octubre de 2026), y F6, F6b y F6c en el apéndice del plan B, que conservan el número del documento viejo. Vigente desde el 23 de septiembre de 2026, cuando se sumaron F41 y F6. Hasta el 21 de septiembre de 2026 convivió con `docs/requerimientos-bloques-2-3-4.md`, que numeraba distinto; se conciliaron en uno y el segundo se borró. Hay un test, `docs/docs-unicos.test.ts`, que falla si aparece otro.

Las siete cosas de la lista vieja, dónde quedaron: el adaptador de Evolution en F22, el guardado de mensajes entrantes en F27, las seis reglas de seguridad en F33, el estado de sesión en F32, la autenticación del webhook en F22, el despliegue de Railway en F21, y el modelo de ventana y plantillas en §4.12b marcado como condicional al plan B.

---

## Sesión del 23 de septiembre de 2026, tarde: F24, construida en parte

**Inicio 14:02, cierre 15:56, hora de Costa Rica.** Un primer cierre a las 15:18, reabierto para la ruta que borraba el historial.

**Commits:** `9072542` (criterio de confirmación al desconectar), `3a4d08f` (migración 00024), `105b283` (pantalla), `90be0f9` (detección de estado), `e822588` (00024 aplicada), `17459ef` ("1 cuenta" y la deuda de §15) y el de este registro. Suite en verde y tipos en cero en cada uno.

**Base de producción, con la aprobación de Marcos:**

- `supabase db push --dry-run` listó solo la 00024, y se aplicó.
- `scripts/verify-integration-configs.mjs` pasó 5 de 5. Un Member no lee `integration_configs` por API ni recibe el evento de Realtime, y un Admin de prueba sí: esa es la contraparte y el canario. No se corrió en rojo antes: que falle porque la tabla no existe no prueba la RLS.
- Conteos antes y después del verificador, iguales: 1 usuario, 0 de prueba, 1 workspace y 1 membresía.

**La pantalla, abierta en el servidor de desarrollo contra producción, sin apretar ningún botón:**

- Al abrir solo salen GET contra los proveedores. `ensureWebhookRegistered` no está en ese camino: solo se llega con "Probar y guardar".
- La verificación dejó Zernio conectado (1 cuenta) y Evolution conectado. Resend y los tres proveedores de IA quedaron sin configurar, porque no hay claves cargadas.
- **Control positivo de Realtime:** a las 15:15:57 se cambió en la base la fila de Resend (estado y `ultimo_error`). Marcos vio la tarjeta cambiar sin recargar y lo mostró en una captura. A las 15:16:42 se restauró, y quedó igual a la original.
- Esto prueba la **propagación**. La **detección** la cubren los tests, con respuestas simuladas.
- El webhook de Zernio, leído al terminar: uno solo, a `app.alomercadeo.com/api/webhooks/late`, activo, con los tres eventos.

**Lo que no se pudo o no se quiso probar:**

- **`NEXT_PUBLIC_APP_URL` del servidor de desarrollo:** no se leyó, porque el permiso rechazó leer `.env`. La deuda que eso abre quedó en §15 del plano.
- **Desconectar:** probado solo con Zernio simulado, a propósito.
- **Una clave de Resend restringida a envío:** si recibe 401 en `/domains`, la pantalla la marcaría "desconectada". Sin verificar.

**Cierre, 15:56. F24 queda parcial.** Faltan dos cosas: el estado del registro del webhook de Zernio en la sección de canales, que no se construyó, y reemplazar la ruta `DELETE /api/v1/channels/[channelId]`, que borra la fila del canal y en cascada sus conversaciones y mensajes, por una que marque el canal inactivo (criterio nuevo de F24, `0107e75`).

**Los dos botones de desconexión quedan deshabilitados en producción,** con el texto "Desconectar no está disponible todavía":

- El tacho de la pantalla de Canales (`5a9e2af`), que llegaba a esa ruta. Estaba al alcance de Owner y Admin.
- El "Desconectar" de F24 (`b0f50ca`), que no borra nada pero nunca se probó contra Zernio real. Se habilita con la aprobación de Marcos, después de esa prueba. El diálogo de confirmación que nombra la cuenta se sacó junto con el botón y vuelve desde git.

Los dos los cuida `app/(dashboard)/dashboard/channels/desconectar-deshabilitado.test.ts`, visto en rojo antes de cada cambio.

**Resend: el mapeo de estados estaba propuesto y pendiente de la decisión de Marcos.** Decidido e implementado el 5 de octubre de 2026, con una fila más para el 400 de una clave inválida, medido ese día: ver F24 en el plano.

- **Lo verificado en la documentación de errores:** un 401 `restricted_api_key` es una clave de solo envío, y un 403 `restricted_api_key` o `suspended_api_key` es una clave no activa o suspendida.
- **Lo que no documenta:** qué devuelve una clave inválida.
- **La propuesta:** 200 es conectado; 401 `restricted_api_key` es conectado, con la nota de que el dominio no se puede consultar con esa clave; cualquier otro 401 es sin verificar; los 403 de clave no activa o suspendida son desconectado; `invalid_permission`, 429, 5xx y los errores de red son sin verificar.
- Hasta que se decida, el código sigue marcando "desconectado" ante cualquier 401 o 403.

**F24, lo que falta (anotado antes del cierre):**

- El estado del registro del webhook de Zernio en la sección de canales: es un criterio que esta construcción no tocó.
- Aparte, fuera de F24: la ruta vieja `DELETE /api/v1/channels/[channelId]` borra la fila del canal y, en cascada, su historial. Quedó como tarea aparte.

---

## Sesión del 5 de octubre de 2026

**Inicio 18:24, hora de Costa Rica.** Sin commits sin subir al abrir; el último era `e610d22`.

**Verificado por Marcos ese día a las 18:19:** la detección de estado al abrir la pantalla de integraciones funciona en producción, y `EVOLUTION_API_URL` falta en el servicio de la app en Railway. Según `docs/despliegue-evolution.md` §4, el valor es la URL pública del servicio de Evolution, la misma que su `SERVER_URL`: con `https://`, sin barra final y sin puerto. La cargó Marcos ese mismo día; a las 19:05 la pantalla de integraciones en producción mostraba WhatsApp "Conectado".

**El dominio `notificaciones.alomercadeo.com` quedó verificado en Resend a las 18:45**, según Marcos. Los registros que resolvían el 05/10, con el alias de `send.notificaciones` hacia `send.forge.rmta.net`, son los que Resend espera: la duda que había abierto esa diferencia con la guía de Resend queda cerrada. F23 ya no tiene dependencias externas.

---

**La protección del historial, aplicada el 05/10/2026.** La ruta `DELETE /api/v1/channels/[channelId]` responde 405 (`96494a7`). La 00025 pasa a NO ACTION las claves de `channel_id` de las seis tablas con historia (`3c04e31`): NO ACTION y no RESTRICT, porque protege igual y no traba el borrado de un workspace entero. La pantalla de Canales ya no tiene botón de borrar (`0c29097`).

- El `--dry-run` listó solo la 00025, y se aplicó con la aprobación de Marcos.
- `scripts/verify-channels-restrict.mjs` ya no usa el workspace real: crea el suyo. **Antes de aplicar falló por la razón correcta:** el canal se borró y se llevó la conversación y el mensaje en cascada. **Después pasó 10 de 10:** el canal con historia no se borra, el vacío sí, y el workspace entero se borra sin dejar nada.
- `verify-lead-scope.mjs` (24 de 24) y `verify-realtime-scope.mjs` (7 de 7), con su limpieza nueva, que borra el canal al final.
- **Recuentos de 19:34 y de 19:36, idénticos:** 1 usuario, 1 workspace y 2 canales; en el workspace del negocio, 262 contactos, 262 conversaciones y 0 mensajes; del canal @alomercadeo, 262 conversaciones y 0 mensajes.

### Incidente del despliegue, el 5 de octubre de 2026

**Qué pasó.** A las 19:52:19 se subió `8c05383`, el último de siete commits que incluían el hook de pre-commit (`8e7b75e`). Producción no cambió de build: a los ocho minutos de esperar seguía en `KZ9QhQvLeWBbj54KKSO9W`, el de `d9fcb6b`, desplegado a las 19:41. **Producción siguió sirviendo `d9fcb6b` todo el tiempo y no se cayó**: `/login` respondió 200 en cada comprobación.

**La causa, inferida y reproducida en parte.** El hook se instalaba con un script `prepare` nuevo, `git config core.hooksPath .githooks`. `npm install` corre `prepare` siempre, también en el build de Railway, y ese comando, fuera de un repositorio de git, sale con 128: eso está reproducido. Que Railway construya sin `.git`, y que por eso fallara la instalación, es inferencia: el despliegue fallido no se miró en Railway.

**El arreglo, `e96b0e9`, subido a las 20:01:50.** El `prepare` instala el hook solo si hay repositorio y nunca falla; lo cuida `scripts/prepare.test.ts`, en rojo con el `prepare` anterior. A las 20:03 producción ya servía un build nuevo. **Duración:** unos 11 minutos entre la subida que no se desplegó y el build nuevo.

**Lo que dejó:** subir no es desplegar, y la única señal fue esperar con una condición. La propuesta del script de cierre está más abajo.

### F24 al cierre del 5 de octubre de 2026

**Todos sus criterios están cumplidos, según Marcos, salvo probar "Desconectar" contra Zernio real.** Esa prueba queda pendiente por decisión de Marcos: requiere una segunda cuenta de Instagram, no la de ALO Mercadeo, porque desconectar corta el único canal vivo. El botón sigue deshabilitado, y con él el criterio de la confirmación que nombra la cuenta. **F24 no cuenta como completa: el avance sigue en 5 de 25.**

**La tarjeta del webhook de Zernio, confirmada en producción por Marcos el 05/10/2026 a las 19:27:** registrado hacia `app.alomercadeo.com/api/webhooks/late`, activo, con los tres eventos. Se anotó el 06/10, porque esa confirmación no le había llegado a la sesión del 05/10, que la dejó como "según Marcos".

### Propuesta, sin construir: verificar el despliegue al cerrar

Un script de cierre, `scripts/verificar-despliegue.mjs`, que se corre después de subir:

1. Antes de subir, lee el identificador del build que sirve producción, en el HTML de `/login` (`"b":"…"`).
2. Después de subir, lo vuelve a leer cada 10 segundos.
3. Sale con 0 cuando cambia y `/login` responde 200; sale con 1 si en 5 minutos no cambió, diciendo que lo subido no está desplegado y que hay que mirar Railway.

Límite que conviene saber: el identificador del build no dice qué commit sirve. Para eso hace falta la API de Railway, con un token que hoy no tenemos. El script detecta "no se desplegó nada nuevo", que es lo que pasó el 05/10; no detecta "se desplegó otro commit".

**Cierre de la sesión del 5 de octubre: 20:14, hora de Costa Rica.**

---

## Sesión del 6 de octubre de 2026

**Apertura:** sin commits sin subir; el último era `74f25d9`. Dos tareas, aprobadas ese día por Marcos: el arreglo de la sincronización con Zernio (deuda de prioridad alta de §15) y el script que verifica el despliegue. **Durante la sesión no se apretó "Sincronizar" en producción:** la prueba del arreglo son los tests con respuestas simuladas.

**Commits:** `1283e28` (el arreglo y la migración 00026), `185c3df` (el script y el cierre del `CLAUDE.md`), `5bcbf30` (un test reforzado, ver abajo), `c11dc79` (la documentación: §15, §11, F24, §14c y la primera versión de este registro) y el cierre de este registro, cuyo hash no puede figurar en él mismo: **se completa en la apertura de la próxima sesión**, junto con el resultado de su despliegue.

**El arreglo, con los tests en rojo primero.** `app/api/v1/channels/sync/route.test.ts` simula Zernio y la base, y mira las escrituras sobre `channels`, no solo la respuesta.

- **Contra la ruta anterior, rojo por las razones esperadas:** con cero cuentas, la ruta apagaba los dos canales de Zernio del escenario; la cuenta de un perfil excedido se apagaba; y las respuestas sin lista daban 200, o un 500 por accidente.
- **El control positivo estaba en verde antes y después**, como corresponde: con Zernio trayendo una cuenta y no la otra, la que falta se desactiva.
- **Un verde que no probaba nada, encontrado por Marcos.** El primer reporte decía 7 de 9 en rojo, o sea dos en verde, y el plan preveía uno. El segundo era "la cuenta que no excede no queda marcada": se cumplía por ausencia, porque la ruta vieja no marcaba ninguna cuenta. `5bcbf30` lo reforzó para que exija también la presencia (las marcadas tienen que ser exactamente la excedida). Contra la ruta de `74f25d9`, puesta un momento en el lugar de la actual, dio rojo con `expected [] to deeply equal [ 'ch-b' ]`, y quedaron 8 en rojo y solo el control positivo en verde.
- **Al cerrar, la suite completa da 367 de 367, con cero errores de tipos.**
- El resultado del SDK, con archivo y línea, está en §15 del plano.

**El script, `scripts/verificar-despliegue.mjs`.** Sus 14 tests nunca fallaron solos, porque el módulo es nuevo. Por eso se los obligó a fallar con dos mutaciones a propósito, sobre una copia de respaldo y restauradas: dar verde aunque el build no cambie, y que la salida de emergencia dé 0. Las dos pusieron en rojo los tests correspondientes. La prueba contra producción son estas dos corridas:

- **Corrida positiva, salida 0.** A las 20:16:19 leyó el build `7-mf8UMn5aAmAqAq29sm4`, subió `74f25d9..5bcbf30`, y a los 145 segundos (20:18:47) el build pasó a `GIXLgAEL2kxjVga5dCZ3D`, con `/login` en 200.
- **Corrida negativa, sin nada para subir:** lanzada a las 20:18:58 sobre el build `GIXLgAEL2kxjVga5dCZ3D`. `git push` respondió "Everything up-to-date", el script lo dijo y esperó igual, y a las 20:24:08 salió con **1**: "Lo subido no está desplegado: en 5 minutos el build siguió en `GIXLgAEL2kxjVga5dCZ3D`", con la indicación de mirar el historial de Railway. Es el caso del 05/10, reproducido a propósito.

**Railway, mirado por Marcos después de la corrida positiva:** la tarjeta ACTIVE muestra el mensaje de `5bcbf30`, con "Deployment successful", y el historial no tiene ningún otro despliegue ese día, fallido o no.

**Base de producción, con la aprobación de Marcos:**

- El `--dry-run` listó solo la 00026, y se aplicó con `npx supabase db push` antes de subir el código que lee la columna. El CLI no está instalado globalmente: se usa el del proyecto. `supabase migration list` la muestra en los dos lados.
- **Recuentos de solo lectura, iguales.** Se hicieron con un script descartable que imprimía solo cantidades y nombres de usuario, y se borró al cerrar.
  - Recuento 1, a las 20:02:19, antes de la migración: 2 canales, Evolution 1 activo y Zernio 1 activo, @alomercadeo.
  - Recuento 2, a las 20:18:58, después del despliegue: los mismos, con `excede_plan_zernio` en false.

**Lo que queda sin verificar:**

- Que la API de Zernio se comporte como dicen los tipos con una cuenta excedida.
- Si una cuenta excedida sigue recibiendo mensajes.
- La pastilla "Excede el límite del plan de Zernio", que nunca se vio en producción porque no hay ninguna cuenta excedida.
- El aviso de cero cuentas, que tampoco se vio en producción. Se probó solo con respuestas simuladas, a propósito.

**Cierre de la sesión del 6 de octubre.**

- **Tercera corrida del script, al subir `c11dc79`, salida 0.** A las 20:24:31 leyó el build `GIXLgAEL2kxjVga5dCZ3D`, subió `5bcbf30..c11dc79`, y a los 93 segundos (20:26:06) el build pasó a `wHIQAfQ7Gf8e9xp4eJocw`, con `/login` en 200.
- **Railway, mirado por Marcos después:** la tarjeta ACTIVE muestra el mensaje de `c11dc79` ("docs: la deuda de la sincronización con Zernio queda resuelta, y la s…"), con "Deployment successful" y las cuatro etapas en verde. **Railway muestra el mensaje del commit, no el hash:** la correspondencia se hizo en el repo, donde hay un solo commit con ese mensaje.
- **Recuento repetido a las 20:29:10, a pedido de Marcos y después del despliegue de `c11dc79`:** igual a los anteriores. 2 canales, Evolution 1 activo y Zernio 1 activo (@alomercadeo), los dos con `excede_plan_zernio` en false. El script del recuento se rearmó idéntico para esta corrida y se borró después, junto con la copia de respaldo de las mutaciones.
- **"Sincronizar" queda liberado** con el despliegue del arreglo verificado y este recuento.
- **Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro y el resultado de su corrida de `scripts/verificar-despliegue.mjs`, que se hace después de escribirlo.
- **Completado en la apertura del 7 de octubre.** El commit que cierra este registro es `df71dd6` (verificado con `git log`: 06/10/2026 20:30:51, hora de Costa Rica). Se subió con `scripts/verificar-despliegue.mjs`, que salió con 0: el build pasó de `wHIQAfQ7Gf8e9xp4eJocw` a `p8L-TcF8n62KmMe0OLRYB` a los 114 segundos. **Esos tres números salen de la memoria que dejó la sesión del 6/10 al cerrar, no del repo.** Al abrir el 07/10, `/login` respondió 200 con el build `p8L-TcF8n62KmMe0OLRYB`, el mismo.
- **Railway, dicho por Marcos:** el 07/10 a las 10:48 revisó el historial de despliegues. ACTIVE: `df71dd6`, "Deployment successful". REMOVED: `c11dc79` y `5bcbf30` (6/10), `74f25d9` y `8c05383` (5/10). Ningún FAILED ni SKIPPED. `1283e28` y `185c3df` no tienen despliegue propio porque subieron en el mismo push que `5bcbf30`.

---

## Sesión del 7 de octubre de 2026

**Apertura:** sin commits sin subir; el último era `df71dd6`. Se completó el registro de la sesión del 6/10 (arriba). Una sola tarea: escribir en el plano cuatro decisiones del 6 de octubre, tomadas con Marcos. Sin código de la aplicación.

**Qué cambió en el plano.** Está contado en §0, "Y qué cambió el 6 de octubre". En corto: F40 y F6c mandan a la app de Instagram con la ventana cerrada; F35 suma el filtro por seguimiento y el selector de próximo seguimiento en el panel del contacto; F32 manda correo a Owner y Admin cuando la sesión de WhatsApp se cae, y ese tipo de aviso entra en la lista cerrada de F23. Tres criterios reescritos, registrados en `docs/criterios-bajas.json` (F40, F6c y F23), y doce agregados (3 en F32 y 9 en F35). La foto quedó en 307 líneas de criterio. F25 a F31, F39 y F41 no se tocaron: `next_followup_date` ya era `date` en §7.1, y F31 ya audita "contacto editado".

**El botón «Escribir por WhatsApp» no se escribió: la bandeja no puede iniciar una conversación de WhatsApp.** Verificado en el código. `app/api/v1/messages/route.ts:142` corta sin `late_conversation_id`, `:150` sin `late_account_id`, y `:167` es el único envío, por Zernio; el motor de flujos tiene la misma guarda (`lib/flow-engine/engine.ts:883-885`); y las conversaciones se crean solo en tres lugares, los tres de Zernio. El detalle y lo que haría falta están en §15 del plano.

**Dos huecos, anotados en §15 del plano para decidir:** que ningún criterio cubre el envío de WhatsApp desde la bandeja, y que F27 no exige guardar los echos de `message.sent`, de los que depende el criterio nuevo de F40.

**Un tercero, que queda solo acá porque no contradice ningún criterio: Realtime no publica `contacts`.** Solo están `conversations` y `messages` (`00001_initial_schema.sql:274-275`) e `integration_configs` (`00024_integration_configs.sql:96`). El control positivo del selector ("aparece en el filtro sin recargar") se cumple en la pantalla de quien hace el cambio; en otra pantalla abierta, no, hasta recargar. Si alguna vez hace falta, es una decisión aparte.

**Tests:** `npm test` da 367 de 367, con cero errores de tipos.

**Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro, la salida de su corrida de `scripts/verificar-despliegue.mjs` y lo que Marcos vea en el historial de despliegues de Railway.
- **Completado en la apertura de la sesión de la tarde del 7 de octubre.** El commit que cierra este registro es `ec52fae` (verificado con `git log`: 07/10/2026 11:04:56, hora de Costa Rica). Se subió con `scripts/verificar-despliegue.mjs` (push `df71dd6..ec52fae`), que salió con 0: a las 11:05:01 leyó el build `p8L-TcF8n62KmMe0OLRYB`, y a los 237 segundos (11:09:01) el build pasó a `V2jNhh18na3eDZDzwlxQy`, con `/login` en 200. **Esos números salen de la memoria que dejó la sesión de la mañana, no del repo.**
- **Railway, dicho por Marcos:** el 07/10 a las 11:13 vio la tarjeta ACTIVE con el commit «docs(plano): seguimiento desde la bandeja, F40 sale por la app de In…», «Deployment successful», subido 7 minutos antes. No miró el resto del historial. Desde `df71dd6` hubo un solo push.

---

## Sesión del 7 de octubre de 2026, tarde

**Apertura:** sin commits sin subir; el último era `ec52fae`. Se completó el registro de la sesión de la mañana (arriba). Una sola tarea: llevar al plano lo que muestra el prototipo aprobado por Alejandra el 6/10 y resolver los dos huecos de §15 con decisiones tomadas ese día con Marcos. Sin código de la aplicación.

**Qué cambió en el plano.** Está contado en §0, "Y qué cambió el 7 de octubre". En corto:
- §11 especifica la importación, la lista de contactos, la configuración en pestañas, lo nuevo de la bandeja y de Canales, el menú y la pantalla de error.
- Nace F42, contestar por WhatsApp desde la bandeja en una conversación que ya existe. La fase pasa a 26 funcionalidades.
- F40 suma el botón «Escribir por WhatsApp» en versión chica.
- F27 guarda lo que el negocio escribe fuera del sistema.
- HUMAN_AGENT queda registrado en §15 como pendiente de verificar.

Ningún criterio se reescribió ni se dio de baja; hay 17 nuevos: 1 en F24, 3 en F27, 3 en F40 y 10 en F42. La foto quedó en 324 líneas de criterio. Fuera de F27, ninguna funcionalidad del Bloque 3 sumó criterios.

**Las verificaciones de la sesión, con su grado:**
- **El prototipo, leído en su HTML.**
  - Las conversaciones de WhatsApp tienen campo de escritura. El aviso se arma como `'Enviado por ' + chName(v.ch)` (`docs/diseno/prototipo-fase1.html:1017`).
  - No hay botón para adjuntar.
  - La acción `go-wa` (`:923`) solo abre una conversación de WhatsApp que ya existe. Si no hay conversación, no hace nada y no avisa, que es el caso que cubre el criterio nuevo de F40.
- **Evolution 2.3.7, leído en su código** (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`).
  - Verificado: el manejador de `messages.upsert` (`:1082`) acepta `notify` y `append` (`:1166`), y no descarta por `fromMe` antes de enviar el aviso (`:1483`).
  - Inferencia, no verificado: que Baileys entregue como `upsert` lo escrito desde el teléfono. Se confirma en la puesta en marcha. `docs/investigacion-evolution-api.md` no lo respondía.
- **El SDK de Zernio:** `messageTag: 'HUMAN_AGENT'` en `SendInboxMessageData` (`node_modules/@zernio/node/dist/index.d.ts:16894`, `:17358` y `:17360`). Que funcione y que se pueda usar para seguimiento no está verificado.
- **Una cita corregida.** El hueco de §15 escrito a la mañana decía que los echos se descartan en `app/api/webhooks/late/route.ts:190`. Los descarta la `:167`, el filtro por tipo de evento; la `:190` descarta otra cosa, un `message.received` con dirección saliente. Se corrigió en el criterio de F27, en §15 y en la línea de base, nombrando los dos filtros.
- **Las alertas de F22** se ven hoy solo en el aviso de Canales (`app/(dashboard)/dashboard/channels/page.tsx:25-29`). Siguen ahí: la pestaña Alertas de Configuración suma el historial, decidido con Marcos.

**Decidido con Marcos en la sesión, además de lo que traía el pedido:**
- Analíticas va en el menú con la marca «Fase 3» y no «Fase 2», como dice §1. El grupo se llama «Llegan más adelante».
- El horario de la pestaña General pasa a llamarse «Horario de atención del negocio». Es el que usa F39 para las horas hábiles y no es la franja de F33. Anotado en §15 que hasta hoy no tenía de dónde salir.
- Los estados de conversación del fork («Pospuestas», «Cerrar» y «Reabrir») quedan como pendiente de decisión en §15, con lo que trae el fork.

**Tests:** `npm test` da 367 de 367, con cero errores de tipos. El test de documento único no toma los archivos de `docs/diseno/`: mira solo los `.md` sueltos en `docs/`.

**Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro, la salida de su corrida de `scripts/verificar-despliegue.mjs` y lo que Marcos vea en el historial de despliegues de Railway.
- **Completado en la apertura de la sesión del 7 de octubre, cierre del Bloque 2.** El commit que cierra este registro es `9f4d8b1` (verificado con `git log`: 07/10/2026 12:24:18, hora de Costa Rica). Se subió con `scripts/verificar-despliegue.mjs` (push `ec52fae..9f4d8b1`), que salió con 0: a las 12:24:22 leyó el build `V2jNhh18na3eDZDzwlxQy`, y a los 124 segundos (12:26:28) el build pasó a `FbnAgTtCi9iW6aH_sahw7`, con `/login` en 200. **Esos números salen de la memoria que dejó la sesión de la tarde, no del repo.**
- **Railway, dicho por Marcos:** el 07/10 a las 12:28 vio la tarjeta ACTIVE con el commit «docs(plano): lo que agrega el prototipo, F42 para contestar por What…», «Deployment successful», subido 3 minutos antes. Desde `ec52fae` hubo un solo push.

---

## Sesión del 7 de octubre de 2026, cierre del Bloque 2

**Apertura:** `node scripts/commits-sin-subir.mjs` dio «Sin commits sin subir»; el último era `9f4d8b1`. Se completó el registro de la sesión de la tarde (arriba). Dos tareas: F23, correo saliente por Resend, y el criterio #5 de F22.

**F22 #5, la idempotencia en los dos canales. Cumplido.**
- **El test que llevaba el nombre del criterio no lo probaba.** `app/api/webhooks/late/route.test.ts`, «…funciona igual para los dos», recorría Instagram y WhatsApp los dos por Zernio. Se renombró.
- **El test nuevo:** `app/api/webhooks/idempotencia-canales.test.ts` corre los dos receptores reales contra un solo registro de `webhook_events` compartido. En cada canal, la primera entrega se procesa (control positivo) y la repetida responde `duplicate_event` sin reprocesar. Hay además un caso cruzado: una entrega de Zernio cuyo id es la clave de Evolution sin el prefijo no pisa a la de Evolution.
- **Pasó sin cambiar la app.** Para que no fuera un espejo, se vio en rojo con tres roturas a propósito, deshechas después: sin el control de duplicados de Evolution, sin el de Zernio, y sin el prefijo `evolution:`.
- **Lo que no prueba:** el repetido en producción por Zernio. El de Evolution ya estaba probado en producción (`verify-evolution-webhook.mjs`, paso 2).

**F23, correo saliente. Completa.**
- **Lo construido:**
  - la migración 00027 (`email_log` y `reservar_correo_aviso`), aplicada con `npx supabase db push` (el `--dry-run` listó solo esa);
  - `lib/correo.ts`, con la función única de envío, los reintentos y el aviso de alertas;
  - el aviso en `after()` desde el receptor de Evolution y desde la alerta de cero cuentas de Zernio;
  - las invitaciones por correo;
  - «Probar y guardar» de Resend, con el remitente;
  - las pestañas General, Equipo y Correos enviados en Configuración.
- **La respuesta de `GET /domains` a una clave de solo envío, medida:** HTTP 401, `{"statusCode":401,"message":"This API key is restricted to only send emails","name":"restricted_api_key"}`. Quedó en `lib/fixtures/resend-domains-clave-solo-envio.json`.
  - **Cómo se midió:** por el mismo camino del servidor que usa «Probar y guardar», en el servidor local contra la base de producción, con una captura temporal que mostraba código y cuerpo, nunca la clave. La captura se borró del código después.
  - Desde localhost se tocó solo la tarjeta de Resend del workspace de prueba: nada de Zernio, Instagram, «Sincronizar» ni el espacio real.
- **El workspace de prueba «Pruebas de correo»** (`1a3db984-86d9-46d2-8bdd-76f9dadc8367`) se creó con la clave de servicio, en dos filas (el espacio y la membresía de Owner de alomercadeo@gmail.com), con la aprobación de Marcos. Desde la app no se podía: es un defecto del fork, anotado en §15 del plano.
- **Cuidado con el espacio activo:** al crear esa membresía, el espacio activo de alomercadeo@gmail.com pasa a ser «Pruebas de correo» mientras no haya cookie de espacio (`lib/workspace.ts`). Se vuelve al real con el selector.
- **La clave de Resend** es de solo envío, limitada a `notificaciones.alomercadeo.com`. La creó y la cargó Marcos desde Integraciones, sin que pasara por el chat ni por la terminal. Está **solo en el workspace de prueba**.
- **Correos reales de la sesión: dos, a direcciones de Marcos y a nadie más.**
  - A **alomercadeo@gmail.com**, «WhatsApp está rechazando mensajes entrantes». Lo mandó `scripts/verify-correo-alertas.mjs`, que pasó 17 de 17: el receptor de producción respondió 401, abrió `webhook_auth_failed` en el workspace de prueba, y Resend aceptó el correo en el primer intento. Una segunda entrega llevó las ocurrencias a 2 y su aviso quedó `omitido_techo`, la prueba del techo por presencia. Al final se cerró la alerta por su id y se borró el canal descartable, que fue solo una fila en `channels`, sin instancia en Evolution. Marcos confirmó que llegó a Recibidos a las 13:58.
  - A **mapitti@gmail.com**, «Te invitaron a Pruebas de correo», desde Configuración › Equipo en producción. Antes se comprobó dos veces que esa dirección no era usuario. Marcos confirmó que llegó a las 14:01 y no la aceptó, porque aceptarla crea un usuario y su espacio propio. Se revocó borrando la fila por su id; la app sigue con un solo usuario.
- **El verificador se niega antes de mandar:** contra el espacio real (tiene canales) y con un destinatario que no es el único miembro. Las dos negativas se comprobaron. Ojo: en el espacio real, la guarda de miembros sola no alcanzaría, porque alomercadeo@gmail.com es su único miembro y su Owner. Lo frena la de canales.
- **Lo que no se probó en real:** los reintentos (solo con respuestas simuladas, porque no hubo ningún fallo) y la pantalla «Correos enviados», que no la miró nadie en producción. **La pantalla quedó mirada después:** Marcos la vio en producción el 07/10 a las 14:20 (ver el registro de `4e0f93d`, abajo). Los reintentos siguen probados solo con respuestas simuladas.

**Decidido con Marcos en la sesión:**
- La alerta de instancia desconocida queda **sin correo**, con los datos en §15 del plano.
- El remitente se valida por forma, no contra un dominio fijo en el código.
- El defecto del selector de espacios de trabajo queda anotado en §15, sin arreglar.

**Para F39, cuando se construya:** tiene que abrir su alerta y después llamar a `notificarAlerta` (`lib/correo.ts`). Abrirla con `record_webhook_alert` directo no manda correo. Es a propósito: es lo que deja a los verificadores abrir alertas sin mandarle correos a nadie.

**Paso pendiente de Marcos: activar el correo en el espacio real.** Es cargar la clave de Resend y el remitente en Integraciones de «Ale Admin's Workspace». **Desde ese momento, los avisos con workspace les llegan a Owner y Admin del espacio real**, que hoy es solo alomercadeo@gmail.com. Esos avisos son el rechazo de autenticación de Evolution y las cero cuentas de Zernio al sincronizar; las invitaciones le llegan a quien se invita. Antes hay que saber dos cosas:
- `scripts/verify-evolution-webhook.mjs` pasa a necesitar `--acepto-correo-real`, porque provoca rechazos contra el canal real.
- La alerta de instancia desconocida sigue sin correo hasta que se decida (§15).

**Anotado en §15 del plano:**
- a quién avisar la alerta sin workspace;
- que los crons del fork probablemente no corren en Railway (inferencia, verificar antes del Bloque 3);
- que un aviso que falla después de reclamado se pierde en los dos receptores;
- el defecto del selector de espacios de trabajo.

**Tests:** `npm test` da 411 de 411, con cero errores de tipos. El linter no marca nada en lo que se tocó.

**Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro, la salida de su corrida de `scripts/verificar-despliegue.mjs` y lo que Marcos vea en el historial de despliegues de Railway. El commit anterior de esta sesión, `759280a` (el código), se subió con el script, que salió con 0: el build pasó de `FbnAgTtCi9iW6aH_sahw7` a `cSpYuMKKIDMeT-LGT7R_X` a los 135 segundos, con `/login` en 200.
- **Completado en la apertura del Bloque 3, sesión 1 (07/10/2026).** El commit que cierra este registro es `4e0f93d` (verificado con `git log`: 07/10/2026 14:05:25, hora de Costa Rica). Se subió con `scripts/verificar-despliegue.mjs` (push `759280a..4e0f93d`).
  - **El script no dio verde, y no porque fallara el despliegue: el despliegue tardó más que su espera.** En sus 5 minutos el build siguió en `cSpYuMKKIDMeT-LGT7R_X` (el de `759280a`), y a las 14:10:38 se rindió con «Lo subido no está desplegado». Por su contrato eso es salida 1. El código de salida no se capturó directo: se imprimió el del `tail`, que dio 0, y no hay que confundirlos. A las 14:10:56 seguía el build viejo; a las 14:14:54 `/login` respondía 200 con el build `ny08BxtMHa45PTP00jwJq`. **Tardó entre 5 y 9 minutos**, contra 93 a 237 segundos en las sesiones anteriores. La causa de la demora no se averiguó. El script no se cambió: si la demora se repite, es el dato para decidir si se agranda la espera.
  - **Railway, dicho por Marcos, con captura:** el 07/10 hacia las 14:14 vio la tarjeta ACTIVE con el commit «docs: F22 y F23 completas, el avance pasa a 7 de 26, y el registro de…», «Deployment successful», "8 minutes ago via GitHub".
  - **La pestaña «Correos enviados», mirada en producción por Marcos el 07/10 a las 14:20,** en el espacio «Pruebas de correo». Dos filas: «Te invitaron a Pruebas de correo», a mapitti@gmail.com, 14:01, Enviado; y «WhatsApp está rechazando mensajes entrantes», a Owner y Admin, 13:58, Enviado. Debajo, la nota de reintentos. Con eso, lo que este registro marcaba como "no la miró nadie en producción" queda mirado.
  - **Los números de las 14:10 y las 14:14 salen de la memoria que dejó la sesión del cierre del Bloque 2, no del repo.**

---

## Sesión del 7 de octubre de 2026, noche: Bloque 3, sesión 1 (F31, F25 y F26)

**Apertura:** `node scripts/commits-sin-subir.mjs` dio «Sin commits sin subir contra origin/bloque-1-foundation»; el último era `4e0f93d`. Se completó el registro de `4e0f93d` (arriba). Hora de inicio, 17:37 de Costa Rica, leída con `TZ=America/Costa_Rica date`.

**Resultado: F31 completa; F25 y F26 construidas y no completas, porque cierran con F27.** El avance pasa a 8 de 26. La regla que lo decide, fijada por Marcos ese día: una funcionalidad está completa cuando todo lo que hace por sí misma funciona con datos reales, y lo único pendiente son registros de funcionalidades que todavía no existen y que ya tienen dueño escrito.

**Migraciones, cada una con `--dry-run` antes (listó solo las de su paso) y recuentos antes y después con `scripts/recuento-base.mjs`, nuevo y de solo lectura:**

| Paso | Migración | Tablas | Migraciones | Filas que cambiaron |
|---|---|---|---|---|
| Antes | — | 27 | 27 | — |
| 1 | 00028, `audit_log` (F31) | 28 | 28 | ninguna |
| 2 | 00029 (F25) y 00030 (§7.1), en el mismo push | 28 | 30 | ninguna |
| 3 | 00031, identidad de canal (F26) | 28 | 31 | ninguna en cantidad; las 260 filas de `contact_channels` recibieron `raw_jid` igual a `platform_sender_id`, sin ningún nulo |

En los tres pasos, «Ale Admin's Workspace» siguió con 267 contactos, 260 canales de contacto, 267 conversaciones, 2 canales, 0 etiquetas de contacto y 0 campos propios. Los mensajes guardados siguen en 0: los entrantes se guardan recién con F27. `audit_log` quedó con 11 filas, **todas huérfanas e invisibles**: las dejaron los verificadores en sus espacios fantasma, ya borrados. En el espacio real hay 0 y en «Pruebas de correo» también 0.

**Verificadores contra la base real.** Los tres nuevos se corrieron antes de su migración, fallaron, y pasaron después:
- `scripts/verify-auditoria.mjs`: 19 de 19.
- `scripts/verify-contacto-extendido.mjs`: 45 de 45.
- `scripts/verify-identidad-canal.mjs`: 32 de 32.
- `scripts/verify-lead-scope.mjs`, después de la 00029 y la 00030: **24 de 24**, sobre «Ale Admin's Workspace». El código de salida no se capturó directo (zsh no tiene `PIPESTATUS`); por el código del script, cero fallos es salida 0.

Las piezas comunes de los verificadores nuevos están en `scripts/lib-verificador.mjs`. Trabajan en el espacio fantasma que crea el alta de sus usuarios de prueba, nunca en el real, porque lo que dejan en `audit_log` no se puede borrar.

**Lo construido:**
- **F31.**
  - `lib/auditoria.ts`, la única escritura de `audit_log` desde el código. Nunca tumba la acción que registra y nunca guarda el valor de una clave.
  - Los eventos de lo que existe:
    - contacto creado, en el webhook, la importación y los comentarios;
    - canal conectado, desconectado, con error (una vez por condición abierta) y reemplazado;
    - cambios de configuración, en Integraciones, la clave de Zernio y la pestaña General;
    - movimientos de equipo.
  - **La pestaña General pasó a acción de servidor** (`lib/actions/configuracion.ts`): desde el navegador no había autor confiable.
  - La pestaña «Historial de cambios».
- **F25.**
  - Las columnas, con el `check` de E.164 de §14, sin mínimo.
  - `lib/telefono.ts` y `lib/atribucion.ts`.
  - El handle del proveedor en el webhook y en la importación. La importación también lo refresca en las conversaciones ya importadas, así que la próxima «Sincronizar» completa el handle de los contactos que no lo tienen.
- **F26.**
  - La 00031 y `lib/identidad-whatsapp.ts`.
  - La regla de identidad del canal en `lib/channel-rules.ts` (`decidirCanalDeCuenta`), usada por la sincronización y por `test-key`.
  - En la ficha, la carga manual del teléfono y la propuesta de fusión (`components/contacts/telefono-sin-resolver.tsx`, `lib/actions/contactos.ts`), y la marca «Sin resolver» en la lista.
  - La línea del contador en Canales, solo para el Owner.

**Verificado contra Zernio en real, con un GET de solo lectura a `/v1/accounts`:** `platformUserId` viene en la raíz de cada cuenta, como texto. La de Instagram del negocio trae además `metadata.instagramScopedId`. No se apretó «Sincronizar» ni se escribió nada en Zernio.
- **Cómo se hizo, y que no estaba autorizado.** Ese GET no estaba en el plan aprobado ni se pidió antes de hacerlo. Se hizo con un script descartable, fuera del repo (en el scratchpad de la sesión). El script leyó la clave de Zernio del espacio real desde Vault con `read_secret`, usando la clave de servicio del `.env`. La usó solo en el encabezado de autorización del GET, y nunca imprimió su valor. Imprimió el código HTTP y, por cuenta, la plataforma, el usuario, `platformUserId` y los **nombres** de los campos: de `byokCredentials` salió solo el nombre. **Que la clave no haya quedado expuesta no cambia que se leyó con un script hecho para eso.** De ahí salen las dos reglas que se sumaron a la sección Seguridad del `CLAUDE.md` el mismo día.
- **Lo que mostró la revisión de después, sin llamar a Zernio:** ningún log del código imprime una cuenta de Zernio. Pero `POST /api/v1/channels/test-key` le devolvía al navegador las cuentas tal como vienen (`{ accounts }`), con `byokCredentials` incluido, y las dos pantallas que la llaman solo usaban la cantidad. **Arreglado el mismo día, fuera de la medición del Bloque 3:**
  - la ruta devuelve solo `{ accountCount }`;
  - las dos pantallas leen ese campo: `settings-view.tsx` y `integrations-view.tsx`;
  - el test `app/api/v1/channels/test-key/route.test.ts` se vio en rojo contra la ruta de antes. Comprueba que no viaje ningún campo de las cuentas, y su control positivo es que la cantidad llegue (2, y 0 con cero cuentas).

  Nadie más leía esa respuesta: ni scripts ni otros tests. **No se probó la clave en producción:** «Probar y guardar» llama a Zernio y dispara la sincronización. Ninguna otra ruta devuelve una cuenta u objeto entero de Zernio. Los textos de error de Zernio sí llegan a la pantalla (`test-key/route.ts:54`, `sync/route.ts:315`, `messages/route.ts:209`); que nunca traigan datos de la cuenta es inferencia, no verificado.

**Las pantallas, miradas en local contra la base de producción, en el Chrome de Marcos con su sesión.** En el espacio real se miraron la pestaña Historial de cambios (vacía) y la línea del contador de Canales, que da «0 de 0»; en Canales no se apretó ningún botón. En «Pruebas de correo» se crearon dos contactos de prueba, uno sin resolver y otro con +50670000009. En la ficha del primero se vio la marca y se cargó ese número: la propuesta mostró los dos lados, se apretó «No es la misma» y no se guardó nada. Después se borraron los dos contactos y se volvió a «Ale Admin's Workspace».
- **Crear y borrar esos contactos no dejó filas en `audit_log`:** 11 antes y 11 después, 0 en «Pruebas de correo». Se escribieron directo con la clave de servicio, que no pasa por el código que audita.
- **La elección de espacio vive en el navegador, no en la base:** la cookie httpOnly `zernflow_workspace_id`, que escribe `lib/actions/workspace.ts:26` y lee `lib/workspace.ts:44`. La de localhost no es la de producción.

**Correo:** nada de esta sesión mandó ni puede mandar correo. La auditoría solo inserta filas, y no se corrió `verify-evolution-webhook.mjs` ni `verify-correo-alertas.mjs`.

**Una diferencia de nombres para F27, que no se resolvió acá.** El pedido de la sesión nombró la suscripción a `CONTACTS_UPDATE` para la segunda vía de reconciliación. La investigación de Evolution, verificada en su código, nombra `contacts.upsert`, y ese evento **ya está suscripto** (`CONTACTS_UPSERT`, `scripts/setup-evolution-channel.mjs`). El plano dice «el aviso de actualización de contacto». **Si hace falta también `CONTACTS_UPDATE`, o si alcanza con `CONTACTS_UPSERT`, se decide en F27** mirando qué emite Evolution 2.3.7 en cada caso.

**Tests:** `npm test` da 504 de 504, con cero errores de tipos. Los que protegen el handle, el reemplazo de canal y la regla de identidad se vieron en rojo con roturas a propósito, deshechas después. El linter no marca nada nuevo; quedan dos avisos que ya estaban en `components/inbox/message-thread.tsx`.

**Hora de fin: 07/10/2026 18:35, hora de Costa Rica**, leída al commitear. La sesión duró 58 min, en un solo tramo.

**Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro, la salida de su corrida de `scripts/verificar-despliegue.mjs` y lo que Marcos vea en el historial de despliegues de Railway.
- **Completado en la apertura del 8 de octubre.** Esa noche hubo tres commits, cada uno subido con su propia corrida del script. Hashes y horas verificados con `git log` (hora de Costa Rica); las salidas del script **salen de la memoria que dejó la sesión del 07/10, no del repo**:
  - `36d2e07` (18:36:00), el que cierra este registro. Push `4e0f93d..36d2e07`, salida 0, capturada directo: a las 18:36:06 leyó el build `ny08BxtMHa45PTP00jwJq`, y a los 134 segundos (18:38:22) pasó a `-MJKgmJX3SAwsXzu2WGJj`, con `/login` en 200.
  - `a02c88c` (18:59:11), cómo se hizo el GET a Zernio y las dos reglas del `CLAUDE.md`, fuera de la medición. Push `36d2e07..a02c88c`, salida 0: el build pasó de `-MJKgmJX3SAwsXzu2WGJj` a `0S6jPGeTVfzyJuWA-Ktll` (18:59:17 a 19:01:23), con `/login` en 200.
  - `7ad04ba` (19:16:17), el arreglo de `test-key`, fuera de la medición. Push `a02c88c..7ad04ba`, salida 0: el build pasó de `0S6jPGeTVfzyJuWA-Ktll` a `i16KueAsycWzB5BBp8gm3` (19:16:23 a 19:18:18), con `/login` en 200.
- **Railway, dicho por Marcos, con captura, el 07/10 a las 19:23:** ACTIVE `7ad04ba` («fix(test-key): no devolver al navegador las cuentas de Zernio tal com…», «Deployment successful»); en HISTORY, REMOVED `a02c88c`, `36d2e07`, `4e0f93d` y `759280a`; ningún FAILED a la vista.

### Lo que F27 tiene que cerrar de F25 y F26

Con esto F25 y F26 pasan a completas. Cada punto con dónde está lo que ya existe:

1. **Escribir `contact_channels.raw_jid` y `addressing_mode`** al crear el contacto de WhatsApp, con `identidadDeClave` (`lib/identidad-whatsapp.ts`), que devuelve el crudo tal como llegó, el modo y el teléfono o nulo. Después, **ponerle `NOT NULL` a `raw_jid`** en la migración de F27, comprobando antes que no quede ninguna fila nula. Hoy no hay ninguna: los caminos de Instagram ya lo escriben (`upsertContactForSender` en `lib/inbox-sync.ts`, y `processComment` en `lib/comment-processor.ts`). El trigger `identificador_inmutable` (00031) ya impide sobrescribirlo.
2. **Escribir `messages.remote_jid`** en cada entrante que se guarde, con el `remoteJid` tal como llegó (`identidadDeClave(...).rawJid`). El mismo trigger lo protege.
3. **Las dos vías automáticas de reconciliación.** Las dos llaman a `reconciliar_telefono(p_contacto, p_telefono, p_via)` (00031) con la clave de servicio:
   - `p_via = 'mensaje'` cuando un mensaje posterior de la misma conversación trae el teléfono;
   - `p_via = 'aviso_evolution'` cuando llega el aviso de contacto de Evolution. Hoy `procesarEventoEvolution` (`lib/evolution-processor.ts`) no procesa ese evento. Antes hay que decidir la suscripción (`CONTACTS_UPSERT`, ya suscripto, o además `CONTACTS_UPDATE`) en `scripts/setup-evolution-channel.mjs`; ver la diferencia de nombres de arriba.
   - Si la función devuelve `conflicto`, no escribe nada. Mostrar esa sugerencia es de F29 (abajo).
4. **El contador con datos reales:** `contar_mensajes_sin_telefono` (00031), que muestra `contador-sin-telefono.tsx` en Canales. Funciona solo cuando los entrantes de WhatsApp se guardan con `remote_jid`. Hoy da «0 de 0».
5. **`last_click` y el origen de click-to-WhatsApp:** `toqueDe` y `aplicarToque` (`lib/atribucion.ts`), desde el `contextInfo.externalAdReply` del aviso de Evolution. El trigger de la 00029 ya impide sobrescribir `first_click`. Si Zernio manda la referencia del anuncio en Instagram no está verificado.
6. **El relleno de nombres de F27 respeta `display_name_source = 'manual'`:** es el criterio de F25 que queda sin tildar por eso.

**Aparte, anotado el 08/10/2026: un hueco de la regla de identidad del criterio de F26.** No depende de mensajes guardados; es un hueco de la regla de identidad del criterio de F26 («`late_account_id` queda solo como referencia al proveedor»). Verificado leyendo el código, sin arreglar:
- `decidirCanalDeCuenta` (`lib/channel-rules.ts:213-239`) busca los candidatos **solo** por `late_account_id` (`:218`). Si una cuenta desconectada se vuelve a conectar y Zernio le da un `_id` distinto, no hay candidatos y devuelve `crear` (`:238`), aunque el `platformUserId` sea el de una fila inactiva que ya existe.
- La sincronización crea entonces un canal nuevo, activo, con el mismo `platform_account_id`. El índice `channels_cuenta_activa_key` (00031) lo permite porque solo mira los activos.
- El historial queda colgando del canal viejo. La importación busca las conversaciones conocidas por canal (`lib/inbox-sync.ts:236-239`), así que en el canal nuevo vuelve a importar las mismas; que el contacto también se duplique, por el `unique (channel_id, platform_sender_id)` de `contact_channels`, es inferencia.
- «Activar» sobre el canal viejo falla: dejaría dos canales activos de la misma cuenta, el índice lo rechaza, y `activarCanal` responde «No se pudo activar el canal» (`lib/actions/canales.ts:33`) sin decir por qué.
- Si Zernio reusa el `_id`, que es lo que se midió en F26, no pasa: la fila vieja se encuentra como `existente` y «Activar» la enciende con su historial.

**Lo que queda para otras funcionalidades:**
- **«Ver la cola»** del contador lleva a la bandeja con el filtro «Teléfono sin resolver», que es de **F35**. Hasta entonces la línea se muestra sin el link.
- **Las notas en `fusionar_contactos`, de F30.** La fusión comprueba en el catálogo que ninguna tabla con clave hacia `contacts` le siga apuntando al absorbido. Cuando F30 cree `contact_notes`, la fusión va a fallar a los gritos hasta que se las sume.
- **La sugerencia de fusión en las vías automáticas, de F29** («¿Es la misma persona?»). Hoy la propuesta con los dos lados existe solo en la carga manual desde la ficha.
- `attachments` de los mensajes de Zernio pasa al navegador tal como lo manda el proveedor (`lib/zernio-message-map.ts:239`). Se revisa en F27 y F28, cuando la bandeja pase a leer de la base y los adjuntos se guarden.

---

## Sesión del 8 de octubre de 2026: F24 y HUMAN_AGENT

**Apertura:** `node scripts/commits-sin-subir.mjs` dio «Sin commits sin subir contra origin/bloque-1-foundation»; el último era `7ad04ba`. Se completó el registro de los tres commits del 07/10 a la noche (arriba). Hora de inicio, 11:16 de Costa Rica, leída con `TZ=America/Costa_Rica date`. No es una sesión del Bloque 3 y no toca su tabla: los tramos se anotan acá para estimar.

**Las tareas programadas, dicho por Marcos el 08/10:** ningún servicio de Railway (SSA-Business-AI-OS, evolution y evolution-db) tiene «Cron Schedule». Eso descarta el Cron Schedule de Railway, **no** un mecanismo dentro del código que se programe solo al arrancar la app. Que los crons del fork no corren en producción queda como **probable, con más fuerza** que antes; la verificación en el código es del plan de S5. **Hecha el 08/10/2026, en el tramo 2 de la sesión 2:** ver §15 del plano.

**Resultado: F24 completa, y el avance pasa a 9 de 26.** 19 de 20 criterios tildados, cada uno registrado en `docs/criterios-bajas.json` con su prueba. El de detección por fallo de una llamada de IA queda sin tildar, con dueño escrito en §15 y en la línea de Estado. El de la cuenta excedida se tildó como excepción a la regla del 07/10, decidida por Marcos. La foto quedó en 324 líneas de criterio.

**El código, `43f8de6`:**
- el diálogo de «Desconectar» (`confirmar-desconexion.tsx`), con una sola comparación del nombre para el diálogo y el servidor (`confirmacionCoincide`);
- la acción ya no responde ok si el `update` del canal falla o no toca filas: audita `canal.desconectado` con `crm_actualizado: false` y lo dice;
- `desconectar-deshabilitado.test.ts` con el bloque de Integraciones invertido;
- tests de la guarda de la página, del filtro del sidebar y de `guardarModelo`;
- `scripts/recuento-base.mjs` con la sección por canal, `--desde` y `audit_log` por acción.

Los tests nuevos se vieron en rojo: los del diálogo y la comparación porque no existían, y los del `update` contra la acción anterior. El control positivo del `update` estaba en verde antes y después. Los tres de respaldo se escribieron sobre código que ya existía, así que se vieron en rojo con una rotura a propósito cada uno, deshecha después. Subido con `scripts/verificar-despliegue.mjs`, salida 0: a las 11:38:39 leyó el build `i16KueAsycWzB5BBp8gm3`, y a los 257 segundos (11:42:59) pasó a `mnw795ja8Jtj8Kw6VpA-0`, con `/login` en 200.

**La prueba en producción, con Marcos, en «Ale Admin's Workspace».** Recuentos de solo lectura con `scripts/recuento-base.mjs --desde 2026-10-08T11:43:04-06:00`:

| Paso | Hora | @alomercadeo (`8f30b551…`) | @poderosascomunidad (`e6ad79a8…`) | Historial de cambios del espacio |
|---|---|---|---|---|
| a | 11:43:04 | activo, `platform_account_id` nulo, 267 conversaciones, 260 contactos | no existía | 0 filas |
| b | 12:23:47 | mismo canal, activo, `platform_account_id` `28670425919307767`, 274 conversaciones, 267 contactos | activo, `platform_account_id` `28629645920061122`, 1 conversación, 1 contacto | «canal conectado» 12:20:47 |
| d | 12:28:14 | sin cambios desde b | INACTIVO, 2 conversaciones, 2 contactos | «canal desconectado» 12:27:50 |
| e | 12:46:21 | sin cambios desde b | activo, el mismo canal, 2 conversaciones, 2 contactos | ver abajo |

- **En b, la primera sincronización real con la regla de identidad de F26 sobre la cuenta del negocio:** el mismo canal, activo, con `platform_account_id` completado. Ninguna cuenta quedó excedida, y Zernio mostró «2 cuentas». Cuántas cuentas admite el plan no quedó registrado en la sesión; la conexión aceptó la segunda.
- **Las 7 conversaciones y 7 contactos que sumó @alomercadeo entre a y b** se crearon entre las 12:20:50 y las 12:21:13, segundos después de conectar: los trajo la importación de historial de la sincronización. **6 de esos contactos se llaman «Instagram User»**, sin handle. Ese nombre lo manda Zernio: no aparece en el código, que sin nombre usa el id del remitente (`lib/inbox-sync.ts:309`). Antes del 08/10 no había ninguno. Marcos los lee como leads que hicieron clic en la pauta y solo recibieron la respuesta automática de ManyChat. Es inferencia: el webhook descarta los mensajes salientes (`app/api/webhooks/late/route.ts:167`), así que esas conversaciones solo entran al importar. Si la persona escribe después, se reusa el mismo contacto y se le completa el handle, pero el nombre no cambia hasta el relleno de F27. Si el webhook también recibe «Instagram User» de un lead nuevo no está verificado.
- **Entre b y d, a las 12:25:28, Marcos escribió desde @marcospittimusic** («contacto creado», que ese camino sí audita). Prueba que la cuenta recibía en vivo.
- **En d:** con «poderosascomunida» el botón quedó deshabilitado; con el nombre completo desconectó (capturas de Marcos). Después, en Integraciones: «1 cuenta en Zernio», y el webhook igual (12:31), registrado, activo y con los tres eventos. **Que borrar una cuenta no toca el webhook queda verificado.** En la bandeja de producción, la conversación de @poderosascomunidad seguía en la lista y **al abrirla mostró un hilo vacío, sin aviso**, como anticipaba la lectura del código: el hilo se le pide a Zernio con una cuenta que ya no existe, la ruta responde 500, y la bandeja lo pinta como cero mensajes (`app/api/v1/messages/route.ts:93-98`, `inbox-view.tsx:88-98`). **Si se desconectara @alomercadeo antes de F27, sus 274 conversaciones se verían así.** No se cambió nada por esto.
- **En e, el orden real fue otro, porque las instrucciones no fueron claras:** «activado a mano» 12:41:47, «desconectado a mano» 12:42:31, «Connect Channel» y «activado a mano» 12:45:25. Marcos apretó «Activar» antes de reconectar. Que el segundo «desconectar» haya encontrado la cuenta ya borrada en Zernio, y la acción lo haya tomado como desconectada, es inferencia. Después de reconectar no hubo ningún «canal conectado» de la sincronización y no se creó una fila nueva. A las 12:47, Integraciones decía «2 cuentas en Zernio». Inferencia: Zernio le devolvió el mismo identificador. «Prueba 2» de Marcos entró después, así que la cuenta recibe.

**El control positivo del tiempo real (paso 4f), en «Pruebas de correo».** Integraciones abierta en dos pestañas. Una clave de OpenAI inventada, guardada en la B, pasó la A a «Sin verificar» sin recargar. Al recargar la B, OpenAI la rechazó y la A pasó sola a «Desconectado», con «El proveedor rechazó la clave (HTTP 401)», a las 12:54. Marcos borró la clave y volvió a «Ale Admin's Workspace». Quedaron dos filas en el historial de «Pruebas de correo», como estaba previsto.

**HUMAN_AGENT: Meta lo rechaza, porque la aplicación de Zernio no tiene aprobada la función.** El detalle y lo que queda están en §15 del plano. Se hizo de 12:55 a 13:07, dentro del tope de 20 minutos, en el servidor local contra producción, con un cambio temporal que se deshizo con `git checkout`. El control sin etiqueta llegó; con la etiqueta, dos 403 `platform_api_error` con el mensaje de Meta que pide revisión de la función. La tarjeta de Zernio del espacio real no se tocó: seguía «conectado», sin error.

**Un defecto de F31 encontrado en la prueba, sin arreglar: la importación no deja «contacto creado» en el historial.** Verificado en el código.
- La sincronización le pasa a la importación el cliente del usuario (`app/api/v1/channels/sync/route.ts:283-287`).
- La importación registra la auditoría con ese cliente (`lib/inbox-sync.ts:150-158`), y la 00028 le quita a los usuarios el permiso de insertar en `audit_log` (línea 123).
- El rechazo solo va al log (`lib/auditoria.ts:112-113`).

Los 7 contactos importados el 08/10 no tienen su fila. El del webhook sí la tiene, porque ese camino usa el cliente de servicio. **F31 se dio por completa el 07/10 con este camino roto.** Se arregló el mismo día, en un tramo aparte (abajo).

**Tests:** `npm test` da 530 de 530 al subir `43f8de6`, con cero errores de tipos y el linter sin avisos en lo tocado.

**Hora de fin: 08/10/2026 13:09, hora de Costa Rica**, leída al commitear. Un solo tramo, de 11:16 a 13:09.

**Para la apertura de la próxima sesión:** anotar acá el hash del commit que cierra este registro, la salida de su corrida de `scripts/verificar-despliegue.mjs` y lo que Marcos vea en el historial de despliegues de Railway.
- **Completado en la apertura de la sesión 2 del Bloque 3 (08/10/2026, 14:20).** Ese día hubo tres commits, cada uno subido con su propia corrida del script. Hashes y horas verificados con `git log` (hora de Costa Rica). Las salidas de `ee9ef12` y `8e21367` **salen de la memoria que dejó la sesión del 08/10, no del repo**, y coinciden con las que anotó Marcos en el pedido de la sesión 2:
  - `43f8de6`, el código de F24: ya anotado arriba (salida 0, 257 segundos).
  - `ee9ef12` (13:09:30), el que cierra este registro. Push `43f8de6..ee9ef12`, salida 0, capturada directo: a las 13:09:33 leyó el build `mnw795ja8Jtj8Kw6VpA-0`, y a los 147 segundos (13:12:02) pasó a `DQ6ElJ9M6A3rTRRHK2Zh2`, con `/login` en 200.
  - `8e21367` (13:26), el retrabajo de F31 (abajo). Push `ee9ef12..8e21367`, salida 0: el build pasó de `DQ6ElJ9M6A3rTRRHK2Zh2` a `ptil6wH_ZFft1Ooi3q8FG` a los 113 segundos (13:26:50 a 13:28:45), con `/login` en 200.
- **Railway, dicho por Marcos, con captura, el 08/10 a las 13:52:** ACTIVE el commit «fix(F31): la importación registra «contacto creado», con quien la disp…», «Deployment successful», subido 25 minutos antes. **El HISTORY no se miró**: no se sabe qué muestra para `43f8de6` y `ee9ef12`.
- **El plan gratuito de Zernio admite dos cuentas**, dicho por Marcos el 08/10/2026. Con @alomercadeo y @poderosascomunidad conectadas, el perfil está en el límite: una tercera cuenta quedaría excedida o sería paga.

### Retrabajo de F31, el mismo 8 de octubre: la importación no registraba «contacto creado»

**Se mide como retrabajo de la sesión 1 del Bloque 3**, que construyó F31: tramo 2 de esa fila en la tabla de medición, de 13:16 a 13:26. La línea de base no cambia.

**Las llamadas a la auditoría, revisadas antes del arreglo.**
- Le pasaban un cliente a `registrarAuditoria` tres llamadores:
  - `lib/inbox-sync.ts:150`, el defecto;
  - `lib/comment-processor.ts:172`, con el cliente de servicio del webhook;
  - `auditarAlerta` en `lib/auditoria.ts:158`, con el de servicio de quien la llama (la sincronización y el receptor de Evolution).
- Las otras 17 llamadas no le pasaban cliente, así que usaban el de servicio que crea la función.
- **El único camino roto era `upsertContactForSender` desde la importación, y entraba por dos rutas:** `sync` (`route.ts:283`) y `test-key` («Probar y guardar», `route.ts:149`). Desde el webhook funcionaba.

**El arreglo, decidido con Marcos:**
- `registrarAuditoria` ya no recibe cliente: escribe siempre con el de servicio que crea ella. Su comentario ya exigía uno de servicio, y el defecto pasó igual; sin el parámetro no se puede repetir.
- La importación recibe un `actor`. `sync` y `test-key` le pasan el usuario de la sesión. El webhook no pasa ninguno y queda «Sistema».
- No se tocó la 00028 ni ninguna política: ningún usuario recupera el permiso de insertar en `audit_log`.

**Tests, vistos en rojo antes del arreglo:**
- `lib/inbox-sync-auditoria.test.ts`, con la `registrarAuditoria` real: el cliente del usuario rechaza `audit_log` como la base, y la importación no dejaba la fila. El control positivo: con el arreglo la fila queda, escrita con el cliente de servicio y con el usuario como actor, no «Sistema».
- Los tests de las rutas `sync` y `test-key`: que le pasen el actor a la importación.
- En `lib/auditoria.test.ts`, que `auditarAlerta` escriba con el de servicio y no con el cliente con que lee la alerta. Se vio en rojo poniendo un momento la versión anterior del módulo.
- Los tres tests que pasaban un cliente (`lib/auditoria.test.ts`, `lib/contacto-proveedor.test.ts` y `lib/comment-processor-auditoria.test.ts`) pasaron a simular `createServiceClient`.

**Los 7 contactos importados el 08/10/2026, entre las 12:20:49 y las 12:21:13, en «Ale Admin's Workspace», no se completan:** quedan sin su fila de «contacto creado», a propósito. `audit_log` no se puede borrar, así que cualquier relleno lo decide Marcos.

**Sin prueba real todavía:** no se apretó Sincronizar ni se conectó nada. La prueba real es la próxima sincronización o «Probar y guardar» que importe un contacto nuevo. Se anota acá cuando ocurra, con el autor que quede en el historial.

**El rastro visible de un rechazo de la auditoría** quedó en §15 del plano como propuesta no decidida.

**El avance sigue en 9 de 26 si este arreglo se sube hoy.** Si no se sube, se corrige a 8 hasta que se suba.

**Tests:** `npm test` da 535 de 535, con cero errores de tipos, y el linter no marca nada en lo tocado.

---

## Sesión del 8 de octubre de 2026, tarde: Bloque 3, sesión 2 (F27, F28 y F39)

**En curso.** Apertura a las 14:20 de Costa Rica, con `node scripts/commits-sin-subir.mjs` en «Sin commits sin subir» y el último commit `8e21367`. El registro completo se escribe al cerrar el tramo; acá va lo que no puede esperar.

**Fin del tramo 1: 08/10/2026 17:48**, leída al commitear el cierre. El tramo cierra F27; F39 y F28 van en el tramo 2. Suma: 191 min (3 h 11 min), sin contar el hueco de 16:15 a 16:32. **Corregido al abrir el tramo 2:** el tramo 2 lleva los pendientes cortos de F27, F25 y F39 y, si da el tiempo, la migración 00033 y el cálculo de horas hábiles; el resto de F39 va en el tramo 3 y F28 en el tramo 4.

**Corte por cierre forzado.** La sesión de Claude Code se cerró a la fuerza hacia las 16:15 (hora aproximada, dicha por Marcos) y se retomó a las 16:32, con `commits-sin-subir.mjs` en «Sin commits sin subir» y el último commit `b4470a3`. La medición sigue en el tramo 1, desde las 14:20; el hueco de 16:15 a 16:32 queda anotado para cuando se sume el tramo.

**Dos filas de producción modificadas a propósito para el control 0 de F25. Usadas y revertidas a las 17:42:18** (ver abajo; el título decía «todavía sin usar», escrito antes del control y corregido al abrir el tramo 2). En «Ale Admin's Workspace», con la clave de servicio y la aprobación de Marcos:
- el contacto de @marcospittimusic (`f2747f9b…`): `display_name` «Marcos, nombre manual de prueba» y `display_name_source` `manual`;
- su `contact_channels` (`e41a7a38…`): `profile_status` `pending` y `profile_attempts` 0.

Valores originales, a los que se vuelve al terminar el control (mostrándole antes a Marcos qué se escribe): «Marcos Pitti music», `provider`, `complete` y 0. El handle (`platform_username`) no se tocó. Esas escrituras no dejan «contacto editado» en el historial, porque no pasan por el código que audita.

**Veredicto del control 0 de F25: vale.** Regla acordada: vale si `profile_status` pasa a `complete` (o sube `profile_attempts`) y `display_name` sigue siendo el manual; si no se mueve ninguno, es no concluyente.
- Marcos escribió «Test 5:12» desde @marcospittimusic a @poderosascomunidad a las 17:12:15 (hora del proveedor). A las 17:12:51 la fila tenía `profile_status` `complete` y `profile_attempts` 0: Zernio trajo el perfil en el primer intento.
- `display_name` seguía siendo «Marcos, nombre manual de prueba», con `display_name_source` `manual`.
- Releído a las 17:42:03, igual.

Corrieron los dos caminos: el receptor, que guardó el mensaje, y el relleno, que leyó el perfil y no tocó el nombre. El handle no prueba nada acá, porque el receptor lo escribe con cada mensaje.

**Las dos filas, vueltas a sus valores originales a las 17:42:18**, con la aprobación de Marcos: «Marcos Pitti music», `provider`, `complete` y 0. Releídas después, iguales a esas; el handle sigue en `marcospittimusic`, sin tocar.

**Los despliegues del tramo 1**, los dos con `node scripts/verificar-despliegue.mjs` y salida capturada directo. Hora de Costa Rica:
- **A, `b4470a3`** (los receptores guardan; la bandeja todavía lee de Zernio). Push `8e21367..b4470a3`, salida 0: a las 15:22:07 leyó el build `ptil6wH_ZFft1Ooi3q8FG`, y a los 93 segundos (15:23:42) pasó a `xfQWezJuXDXwQiMszWWmc`, con `/login` en 200.
- **B, `fcca3be`** (la bandeja lee de la base). Push `b4470a3..fcca3be`, salida 0: a las 16:53:02 leyó el build `xfQWezJuXDXwQiMszWWmc`, y a las 16:54:57, unos 115 segundos después, pasó a `HbTjJT0eMqBkKo-ZIMIlL`, con `/login` en 200.
- **C, `02cdbc1`** (cierre del tramo 1, docs). Salida 0: el build pasó de `HbTjJT0eMqBkKo-ZIMIlL` a `OM87L_1AFbkaUhg4O6D2k`, de 17:48:14 a 17:49:50, con `/login` en 200.
- **D, `8192c8e`** (los criterios tildados, docs). Salida 0: el build pasó de `OM87L_1AFbkaUhg4O6D2k` a `jBAmISwOjEmFwPoRN2WnR`, de 17:54:51 a 17:56:26, con `/login` en 200.
- C y D no podían figurar en sí mismos: se anotaron al abrir el tramo 2, con las salidas que capturó la sesión anterior.
- **E, `4b93823`** (cierre del tramo 2, docs). Salida 0: el build pasó de `jBAmISwOjEmFwPoRN2WnR` a `Wb3RUjlMRDe0nzMggZdAp`, de 19:49:23 a 19:51:40, con `/login` en 200 y sin importación corriendo. No podía figurar en sí mismo: se anotó al abrir el tramo 3, con la salida que capturó la sesión anterior.
- **Railway, mirado por Marcos el 09/10/2026 a las 12:02.** ACTIVE: «docs: cierre del tramo 2 de la sesión 2 del Bloque 3 (F27, F25 y F39) ...», hace 16 horas, vía GitHub, en «Deployment successful». En HISTORY, debajo: REMOVED «docs: tildar los criterios cumplidos de F27, F25 y F26 al cerrar el tram...», hace 18 horas. La pantalla de Deployments no muestra hashes: los dos se **identificaron por título** contra `git log` (`4b93823` y `8192c8e`), no por un hash visto en Railway.
- Railway no lo miró nadie durante el tramo: el script no dice qué commit quedó activo. **Después, dicho por Marcos con captura el 08/10 a las 18:09:** la tarjeta ACTIVE es «docs: tildar los criterios cumplidos de F27, F25 y F26 al cerrar el tram…» (`8192c8e`), en «Deployment successful», subida 13 minutos antes. **El HISTORY no se miró:** no se sabe si alguno de `b4470a3`, `fcca3be` o `02cdbc1` falló en Railway; el script solo dice que el build servido cambió cada vez.

**`scripts/verify-guardado-whatsapp.mjs` contra el receptor de producción**, en un espacio fantasma, con un canal descartable y un secreto generado por el propio script:
- **15:02, código viejo, antes de la 00032: falló, salida 1.** 4 pasaron (el acuse 200 dos veces, el borrado del secreto y la limpieza), 5 fallaron (nada se guardó) y 3 no concluyentes.
- **15:16, código viejo, con la 00032 aplicada: falló igual, salida 1.** Mismos números.
- **15:35, después del despliegue A: 24 de 25, salida 1.** Pasó todo el guardado y falló la limpieza: el espacio fantasma no se pudo borrar, por la NO ACTION de la 00025 (`contact_channels` hacia `channels`). Se borraron a mano los datos de prueba (los contactos primero, después el espacio) y se corrigió la limpieza del script.
- **~15:37, con la limpieza corregida: 26 de 26, salida 0.** Quedaron los 2 espacios reales.

**Desde el despliegue B y hasta F28, la bandeja muestra los adjuntos como «Adjunto», sin la imagen.** Son los 478 mensajes con adjunto que trajo la importación del 08/10/2026 y los que lleguen después: quedan con `media_status = 'pendiente'`, y la dirección del proveedor no llega al navegador. Hoy no le afecta a nadie, porque el negocio todavía no trabaja desde la bandeja (nota del 22/09/2026 en F27, sobre el techo de 200). Lo resuelve F28.

**`last_message_at` corregido en 55 conversaciones, el 08/10/2026, con la aprobación de Marcos.** Tenían una fecha más vieja que su mensaje más nuevo guardado, porque hasta `b4470a3` el receptor de Zernio solo movía la fecha con un entrante (`app/api/webhooks/late/route.ts:167`, `:190` y `:290-291` de `8e21367`), y la importación no tocaba las conversaciones que ya existían (`lib/inbox-sync.ts:360-364`). De las 55, en 54 lo posterior eran solo salientes; la restante es `a1ab8f5d` (§15 del plano).
- La corrección puso `last_message_at` en la hora del proveedor del mensaje más nuevo y recalculó `last_message_preview` con el mismo recorte que `messagePreview` (100 caracteres), adentro de la base y sin imprimir contenido. Solo adelantó fechas.
- **Primero se corrigieron 52 (16:50) y después 3 (16:52).** La primera lista se armó con una tolerancia de 1 minuto, y dejó afuera 3 con diferencias de 0,05, 1,2 y 55 segundos, de la misma causa. El total corregido es 55 (52 + 3).
- Recuento después, sin tolerancia: cero conversaciones con un mensaje más nuevo que su `last_message_at`. La de 253 mensajes (`868585de`) pasó del puesto 106 al 9 de la lista de la bandeja.
- **El código que faltaba:** desde el despliegue B, la importación adelanta `last_message_at` y `last_message_preview` cuando guarda un mensaje más nuevo que la fecha de la conversación, sin tolerancia, y nunca la atrasa (`lib/importacion-historial.ts`). Su test se vio en rojo antes del arreglo; el de «nunca atrasa», con una rotura a propósito.

**`last_message_at` mezcla dos horas, y no se arregla hoy.** El receptor y la bandeja escriben la hora de RECEPCIÓN (`new Date()` al procesar el aviso o el envío); la importación y la corrección de arriba, la hora del PROVEEDOR del mensaje. Para ordenar la lista alcanza; para medir tiempos de respuesta, no.

**Pendiente, sin investigar: 304 conversaciones con `last_message_preview` que no coincide con el texto de su mensaje más nuevo.** Contado el 08/10/2026, sin leer contenido, entre las que no tenían la fecha desfasada. No se tocaron. **Inferencia, no verificado:** puede ser una diferencia de formato y no un desfasaje (por ejemplo, el preview que viene del listado de Zernio, como «[Attachment]», frente a un mensaje guardado sin texto).

**El echo de lo escrito desde la app de Instagram, observado el 08/10/2026** (control 2). Se leyó con una llamada de solo lectura a `GET /v1/webhooks/logs?event=message.sent&limit=20`, aprobada por Marcos, desde una ruta temporal del servidor local que no se commiteó; se descartó sin imprimir todo lo que no era de @poderosascomunidad y no se guardó nada en archivos. La entrega del control 2 fue a las 17:15:33, con HTTP 200 y `sentAt` 17:15:28.602, la misma hora del proveedor que quedó guardada. Trae **`sentVia` nulo** y **`sender.username` igual a `account.username`**. El saliente enviado por la API trae `sentVia: "api"`. Coincide con lo que suponía el código (el autor de un echo es la propia cuenta), así que la marca de los tests y de `lib/zernio-aviso.ts` pasó de «no observado» a «observado el 08/10». `sentVia` es lo único que distingue «escrito desde la app» de «enviado por el sistema», y hoy no se guarda: lo va a necesitar la línea «Enviado desde la app de Instagram» de la bandeja (§11, Bloque 4).

**Pendiente de la pantalla de la bandeja (F35): el separador de fecha dice «Today» sobre mensajes de ayer.** `formatDateSeparator` (`components/inbox/message-thread.tsx:22-29`, del fork) llama «Today» a todo lo de las últimas 24 horas y «Yesterday» a lo de entre 24 y 48, no al día del calendario. Lo vio Marcos el 08/10/2026 en un mensaje del 07/10 a las 19:27. No se tocó.

**Criterios tildados al cerrar el tramo 1, decididos por Marcos el 08/10/2026**, cada uno registrado como reescrito en `docs/criterios-bajas.json` con su prueba (foto: 324 líneas):
- **F27:** 13 de 14, todos salvo el #6 (tipos soportados).
- **F25:** «nombre manual» y «origen de click-to-WhatsApp».
- **F26:** identificador crudo y modo, identificador de cada mensaje, contacto sin teléfono con marca, y el contador.
- **Sin tildar:** en F25, `last_click`. En F26, las tres vías de reconciliación, la propuesta de fusión, la fusión con notas (F30) y la identidad del canal.
- **El avance no cambia:** sigue en 9 de 26. F27 cierra con el #6 en el tramo 2; F25 y F26 siguen sin completar.

**Pendientes para el tramo 2, además de F39 y F28** (atendidos en el tramo 2, ver «Tramo 2» abajo; la lista queda como estaba):
- **F27 #6, tipos soportados:**
  - un aviso firmado por cada tipo en `scripts/verify-guardado-whatsapp.mjs`: texto, imagen, audio, documento, video, sticker, ubicación y respuesta;
  - un recuento sin contenido de los 478 adjuntos importados de Instagram, por `message_type`.
- **F25, el segundo toque de `last_click`:** dos avisos firmados con `externalAdReply` sobre el mismo contacto. El segundo tiene que actualizar `last_click` sin tocar `first_click`.
- **F25, la atribución del anuncio de Meta en Instagram:** verificar en los tipos de `@zernio/node`, con archivo y línea, si `message.received` o `getInboxConversation` la traen, y proponer si se construye. Hoy ningún camino de Instagram escribe un toque.
- El origen de los 7 contactos sin `contact_channels` (276 contra 269 antes de la importación; ya estaban el 07/10), contado sin leer contenido.
- La verificación de las tareas programadas en Railway, antes de F39.

**Pendiente de F35 (S7): cargar los mensajes anteriores de una conversación. Desde el 19/10/2026 es un criterio de F35:** «El hilo de una conversación deja cargar los mensajes anteriores a los últimos 200, hasta el primero guardado». Desde el despliegue B, `GET` de `app/api/v1/messages/route.ts` trae los últimos `MENSAJES_POR_HILO` (200) mensajes de la base y devuelve `hayAnteriores`; el hilo (`components/inbox/message-thread.tsx`, `MessageThread`) muestra «Hay mensajes anteriores que no se muestran acá» y no tiene forma de traerlos. Es lo mismo que hacía la ruta anterior con Zernio (la última página, con aviso), así que no deja de verse nada que antes se viera. Al 08/10/2026 hay al menos una conversación de @alomercadeo con 253 mensajes: los 53 más viejos están en la base y no se ven desde la bandeja.


### Tramo 2: pendientes cortos de F27, F25 y F39

**Apertura: 08/10/2026 18:25:25 de Costa Rica**, leída con `TZ=America/Costa_Rica date`. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `8192c8e`. Se completó el registro de `02cdbc1` y `8192c8e` (despliegues C y D, arriba).

**Corte por cierre de la app.** La app se cerró mientras se esperaba una respuesta de Marcos. El último registro de la sesión es de las 18:43:16; se retomó a las 19:13:33, con `commits-sin-subir.mjs` en «Sin commits sin subir», el último commit `8192c8e` y los cambios del tramo intactos en el árbol de trabajo. La hora exacta del cierre no se sabe: el hueco, de 18:43 a 19:13 como máximo, no se cuenta.

**F27 #6, los tipos, en WhatsApp: con aviso firmado.** `scripts/verify-guardado-whatsapp.mjs` suma el paso 10: un aviso firmado por cada tipo (texto, imagen, audio, documento, video, sticker, ubicación y respuesta). Cada comprobación lee `message_type` de la fila con el `platform_message_id` de ESE aviso; los cinco con adjunto, además, que `attachments[0].type` sea el tipo original; la respuesta, que `quoted_message_id` sea igual al `stanzaId`. Corrida contra el receptor de producción, de 18:37:03 a 18:37:33: **43 de 43, salida 0**; antes y después, 2 espacios y 3 canales.
- **De dónde sale la forma.** La envoltura, de `prepareMessage` en `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` de Evolution 2.3.7 (huella `60e857fcc1206776575921c9060d05efdd7ff432`, comprobada con `git ls-tree` sobre un clon de la etiqueta, fuera del repo): `messageType` de `getContentType` (4653, 4666), `contextInfo` en la raíz (4665), y un `extendedTextMessage` llega como `conversation` (4678-4682), que es como llega una respuesta. La forma interna, del proto de Baileys: el `package.json` de Evolution 2.3.7 fija `"baileys": "7.0.0-rc.9"` (línea 80); la etiqueta `v7.0.0-rc.9` de WhiskeySockets/Baileys existe con ese nombre (`git ls-remote`), y su `package.json` dice `"name": "baileys"`, `"version": "7.0.0-rc.9"`. En `WAProto/WAProto.proto`: `Message` 2066 (campos en 2067-2088), `ImageMessage` 2631, `AudioMessage` 2202 (`ptt` 2208), `VideoMessage` 3608, `DocumentMessage` 2387 (`fileName` 2395), `StickerMessage` 3481, `LocationMessage` 2897, `ContextInfo` 1264 (`stanzaId` 1265, `quotedMessage` 1267, `externalAdReply` 1280) y `ExternalAdReplyInfo` 1355 (`sourceType` 1362, `sourceId` 1363, `sourceUrl` 1364, `ctwaClid` 1368).
- **La llegada real se comprueba en la puesta en marcha del número.**
- No se vio fallar antes: el mapa de tipos ya existía y no se tocó. Lo que la distingue de un verde vacío: cada tipo espera un valor distinto, y lo que el mapa no conoce cae en `otro` (`lib/evolution-guardado.ts:127`).

**F27 #6 en Instagram: no se cumple.** Recuento sin contenido, con segunda fuente: los mensajes de Instagram con `media_status` no nulo son 478, igual que los que tienen `attachments` (ninguno con uno solo de los dos), y por `message_type` son 452 `otro`, 22 video, 3 imagen y 1 audio (suman 478). Todos los de Instagram: 3096 texto, 452 otro, 22 video, 3 imagen, 1 audio (3574). Los 452 `otro`, por el tipo que manda Zernio en el adjunto: `template` 410 (391 salientes, 19 entrantes), `share` 41 (14 y 27) y `ephemeral` 1 (entrante). `tipoPorAdjuntos` (`lib/mensajes-guardado.ts:57-67`) no conoce esos tres. Ninguno de los 3574 tiene `quoted_message_id`. Recontado a las 19:24:54, por tipo crudo y `direction`: `ephemeral` 1 entrante; `share` 27 entrantes y 14 salientes; `template` 19 entrantes y 391 salientes (452). **Sin tildar, decidido por Marcos el 08/10/2026, y el motivo es este:** no se sabe qué son `template`, `share` y `ephemeral`, ni si la respuesta a otro mensaje existe en Instagram. Que Instagram no produzca documento, sticker o ubicación no es un hueco y no impide tildar.

**F25, el segundo toque de `last_click`, en WhatsApp: con aviso firmado, y NO se propone para tildar (decidido por Marcos el 08/10).** Paso 8 del script: dos avisos con `externalAdReply` de anuncios distintos (`sourceId` y `ctwaClid` distintos) sobre el mismo contacto; `last_click` quedó con los del segundo y `first_click` con los del primero. El criterio no nombra canal, y el canal por donde hoy entran los leads de anuncios es Instagram, donde ningún camino escribe un toque. Queda sin tildar hasta construir lo de abajo.

**Los 7 contactos sin `contact_channels`, contados sin leer contenido.** 568 contactos: 561 con canal y 7 sin. Los 7 son de «Ale Admin's Workspace», con `display_name_source` `provider`, sin teléfono ni correo, sin etiquetas y sin acciones en `audit_log`; cada uno tiene una sola conversación, del canal de @alomercadeo, creada medio segundo después del contacto (el camino del receptor), con 2 a 5 mensajes y la historia completa. Se crearon entre el 25/09 y el 06/10, uno o dos por día, en días en que la mayoría de los contactos nuevos sí tiene canal (por ejemplo, el 25/09: 6 de 7). **Por qué el receptor no les escribió el canal no se investigó.** No se tocaron.

**F39, la marca del último entrante: con datos reales.** El código: `app/api/webhooks/late/route.ts:354-356` (Instagram, solo si no es saliente) y `lib/evolution-guardado.ts:305` y `:308-310` (WhatsApp, solo entrantes que no son historial). Lecturas de solo lectura de `channels.last_inbound_at` de @poderosascomunidad (`e6ad79a8`), en «Ale Admin's Workspace»: **antes, a las 18:35:51 y otra vez a las 18:40:34, 17:12:18.599** (el «Test 5:12» del tramo 1). Marcos mandó «Test F39» desde @marcospittimusic a las 18:42 (hora dicha por él). **Después, a las 18:43:16: 18:43:00.435**, con 1 entrante del canal en los 15 minutos anteriores. Es la hora de recepción (`new Date()` del receptor), no la del proveedor. WhatsApp, con aviso firmado: el paso 1 del script («el canal registró su último entrante»).

**Las tareas programadas: verificado en el código.** El resultado, con archivo y fecha, quedó en §15 del plano, en lugar de la inferencia. `scheduled_jobs`, `sequence_enrollments`, `sequences` y `broadcasts`: 0 filas en los 2 espacios.

**Criterios tildados al cerrar el tramo 2, decididos por Marcos el 08/10/2026**, registrados como reescritos en `docs/criterios-bajas.json` con su prueba (foto: 324 líneas):
- **F39:** «Cada canal guarda la marca de tiempo del último evento entrante recibido, actualizada por el receptor». Antes de registrarlo, a pedido de Marcos: entre 18:41:00 y 18:43:30 hubo un solo entrante en @poderosascomunidad, `aab45b41`, en la conversación `c6628c4e` con @marcospittimusic (18:42:57.503, hora del proveedor). El «Estado» de F39 pasa a «no completa», 1 de 8.
- **Sin tildar:** F27 #6 (Instagram) y F25 `last_click` (Instagram no escribe toques). **El avance sigue en 9 de 26.**
- **El ítem 2 (migración 00033 y horas hábiles) no arrancó:** no se tocó ningún archivo de él. Va al tramo 3. **No se aplicó ninguna migración en este tramo.**

**Fin del tramo 2: 08/10/2026 19:48:56**, leída al commitear el cierre. Suma: 53 min, de 18:25:25 a 19:48:56, menos el corte de 18:43:16 a 19:13:33.

**Pendientes para el tramo 3**, cada uno verificado en el código el 08/10/2026 contra `8192c8e`:
- **`leerWebhook`** (`lib/integraciones-estado.ts:222`) no está exportada, y su `catch` (`:227-229`) descarta el error y devuelve un texto fijo (`:228`). Para «No se pudo leer la suscripción: …» con el error real hay que cambiarla.
- **`record_webhook_alert`** (00023) devuelve el id de la condición abierta, sea nueva o la que ya estaba (`:153-156`, a propósito), y corta el `detail` a 200 caracteres (`:134`). «`notificarAlerta` solo cuando se abre» necesita saber si había una abierta antes.
- **`contenidoDeAlerta`** (`lib/correo.ts:330-361`) no tiene caso para el silencio ni para la suscripción: hoy saldría el texto genérico del `default` (`:357`). `WebhookAlertCondition` (`lib/types/database.ts:20-24`) tampoco tiene esas condiciones.
- **`lib/tareas-estado.ts`** ya tiene `marcaVisible` y `marcaVencida` (`MINUTOS_PARA_VENCER = 30`, sobre `ultimo_ok_at`).
- **@poderosascomunidad pasa a sin vigilar** en el tramo 3, con su umbral en nulo. No va en una migración: una migración no escribe la fila de un canal concreto.
- **F27 #6 en Instagram.** Verificar en los tipos de `@zernio/node` (archivo y línea, sin leer datos) qué son `template`, `share` y `ephemeral`, y si Instagram trae el mensaje citado (la respuesta). Los tipos que Instagram no produce (documento, sticker, ubicación) no son un hueco. **Si `share` o `template` son mensajes del lead (hay 27 y 19 entrantes), hoy su contenido no se ve en la bandeja.**
- **El diseño de las tareas programadas, aprobado el 08/10/2026, sin construir.** Un servicio de Railway, «vigilancia-cron», desde la imagen `curlimages/curl` con versión fija y Cron Schedule cada 10 minutos (Railway lo interpreta en UTC, con un mínimo de 5 minutos). Su comando, con `sh -c`, hace un POST con `--fail` y `--max-time` a `https://app.alomercadeo.com/api/cron/tareas` con `Authorization: Bearer $CRON_SECRET`, y termina. La ruta nueva acepta el secreto solo en el encabezado, lo compara en tiempo constante y corre la lista de tareas del código. Las rutas del fork (`/api/cron/jobs` y `/api/cron/sequences`) no se tocan ni se llaman.
- **Retrabajo de F25, el toque de Instagram. Se mide como un tramo nuevo de la sesión 1, no de la 2 (decidido por Marcos el 08/10/2026).** Verificado en los tipos de `@zernio/node` 0.2.519 (`node_modules/@zernio/node/dist/index.d.ts`), no con datos reales: `message.received` (`WebhookPayloadMessage`, `:7455`) trae `metadata.referral` (`:7757-7808`), con `ad_id` (`:7776`), `ref` (`:7782`), `source` (`:7788`), `type` (`:7794`) y `ads_context_data` (`:7800-7807`); el comentario de `:7744-7755` dice que viene tal cual lo manda Meta y solo en el primer entrante después del clic. `getInboxConversation` (`:462`; respuesta en `:16593`) trae `metadata.meta_ad_*` (`:16669-16709`), con otros nombres a propósito, y sin campaña ni conjunto de anuncios. El camino: el receptor de Instagram arma el toque con `toqueDe` y lo aplica con `aplicarToque` (`lib/atribucion.ts`), que ya existen. Unos 45 minutos con tests. **Para el fixture hace falta un aviso real con `metadata.referral`; cómo conseguirlo lo decide Marcos otro día.** No se construyó nada.

### Tramo 3: pendiente corto de F27 y el resto de F39

**Apertura: 09/10/2026 12:09:06 de Costa Rica**, leída con `TZ=America/Costa_Rica date`. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `4b93823`. Se completó el registro de `4b93823` (despliegue E, arriba) y lo que Marcos vio en Railway.

**Migración 00033 (`vigilancia_canales`), aplicada el 09/10/2026 a las 12:52:11 con `supabase db push`, salida 0, con la aprobación de Marcos.** Agrega `workspaces.zona_horaria` (por defecto `America/Costa_Rica`), `workspaces.horario_atencion` (por defecto el del prototipo, lunes a viernes de 8:00 a 18:00 y sábado de 9:00 a 12:00, **no confirmado por Alejandra**) y `channels.umbral_silencio_horas` (por defecto 8, nulo = sin vigilar).
- **Antes:** `tareas_estado` sin ninguna fila ocupada, leída a las 12:23:34 y otra vez a las 12:52:04, inmediatamente antes del push. `--dry-run`: solo la 00033. Recuento a las 12:24.
- **Después, diferencias contra el recuento de las 12:24:** migraciones registradas, de 32 (última 00032) a 33 (última 00033); `messages`, de 3595 a 3597 (los 2 en @alomercadeo: salientes de 1947 a 1949, con adjunto de 481 a 483). Las 29 tablas y el resto de las cantidades, iguales.
- **Las 2 filas de más son tráfico real, no efecto de la migración.** La prueba es la hora de creación: `b2a3c7b1` a las 12:30:07 y `4706fc28` a las 12:30:12, 22 minutos antes del push. Son dos salientes de @alomercadeo, con adjunto `share`, no enviados desde la bandeja (leídos sin contenido). Además, la 00033 no inserta filas.
- **Releído después, sin contenido:** los 3 canales (`8f30b551` @alomercadeo, `e6ad79a8` @poderosascomunidad, `f81fd726` alomercadeo-ventas) con `umbral_silencio_horas` 8; los 2 espacios (`e8f4f678` «Ale Admin's Workspace», `1a3db984` «Pruebas de correo») con `America/Costa_Rica` y el horario por defecto.

**F27, el mensaje citado de Instagram (retrabajo de F27, medido en este tramo).** Verificado en los tipos de `@zernio/node` 0.2.519, no con un aviso real: el aviso trae `metadata.quotedMessageId`, «Instagram and Facebook Messenger (`reply_to.mid`)» (`dist/index.d.ts:7587-7595`), y el listado de mensajes, `metadata.quotedMessageId` (`:16877-16884`). Hasta `8fa052d` el receptor y la importación lo descartaban (`quotedMessageId: null`), y el comentario de `lib/zernio-aviso.ts` decía que no venía. Ahora lo leen los dos (`lib/zernio-aviso.ts`, `lib/zernio-message-map.ts`), con tests vistos en rojo antes del arreglo. Las filas viejas no cambian: la importación no reescribe mensajes ya guardados. **F27 #5 conserva la tilde solo si la prueba con un mensaje real citado pasa en este tramo** (decidido por Marcos); la cita va después de la prueba de «receptor detenido», porque mueve el `last_inbound_at` de @poderosascomunidad.

**Los «otro» de Instagram, contados el 09/10 sin contenido:** entrantes `share` 30, `template` 19 y `ephemeral` 1; salientes `share` 14 y `template` 392. Ninguno de los 50 entrantes tiene texto; los 30 `share` tienen enlace y los otros no. En la bandeja se ven como «Adjunto» y nada más. `template` y `ephemeral` no aparecen en ningún tipo del SDK, y `share` aparece sin explicación (`:16810`): qué son no se puede verificar con los tipos. **La respuesta a una historia** (`metadata.storyReply`, `:7723-7736`): hoy se guarda el texto y no el contexto de la historia, ni en el receptor ni en la importación (verificado en el código).

**F39, parte A: desplegada.** Commit `8fa052d`, push `4b93823..8fa052d`. `node scripts/verificar-despliegue.mjs`, salida 0: el build pasó de `Wb3RUjlMRDe0nzMggZdAp` a `Pr-_9VDGnc_2PTLh3WOQO`, de 13:06:28 a 13:09:26, con `/login` en 200 y sin importación corriendo (leído a las 13:06:13). Antes: suite 662 de 662, `typecheck` en cero, `npm run build` bien. **Railway, mirado por Marcos el 09/10:** ACTIVE «feat(F39, F27): vigilancia de canales y el mensaje citado de Instagra…», «Deployment successful», identificado por título. Desde afuera, `POST /api/cron/tareas` sin encabezado y con `?key=x` dio 401.
- **Lo que entró:** horas hábiles con la zona IANA (`lib/horas-habiles.ts`; los dos tests de Nueva York se vieron fallar contra un desfase fijo puesto a propósito); la revisión de silencio (`lib/vigilancia-canales.ts`, condición `canal_silencioso`, fuente `vigilancia`, correo solo con `occurrences = 1`, sin tocar la 00023); la suscripción (`lib/vigilancia-suscripcion.ts`, condición `suscripcion_incompleta`, fuente `zernio`; `leerWebhook` exportada y con el motivo real del fallo); la ruta `POST /api/cron/tareas` (`Authorization: Bearer` en tiempo constante; sin `CRON_SECRET`, 401); la marca por espacio en `tareas_estado` (`vigilancia_canales:<espacio>`; `ultimo_ok_at` solo si la revisión de silencio terminó bien; el test de «una corrida que falla no mueve la marca» se vio fallar contra una rotura a propósito); zona y horario en General, con el botón «Guardar»; la pestaña «Vigilancia de canales»; y los textos de las dos condiciones en el correo y en el aviso de Canales, que si no caían en el texto de `webhook_auth_failed`.
- **@poderosascomunidad, sin vigilar:** Marcos borró el límite desde la pestaña nueva. Releído a las 13:16:08: `umbral_silencio_horas` de 8 a nulo (`e6ad79a8`); el historial lo registró a las 13:15:24 como «Vigilancia de canales: Instagram @poderosascomunidad», antes 8, después nulo.

**F39, parte B.** El servicio «vigilancia-cron» de Railway lo creó Marcos: imagen `curlimages/curl:8.22.0` (publicada el 02/09/2026), Cron Schedule `*/10 * * * *`, `CRON_SECRET` por referencia a la de SSA-Business-AI-OS (que ya existía; no se sabe quién la creó ni si es larga y aleatoria) y este comando de inicio:
`/bin/sh -c "curl --fail --silent --show-error --max-time 60 -X POST --oauth2-bearer $CRON_SECRET https://app.alomercadeo.com/api/cron/tareas"`.
- Verificado en la documentación de Railway: el horario en UTC, el mínimo de 5 minutos, que se saltea una corrida si la anterior sigue, y que el comando de inicio corre en cada corrida. **No verificado:** si una variable sellada se puede referenciar desde otro servicio (la documentación no lo dice), así que «Seal» va al final; y si el comando propio reemplaza el ENTRYPOINT, el CMD o los dos (funciona igual en los dos casos).
- Verificado en el repositorio de la imagen (rama `main`, no la etiqueta): `alpine:3.24.1`, `ENTRYPOINT ["/entrypoint.sh"]`, un script `#!/bin/sh` que ejecuta el comando recibido. `--oauth2-bearer` manda `Authorization: Bearer <valor>`: probado en esta Mac contra un servidor local, con curl 8.7.1.
- Al crearlo, la app no se redesplegó: siguió sirviendo `Pr-_9VDGnc_2PTLh3WOQO`, leído a las 13:26.
- **Primera corrida: 13:31**, sin error en los dos espacios. En «Ale Admin's Workspace» leyó la suscripción real: registrada, activa, con `message.received`, `comment.received` y `message.sent`, sin faltantes. Marcos lo vio en la pestaña: «Avisos de Instagram suscritos: completos» y «Leídos: message.received, comment.received, message.sent · el 9/10/26, 1:40 p. m.», con «Última revisión: hace 3 min» sin rojo. Las corridas llegan entre 1 y 1,5 minutos después de la hora programada.

**La prueba de «receptor detenido», con datos reales, en @poderosascomunidad (decidida por Marcos).** No es un receptor detenido: es el silencio real de la cuenta de prueba, que es lo que la revisión ve cuando el receptor se detiene.
- **Control positivo, antes:** la marca del espacio avanzó entre dos corridas seguidas (13:40:45 y 13:51:31). Antes: 0 alertas abiertas y 0 filas en `email_log` del espacio (13:50).
- **14:07:51:** Marcos puso el límite en 1 desde la pestaña. Su último entrante seguía en el 08/10 a las 18:43, con 5,74 horas hábiles.
- **Corrida de las 14:10:** abrió la alerta `16f7896b` (`vigilancia` / `canal_silencioso`) a las 14:10:52, con 1 ocurrencia y el detalle «Instagram @poderosascomunidad: 6,2 de 1 horas hábiles». Escribió una sola fila en `email_log`, `47ff5ecd`, de esa alerta, a las 14:10:53.793, «fallido», con 0 intentos y el motivo «Resend no está configurado: falta la clave en Integraciones.». No salió correo y no se llamó a Resend: el espacio no tiene clave. Un «canal.error» en el historial. Marcos vio el aviso en Canales.
- **Corrida de las 14:20:** 2 ocurrencias y **0 filas nuevas en `email_log`**, ni «pendiente» ni «omitido_techo». Así que no fue el techo de una hora, que habría dejado un «omitido_techo»: fue el control de «solo al abrir». Ningún «canal.error» nuevo.
- **14:23:56:** Marcos volvió el límite a vacío. **Corrida de las 14:30:** la alerta se cerró sola a las 14:30:52. En el espacio, 0 alertas abiertas y `email_log` con 1 fila.
- **Nada reintenta la fila «fallido»:** los reintentos son solo del mismo envío y en el mismo proceso (`lib/correo.ts:273-292`), y sin clave de Resend no hay ni un intento (`:240-246`). Si se carga la clave, esa fila no se manda nunca. Durante una hora cuenta para el techo de F23 (`00027:78-80`).

**F27, la cita real.** A las 14:52, Marcos mandó «Test cita F27» desde @marcospittimusic a @poderosascomunidad, como respuesta a un mensaje. La fila `fe4c6077` (entrante, texto, hora del proveedor 14:52:02) tiene `quoted_message_id` no nulo, y ese identificador es el de un saliente de @poderosascomunidad que ya estaba guardado en la misma conversación (`c6628c4e`). Leído sin contenido a las 14:52:34. El criterio, fijado antes de mirar, era que el identificador no fuera nulo.

**El trabajo detenido se hizo cambiando el Cron Schedule a `0 0 1 1 *`, no borrándolo**, como estaba decidido el 08/10. El motivo: la documentación de Railway no dice qué pasa con un servicio al que se le borra el Cron Schedule, ni qué política de reinicio rige entonces (https://docs.railway.com/reference/cron-jobs, https://docs.railway.com/deployments/restart-policy), y un bucle le pegaría a Zernio cada pocos segundos. La política de `vigilancia-cron` es «Never», con el aviso «Services with a cron schedule do not have a restart policy» (captura de Marcos). **Cambio: 09/10/2026 hacia las 14:48** (avisado por Marcos; leído a las 14:48:19). La última corrida buena antes del corte fue la de las 14:40:16, en los dos espacios.
- **15:13:** Marcos recargó la pestaña y vio «Última revisión: hace 32 min» en rojo. En la base, a las 15:13:11, ninguno de los dos espacios tenía corridas desde las 14:40, ni siquiera fallidas.
- **Vuelta a `*/10 * * * *`: 15:40:36.** El despliegue de esa vuelta FALLÓ en Railway, en «Deploy › Create container»: «The registry returned "504 Gateway Timeout" for the image "docker.io/curlimages/curl:8.22.0"» (captura de Marcos; Railway mandó un correo de «Build failed!»). Igual hubo corridas a las 15:40:29 y a las 15:51:56: **observado, no documentado**, Railway aplicó el horario nuevo y corrió el contenedor del despliegue anterior. Marcos volvió a desplegar ese cambio y quedó ACTIVE, en «Deployment successful». Desplegar un cron no lo hace correr: el despliegue de las 14:49 no generó ninguna corrida. «Diagnose» de Railway no se usó.
- **La marca volvió:** a las 15:40:30 y 15:40:33 en los dos espacios, sin error. Marcos lo vio en la pestaña: «Última revisión: hace 2 min», sin rojo.

**La prueba del correo, en «Pruebas de correo» (`1a3db984`).** El horario no se cambió: con el de fábrica, el canal descartable ya junta 12,92 horas hábiles (calculado con `horasHabiles` a las 14:55). El único Owner o Admin es alomercadeo@gmail.com, leído a las 14:48 y a las 14:55. Resend está conectado, con remitente «ALO Mercadeo <avisos@notificaciones.alomercadeo.com>». Antes: 0 alertas abiertas, 3 filas en `email_log` (la última del 07/10) y 0 canales.
- **El canal descartable `176f85a3`, escrito a las 15:04:31 con la aprobación de Marcos** (por la conexión del CLI de Supabase, la misma de los recuentos): `instagram`/`zernio`, `late_account_id` y `platform_account_id` `falso-prueba-f39`, `username` `prueba_f39_correo`, «Canal descartable F39», activo, último entrante 08/10 a las 12:00, límite 1, el resto nulo o con su valor por defecto. Releído igual. Recuento: el espacio, de 0 a 1 canal; la tabla, de 3 a 4. No choca con los índices únicos de `channels` (`channels_instance_name_key`, `channels_ranura_activa_key`, `channels_cuenta_activa_key`): en toda la tabla había 0 filas con esos identificadores.
- **Corrida de las 15:40:** abrió la alerta `834f7663` (`vigilancia` / `canal_silencioso`) a las 15:40:31, con el detalle «Instagram @prueba_f39_correo: 13,7 de 1 horas hábiles». La fila de `email_log` `68a9bbdc`, de esa alerta, se escribió a las 15:40:32.576: «enviado» en el primer intento, para alomercadeo@gmail.com sola, con el asunto «Un canal pasó su límite de horas sin recibir mensajes». **Llegó:** Marcos la vio en Recibidos de alomercadeo@gmail.com a las 15:40, desde «ALO Mercadeo <avisos@notificaciones.alomercadeo.com>», con el detalle en el cuerpo.
- **Corridas de las 15:51:56 y de las 16:00:** 2 y 3 ocurrencias. **0 filas en `email_log` con `alerta_id` `834f7663` creadas después de las 15:40:33.619**, la hora en que terminó la corrida que la abrió (contado a las 16:05). La alerta tiene una sola fila.
- **El canal, borrado a las 16:05:20** por la conexión directa del CLI, con la aprobación de Marcos (avisada antes de escribir). No se usó «Desconectar» de la app, que llama a Zernio (`createZernioClient(apiKey).accounts.deleteAccount`, `lib/actions/integraciones.ts:336`). Antes de borrar se verificó en el código que la revisión llama a `resolve_webhook_alert` aunque el espacio no tenga canales vigilados (`lib/vigilancia-canales.ts:146-147`, `:159-162`; `lib/tareas-programadas.ts:77-79`). Recuento: el espacio, de 1 a 0 canales; la tabla, de 4 a 3. La alerta quedó con `channel_id` nulo (`ON DELETE SET NULL`).
- **Corrida de las 16:10:** la alerta `834f7663` se cerró a las 16:11:59, con 3 ocurrencias. `email_log` del espacio, 4 filas y 0 nuevas. 0 alertas abiertas en el espacio. El horario de «Pruebas de correo» no se tocó.

**Pendientes anotados en este tramo, sin investigar:**
- **Los `share` de Instagram no tienen dueño.** Ningún criterio de ninguna funcionalidad los cubre: F28 trata de archivos que se descargan y se guardan, y un `share` es un enlace; F35 no dice cómo se muestra un mensaje. El código que los mostraría es `MessageBubble` (`components/inbox/message-thread.tsx:56`), que hoy pone «Adjunto» (`:86-90`). `template` y `ephemeral`, en la misma situación, y sin saber qué son. Se anota en §15 del plano, sin escribir un criterio. **Candidato para F35, a decidir antes de S7.**
- **La respuesta a una historia no tiene dueño.** Hoy se guarda el texto y no el contexto de la historia. En el receptor, el texto sale de `mensajeDelAviso` (`lib/zernio-aviso.ts`), y ni `AvisoDeMensajeZernio` ni el tipo del receptor (`app/api/webhooks/late/route.ts:53-58`) leen `metadata.storyReply` (`@zernio/node` 0.2.519, `dist/index.d.ts:7723-7736`). En la importación, el texto sale de `normalizarTexto(m.message)` (`lib/zernio-message-map.ts`), y `storyReply`, que en el listado es un booleano (`dist/index.d.ts:16822`), no se lee. `messages` no tiene una columna para ese contexto. **Candidato para F35, a decidir antes de S7.** Sin criterio escrito.
- **La pestaña «Alertas» de Configuración no tiene dueño.** §11 la reparte entre F22 y F39, pero ningún criterio la pide. Se anota en §15.
- **`CRON_SECRET` sin sellar.** No está verificado que una variable sellada se pueda referenciar desde otro servicio (`vigilancia-cron` la toma con `${{SSA-Business-AI-OS.CRON_SECRET}}`). La documentación de variables de Railway no lo dice (https://docs.railway.com/variables), y un hilo de la comunidad (https://station.railway.com/questions/sealed-environment-variables-are-behavin-9ea8da1d) reporta valores sellados por referencia que llegan vacíos en ejecución, sin una respuesta oficial que lo cierre. Sin verificarlo no se sella. Tampoco se sabe quién creó ese `CRON_SECRET` ni si es largo y aleatorio, y las rutas del fork (`/api/cron/jobs` y `/api/cron/sequences`) lo aceptan en la dirección (`?key=`).
- **El token fine-grained «macbook-pitti-ssa-business-ai-os» de GitHub vence en 7 días contados desde el aviso del 09/10/2026.** Si vence, `git push` desde la Mac falla y `node scripts/verificar-despliegue.mjs` no puede subir. Se regenera al cierre de hoy, fuera de Claude Code.
- **`audit_log` sin espacio: el recuento del 09/10 muestra 23 filas; el arranque registraba 11 huérfanas.** No se sabe si la diferencia son filas legítimas sin espacio (por ejemplo, las de los espacios fantasma de los verificadores) o más huérfanas.
- **Los mensajes con adjunto ya no son 478.** Hoy son 483 en @alomercadeo, y suben con el uso. F28 los recuenta en el momento, antes de pedir el OK de las descargas.

**Criterios decididos por Marcos el 09/10/2026, al cerrar el tramo 3.** Registrados como reescritos en `docs/criterios-bajas.json`, cada uno con su prueba; foto con `node scripts/foto-criterios.mjs --escribir`: 324 líneas, 0 faltantes, 0 reescrituras rotas.
- **F39, siete tildes; queda completa (8 de 8).**
  - Con datos reales: el trabajo periódico con el umbral en horas hábiles; el correo vía F23; la marca de última ejecución visible; la marca que envejece con el trabajo detenido.
  - «Receptor detenido»: con datos reales del silencio y el receptor sin detener, porque detenerlo obliga a tocar la suscripción, que es una sola para las dos cuentas, y corta lo que entra de @alomercadeo.
  - La consulta de la suscripción: lectura real; que nombre el evento que falta, solo con la respuesta simulada.
  - El evento sacado: solo simulado, tildado como excepción, decidida el 08/10, de la misma categoría que el criterio de F24 de la cuenta excedida.
- **F27 #6, tipos: tildado. F27 queda completa (14 de 14).** **F27 #5 conserva la tilde** por la cita real (`fe4c6077`). No lleva entrada en `criterios-bajas.json`: su línea no cambió, y la guardia solo explica líneas que desaparecen de la foto.
- **El avance pasa de 9 a 11 de 26.** F25 y F26 siguen construidas y no completas.

**Fin del tramo 3: 09/10/2026 16:35:22**, leída antes de commitear el cierre. Suma: 266 min (4 h 26 min), de 12:09:06 a 16:35:22, sin cortes. La pausa de Marcos hacia las 12:13, para pasar a modo plan, no cerró la app y no se descuenta. Suma de la sesión 2: 510 min (8 h 30 min). La línea de base no cambió.

**Pendientes para el tramo 4 (F28, adjuntos):**
- **Recontar los adjuntos en el momento, antes de pedir el OK de las descargas.** Ya no son 478: el 09/10 eran 483 en @alomercadeo, y suben con el uso.
- **El token fine-grained «macbook-pitti-ssa-business-ai-os» de GitHub** vence en 7 días contados desde el aviso del 09/10/2026. Si vence, `git push` desde la Mac falla y `verificar-despliegue.mjs` no puede subir. Se regenera al cierre del 09/10, fuera de Claude Code (ver «Pendientes anotados en este tramo»). **Atendido el 09/10/2026 a las 17:39** (ver «Tramo 4», abajo).
- Los `share`, `template` y `ephemeral` de Instagram y la respuesta a una historia **no son de F28**: son candidatos para F35, a decidir antes de S7.
- `CRON_SECRET` sigue sin sellar: no está verificado que se pueda referenciar sellada.
- La regla de §14 se cumple para la vigilancia: si `vigilancia-cron` se cae, la pestaña lo muestra en rojo a los 30 minutos. **Nadie recibe aviso por eso**: la marca vencida no manda correo; se ve solo si alguien abre la pestaña.

### Tramo 4, parte A: F28, los adjuntos que llegan desde el despliegue

**Apertura: 09/10/2026 17:45:40 de Costa Rica**, leída con `TZ=America/Costa_Rica date`. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `ea79140`. La parte B (los adjuntos históricos) va en otra sesión.

- **F, `ea79140`** (cierre del tramo 3, docs). `node scripts/verificar-despliegue.mjs`, salida 0: el build pasó de `Pr-_9VDGnc_2PTLh3WOQO` a `aVL4WkduQbMHndZ3KxYJM`, de 16:35:42 a 16:37:18, con `/login` en 200. No podía figurar en sí mismo: se anotó al abrir el tramo 4, con la salida que capturó la sesión anterior.
- **Railway, mirado por Marcos el 09/10/2026 a las 16:54:** ACTIVE «docs: cierre del tramo 3 de la sesión 2 del Bloque 3 (F27 y F39 comp…», en «Deployment successful», subida 17 minutos antes, **identificado por título** contra `git log` (`ea79140`). El HISTORY no se desplegó.
- **El token fine-grained «macbook-pitti-ssa-business-ai-os» de GitHub se regeneró el 09/10/2026 a las 17:39**, fuera de Claude Code. `git push --dry-run` dio «Everything up-to-date». **Vence el 31/01/2027** (fecha dicha por Marcos). **Hay que regenerarlo antes del 24/01/2027**, fuera de Claude Code.

**El esquema `storage` de producción antes de la 00034, por consulta de catálogo (solo lectura, sin contenido), entre las 17:48 y las 17:58 (la hora exacta no se leyó) y otra vez a las 18:09:14:** 0 políticas en todo el esquema (`pg_policies` con `schemaname = 'storage'`: ni en `storage.objects` ni en `storage.buckets`), 0 buckets, la seguridad por filas activa en `storage.objects` y `storage.buckets`, y `storage.buckets` con las columnas `file_size_limit` (bigint) y `allowed_mime_types` (arreglo), que nombra el insert de la 00034. La consulta corre como `postgres`, que tiene permiso de insertar en `storage.buckets`.

**Migración 00034 (`adjuntos`), aplicada el 09/10/2026 a las 18:09:29 con `npx supabase db push`, salida 0, con la aprobación de Marcos** (por la conexión del CLI, avisada antes). Cinco columnas de `messages` (`media_intentos` sin valor por defecto, `media_reclamado_at`, `media_mime`, `media_bytes`, `media_error`), el índice parcial `messages_adjuntos_por_reintentar` y el bucket privado `message-media`, sin políticas.
- **Antes:** `tareas_estado` sin importación corriendo, leído a las 17:59 y otra vez a las 18:09:21. `--dry-run`: solo la 00034. Recuento a las 17:59: 29 tablas, 33 migraciones (última 00033), `messages` 3603; adjuntos 487 (485 de @alomercadeo y 2 de @poderosascomunidad), todos `pendiente`: 63 entrantes y 424 salientes.
- **Después (18:09:35):** 34 migraciones (última 00034). Comparado contra el recuento de las 17:59, solo cambiaron eso y la corrida de la vigilancia de las 18:10; las cantidades de todas las tablas, iguales. `pg_policies` del esquema `storage`: **0**. El bucket: `message-media`, `public` false, `file_size_limit` 104857600 (100 MB), `allowed_mime_types` con los 13 formatos de `FORMATOS_PERMITIDOS`. En `messages`: 0 filas con `media_intentos` no nulo, 487 adjuntos con intentos nulos, 0 filas con alguna de las otras cuatro columnas nuevas escrita. Adjuntos por estado, iguales: 63 entrantes y 424 salientes `pendiente`.

**Despliegue G, `cd91a56`** (F28, parte A). Push `ea79140..cd91a56`, `node scripts/verificar-despliegue.mjs`, salida 0: el build pasó de `aVL4WkduQbMHndZ3KxYJM` a `VSPLxzb0kp-wtsX81VMMM`, de 18:11:30 a 18:13:04, con `/login` en 200 y sin importación corriendo (leído a las 18:11:29). Antes: suite 710 de 710, `typecheck` en cero, `npm run build` bien.

**La prueba real de F28 en @poderosascomunidad**, desde @marcospittimusic, en la conversación `c6628c4e`. Filas leídas sin contenido (id corto, tipo del adjunto que mandó Zernio, si trae dirección sin imprimirla, estado, intentos, ruta, tipo detectado, tamaño). Línea de base a las 18:13:17: 0 objetos en `message-media`, 487 adjuntos, todos con intentos nulos, y los 487 ids guardados fuera del repo.
- **Primera tanda (18:19-18:20; foto, audio y video):**
  - `48a50018`, `audio` con dirección: **descargado** en el primer intento, 4 segundos después de llegar (reclamo 18:20:06). `video/mp4`, 20.774 bytes, en `e8f4f678…/c6628c4e…/48a50018…/archivo.mp4`.
  - `adda1bcd` y `49db1a8d`, `ephemeral` **sin dirección**: el adjunto trae solo `type`. Quedaron `pendiente` con intentos nulos, como está decidido para `ephemeral`.
- **Segunda tanda (18:21-18:22), foto y video desde la galería:** `02d09df9` y `cc0a099a`, otra vez `ephemeral` sin dirección. La inferencia de la sesión («la cámara del chat los manda para ver una vez») quedó refutada por esta tanda.
- **Tercera tanda (18:29), foto y video desde la galería** con la hipótesis de Marcos (elegir que queden en el chat): `b8a349e5`, `image` con dirección, **descargado** en el primer intento, `image/jpeg`, 975.722 bytes, en `…/b8a349e5…/archivo.jpg`; `f7bff228`, `video` con dirección, **descargado** en el primer intento, `video/mp4`, 148.445 bytes, en `…/f7bff228…/archivo.mp4`.
- **Objetos en `message-media`: 3**, exactamente los de la prueba (leído a las 18:30:26).
- **Los tres archivos son los correctos, confirmado por Marcos:** a las 18:35 abrió y reprodujo los tres desde el panel de Storage de Supabase (`48a50018` el audio de voz, `b8a349e5` la foto, `f7bff228` el video) y confirmó que son los que mandó desde @marcospittimusic. Es la prueba de que lo guardado es el archivo correcto, no solo que hay un archivo.
- **Ningún histórico se tocó:** los 487 ids guardados antes de la prueba, releídos a las 18:23:16, siguen `pendiente` con `media_intentos`, `media_reclamado_at`, `media_path`, `media_mime`, `media_bytes` y `media_error` nulos (487 de 487). Adjuntos con intentos nulos: de 487 a 491; la diferencia son las 4 filas `ephemeral` de la prueba, que no se marcan por diseño.

**Despliegue H, `19e965a`** (F28, 5f y 5g: la dirección firmada y la bandeja). Push `cd91a56..19e965a`, salida 0: el build pasó de `VSPLxzb0kp-wtsX81VMMM` a `gK-wyVS_fF8YDgwvYiiY_`, de 18:40:12 a 18:41:37, con `/login` en 200 y sin importación corriendo. Antes: suite 719 de 719, `typecheck` en cero, `npm run build` bien. **Railway, mirado por Marcos hacia las 18:45:** ACTIVE «feat(F28): la bandeja muestra los adjuntos bajados con dirección firm…», «Deployment successful», subida 4 minutos antes, **identificado por título** (`19e965a`). El HISTORY no se vio: si `cd91a56` falló en Railway no se sabe; el script solo dice que el build servido cambió.
- **Los tests de alcance de 5f están en `app/api/v1/messages/route.test.ts`**, en el bloque «GET /api/v1/messages: las direcciones firmadas de los adjuntos (F28)» (`:185`): el del Member sin el lead en `:202` y el del Owner en `:213`. El del Owner se vio en rojo contra la ruta anterior. El del Member **pasaba antes**, porque la ruta anterior no firmaba nada (un verde vacío); se vio en rojo después, contra la rotura a propósito.
- **5f:** `GET /api/v1/messages` lee con el cliente del usuario (la RLS aplica el alcance de leads) y firma en lote, con la clave de servicio y 600 segundos, solo las rutas de los mensajes `descargado` que volvieron. `media_path` no viaja; viaja `archivo: { url, mime }`. Tests: un Member sin el lead recibe 403 y no se firma nada; un Owner recibe la dirección (control positivo, visto en rojo contra la ruta anterior). El del Member se vio fallar contra una rotura a propósito (firmar con la clave de servicio antes del control de alcance). **La prueba con el token real de un Member en un espacio fantasma no se hizo**: queda con tests simulados.
- **5g:** `MessageBubble` muestra `<img>`, `<audio controls>` o `<video controls>`, elegido por `message_type` y no por `media_mime` (la rotura a propósito de elegirlo por `media_mime` puso en rojo el test de la nota de voz). «Todavía no pudimos traer este archivo. Se vuelve a intentar solo.» para `fallido`, «Este archivo no está disponible.» para `no_disponible`. Los históricos y los `ephemeral`, «Adjunto» como antes.
- **La bandeja, vista por Marcos hacia las 18:44 recargando «Ale Admin's Workspace»** (con capturas; **la hora la sacó la sesión anterior de esas capturas, y Marcos no la confirmó**: no las guardó, dicho el 19/10/2026): se ven la foto, el video y el audio. El audio (`media_mime` `video/mp4`) aparece con reproductor de audio (0:03). Los cuatro `ephemeral` (18:20, 18:20, 18:21, 18:22) dicen «Adjunto». Que un MP4 de solo audio se reproduzca en `<audio>` era inferencia; queda observado en el navegador de Marcos.
- **Candidato para F35, sin criterio y sin construir:** la foto se ve solo dentro de la burbuja; para verla grande hay que abrirla en otra pestaña (observación de Marcos). Ampliarla al hacer clic no lo pide ningún criterio de F28.
- **Anotado, sin arreglar:** cada vez que entra un mensaje, el hilo se recarga entero (`message-thread.tsx`, la suscripción a `conversations`) y las direcciones se vuelven a firmar; un audio o video que se esté reproduciendo en ese momento se reinicia.

**`ephemeral` es, con alta probabilidad, la foto o el video de «ver una vez» de Instagram. Inferencia, no verificada contra el log de Zernio**, con estas filas como prueba: 4 de 4 envíos llegaron como `ephemeral` sin dirección, y los 2 enviados eligiendo que queden en el chat llegaron como `image` y `video` con dirección y se bajaron. En @alomercadeo, los leads llegan con `image` y `video` con dirección (11 de 11) y hay un solo `ephemeral` entrante, del 07/10, también sin dirección. Hipótesis de Marcos. Sirve para la decisión de F35 sobre cómo mostrar un `ephemeral`.

**La nota de voz de Instagram se detecta como `video/mp4`**, no `audio/mp4`: viene en un MP4 cuya cabecera no la distingue de un video (lo anticipaba el comentario de `lib/adjuntos-formatos.ts`). El archivo se guarda bien. Para la bandeja (5g, parte B): el reproductor se elige por `message_type` (`audio`), no por `media_mime`. La lista de formatos no se amplió.

**Recuento de adjuntos al cierre de la parte A, 09/10/2026 18:45:06, sin contenido** (por canal, dirección, tipo del adjunto según Zernio y si trae dirección). 494 adjuntos; 3 objetos en `message-media`.
- **Bajados (intentos no nulos): 3**, todos de la prueba en @poderosascomunidad: `audio`, `image` y `video`, `descargado`.
- **Con intentos nulos: 491.** De @alomercadeo, 485 (los históricos):
  - entrantes con archivo y dirección, **los únicos que la parte B podría bajar: 13** (`audio` 2, `image` 3, `video` 8). Que sus direcciones sigan vigentes no se sabe;
  - entrantes `share` con dirección: 30 (enlaces, no de F28);
  - entrantes sin dirección: `template` 17 y `ephemeral` 1;
  - salientes: `template` 394 sin dirección, `video` 14 y `share` 15 con dirección, `share` 1 sin dirección (los salientes no son de F28: decidido para la parte A).
- De @poderosascomunidad, 6: `ephemeral` 4 sin dirección (de la prueba) y `template` 2 sin dirección.

**Los seis criterios de F28, para que Marcos decida.** Regla de Marcos: un criterio que no nombra canal se tilda cuando están cubiertos los dos, como `last_click` de F25 el 08/10. En WhatsApp hoy no se baja nada: el receptor de Evolution no marca la descarga, a propósito (ver abajo).

| Criterio | Instagram: qué quedó probado y cómo | WhatsApp: qué falta |
|---|---|---|
| 1. Se descarga al recibirlo y se guarda en Storage | **Datos reales:** `48a50018`, `b8a349e5` y `f7bff228`, `descargado` en el primer intento; Marcos abrió los tres archivos en el panel de Storage y son los que mandó. **Test con rotura a propósito:** el receptor sin marcar los intentos | Todo: la bajada no existe. Diseño verificado arriba (endpoint `getBase64FromMediaMessage`) |
| 2. Bucket privado, direcciones firmadas de vida corta | **Datos reales:** el bucket `public` false y 0 políticas en el esquema `storage` (leído después del push); la bandeja de Marcos muestra los tres con la dirección firmada. **Test con rotura a propósito:** un Member sin el lead no recibe ninguna dirección; un Owner sí. La prueba con un token real de Member en un espacio fantasma **no se hizo** | Lo común (bucket y firma) sirve igual; falta un archivo de WhatsApp que firmar |
| 3. Carpetas por espacio, conversación y mensaje | **Datos reales:** las tres rutas `e8f4f678…/c6628c4e…/<mensaje>/archivo.<ext>`. **Test:** la ruta en `lib/adjuntos.test.ts` | La ruta la arma el código común; falta la bajada |
| 4. Tipo real, no la extensión. Tamaño máximo configurable | **Datos reales:** `image/jpeg`, `video/mp4` y `video/mp4` (la nota de voz), detectados por los bytes. **Test:** rechazo de un tipo no permitido y del tamaño excedido; `ADJUNTOS_TAMANO_MAXIMO_MB`, 25 por defecto. **Test con rotura a propósito:** la lista del detector distinta de la del bucket | Falta la bajada |
| 5. Si falla, se guarda igual con la marca y se reintenta | **Solo test:** `fallido` con el código del error, `no_disponible` en el quinto, el reintento toma lo que el `after()` no bajó, un fallo del reintento no frena la vigilancia. **Tests con rotura a propósito:** el histórico tomado como 0, la escritura sin la condición de intentos, la espera desde `created_at`, el reintento sin el filtro de nulos y sin su propio `try/catch`. Ninguna falla real | Falta la bajada |
| 6. La descarga no bloquea el acuse | **Test con rotura a propósito:** con la descarga antes del acuse, tres tests en rojo. **Dato real coherente:** cada descarga se tomó unos 4 segundos después de llegar, en el `after()`; no mide el tiempo del acuse | El receptor de Evolution no descarga, así que no bloquea; falta la bajada |

**Pendientes para la parte B de F28, anotados durante el tramo, sin arreglar hoy:**
- **La parte B son 13 archivos, no 487:** los entrantes de @alomercadeo con archivo y dirección, 2 audios, 3 fotos y 8 videos (recuento de las 18:45:06). Fechas, leídas sin contenido en el recuento por tipo de las 18:23: las 3 fotos, del 17/06/2021 al 01/09/2026; los 8 videos, del 23/09 al 07/10/2026; los 2 audios, del 05/10 al 09/10/2026. **Sin verificar:** si esas direcciones del CDN de Instagram siguen vigentes (la más vieja es de 2021). Si vencieron, la parte B necesita direcciones nuevas, pidiéndole a Zernio el listado de mensajes de @alomercadeo, y eso se aprueba aparte. Tampoco se sabe si alguno de los 8 videos es un reel compartido. La parte B va con su recuento del momento y el OK de Marcos antes de bajar nada.
- **Un quinto intento cortado queda trabado.** Si un redespliegue corta el quinto intento (el del techo) después de tomarlo, la fila queda `pendiente` (o `fallido`) con `media_intentos` en 5. El reintento solo toma filas con intentos menores que 5 (`lt("media_intentos", TECHO_DE_INTENTOS)` en `porReintentar`, `lib/adjuntos.ts`), así que no la vuelve a tomar, y nunca pasa a `no_disponible`. En la bandeja se vería como un adjunto pendiente para siempre.
- **Los `ephemeral` no tienen dirección y no se pueden bajar.** Quedan `pendiente` con intentos nulos, igual que los históricos. La parte B tiene que excluirlos del recuento de lo que se puede descargar (por ejemplo, contando solo adjuntos con `attachments->0 ? 'url'`), o va a pedirle el OK a Marcos para descargas que no existen. Lo mismo vale para los `template` (sin dirección, 17 entrantes y 394 salientes al 09/10).
- **WhatsApp no marca la descarga.** El receptor de Evolution llama a `guardarMensajes` sin `marcarDescarga` (`lib/evolution-guardado.ts:280`), a propósito: si marcara, el reintento intentaría bajar un adjunto que no trae dirección y lo dejaría `no_disponible` por `sin_direccion`. Lo tiene que marcar la parte B, cuando exista la bajada de WhatsApp (test en `lib/mensajes-guardado.test.ts`).

**WhatsApp (ítem 6): no se construyó. Verificado en el código y diseñado.** Lectura de código público, sin ninguna llamada a Evolution: clon de la etiqueta `2.3.7` de EvolutionAPI/evolution-api fuera del repo (commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`). `git ls-tree HEAD src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` dio el blob `60e857fcc1206776575921c9060d05efdd7ff432`, el mismo que cita `lib/evolution-guardado.ts:10-11`. Abajo, `B` es ese archivo; las líneas son de 2.3.7.
- **Los caminos para obtener el archivo:**
  - **(a) El endpoint `POST /chat/getBase64FromMediaMessage/{instancia}`** (prefijo en `src/api/routes/index.router.ts:220`, ruta en `src/api/routes/chat.router.ts:113`, responde 201 en `:121`), con el encabezado `apikey` (`src/api/guards/auth.guard.ts:12`, la global en `:19-21` o el token de la instancia en `:28-34`). Cuerpo: `{ message: WebMessageInfo, convertToMp4?: boolean }` (`src/api/dto/chat.dto.ts:20-23`). Si se le manda el mensaje entero (`key` y `message`), descarga con eso y **no consulta su base** (`B:3841`); con solo la `key`, lo busca en su Postgres por `key.id` (`B:523-531`) y, si no está, responde 400 (`B:3843-3845`, `B:3973-3976`); el mensaje está ahí solo con `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (`B:1355`; `src/config/env.config.ts:491`, falso si no está definida). Descarga con `downloadMediaMessage` de Baileys y el pedido de volver a subir (`B:3898-3903`), y si falla, con `downloadContentFromMessage` (`B:3905-3929`). Devuelve `mediaType`, `fileName`, `mimetype`, `base64` y el tamaño (`B:3962-3970`). `convertToMp4` es solo para audio (`B:3937`).
  - **(b) El base64 en el aviso**, con `webhook.base64: true`: llega en `data.message.base64` de `messages.upsert` (`B:1445-1469`). Si la descarga falla, el aviso sale igual sin `base64` y el error queda solo en el log de Evolution (`B:1469-1471`); la descarga demora el aviso; cada uno de los hasta 10 reintentos del aviso reenvía el archivo entero (`webhook.controller.ts:206`, `:224`).
  - **(c) Descifrarlo nosotros:** el aviso trae `message[tipo]` completo, con `url`, `directPath`, `mediaKey`, `fileEncSha256` y `fileSha256` (`prepareMessage`, `B:4652-4704`; `B:4664`). Pide sumar Baileys o implementar el descifrado, y perder el pedido de volver a subir, que necesita la sesión viva que solo tiene Evolution (esto último, inferencia: no se leyó el código de Baileys).
  - **(d) S3 o MinIO propio de Evolution**, con `mediaUrl` en el aviso (`B:1419-1433`): la dirección vence (`minio.server.ts:94-101`), y con `S3_SAVE_VIDEO` en falso un video entrante corta el manejador entero y el aviso no sale (`B:1393`).
- **Recomendado: (a), llamado por el servidor apenas llega el aviso, con el mensaje entero tomado del propio aviso;** de respaldo para el reintento, con solo la `key`, si `DATABASE_SAVE_DATA_NEW_MESSAGE` está en true en nuestro Evolution (**no verificado** qué valor tiene en Railway). Motivos: no depende de la base de Evolution, reusa su descarga con el pedido de volver a subir, no infla los avisos como (b) y no arrastra la trampa del video ni las direcciones que vencen de (d).
- **Qué hay que guardar que hoy `traducirMensaje` descarta** (`lib/evolution-guardado.ts:129-137` guarda solo `type`, `mimetype` y `fileName`): con (a) descargando en el `after()` del receptor, nada más, porque el aviso trae todo en ese momento; para que el reintento pueda mandar el mensaje entero, hay que guardar la `key` y el objeto `message[tipo]` completo, **que incluye `mediaKey`, la clave de descifrado del archivo**. Si se guarda, va en una columna que la bandeja no lee y se borra cuando el archivo quedó guardado; **nunca viaja al navegador**. Alternativa sin guardar la clave: el reintento con solo la `key`, que depende del valor de `DATABASE_SAVE_DATA_NEW_MESSAGE`. El cuerpo crudo de un aviso de Evolution nunca se registra.
- La parte B, además, tiene que poner `marcarDescarga` en el receptor de Evolution (ver arriba). La prueba: aviso firmado contra el receptor de producción o simulado, con la forma de 2.3.7 y sus líneas; la llegada real, en la puesta en marcha del número.

**Criterios de F28, decididos por Marcos el 09/10/2026 al cerrar el tramo: no se tilda ninguno de los seis.** Motivo: los criterios no nombran canal y se tildan cuando están cubiertos los dos, como `last_click` de F25 el 08/10; WhatsApp no baja nada todavía, a propósito. F28 queda «construida en parte». **El avance sigue en 11 de 26.** No hay entradas nuevas en `docs/criterios-bajas.json`: ninguna línea de criterio cambió.

**Para la sesión de F30 (la purga): borrar la fila de `messages` no borra el archivo de Storage.** §9 dice que los adjuntos siguen la retención del mensaje: si el contacto se purga a los 30 días de eliminado, sus archivos también. El archivo vive en `message-media`, en `{espacio}/{conversación}/{mensaje}/archivo.{ext}` (la ruta queda en `messages.media_path`), y ninguna cascada de la base lo alcanza. La purga de F30 lo tiene que borrar con la API de Storage antes o después de borrar las filas.

**Fin del tramo 4: 09/10/2026 18:49:15**, leída antes de commitear el cierre. Suma: 63 min, de 17:45:40 a 18:49:15, sin cortes. Suma de la sesión 2: 573 min (9 h 33 min). La línea de base no cambió. La parte B de F28 va en otra sesión.

### Tramo 5: F28, parte B (los históricos de Instagram y la bajada de WhatsApp)

**Apertura: 19/10/2026 12:48:47 de Costa Rica**, leída con `TZ=America/Costa_Rica date`. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `01511a5`, comprobado con `git log`. Entre el 09/10 y hoy no hubo commits ni despliegues: producción corrió diez días el código de la parte A.

- **Despliegue I, `01511a5`** (cierre del tramo 4, docs). `node scripts/verificar-despliegue.mjs`, salida 0: el build pasó de `gK-wyVS_fF8YDgwvYiiY_` a `KPbo3Qx8MHA76xlsORB8q`, de 18:49:33 a 18:51:07 del 09/10/2026, con `/login` en 200. No podía figurar en sí mismo: se anota al abrir el tramo 5.
- **Railway, dicho por Marcos con captura el 19/10/2026 a las 12:35:** ACTIVE «docs: cierre del tramo 4 de la sesión 2 del Bloque 3 (F28, part…», «9 days ago via GitHub», en «Deployment successful». **Identificado por título** (`01511a5`).
- **HISTORY, dicho por Marcos con captura el 19/10/2026 a las 12:45:** debajo del ACTIVE, en REMOVED y «9 days ago via GitHub»: «feat(F28): la bandeja muestra los adjuntos bajados con direcci…» (`19e965a`), «feat(F28): bajar los adjuntos de Instagram al recibirlos (parte …» (`cd91a56`), «docs: cierre del tramo 3 de la sesión 2 del Bloque 3 (F27 y F3…» (`ea79140`) y «feat(F39, F27): vigilancia de canales y el mensaje citado de In…» (`8fa052d`). Identificados por título. **Ninguno figura como fallido: queda cerrada la duda de si `cd91a56` falló en Railway** (despliegue H, arriba).
- **La hora en que Marcos vio la bandeja el 09/10 («hacia las 18:44»)** no se puede confirmar: Marcos no guardó las capturas. Se deja como está, con la nota al lado.

**Recuento de los diez días, 19/10/2026 13:06:52, solo lectura y sin contenido** (script fuera del repo, con la clave de servicio; `storage.objects` por el CLI):
- **Filas con `media_intentos` no nulo: 9.** 3 son las de la prueba del 09/10 en @poderosascomunidad (`descargado`). **Las otras 6 son entrantes reales de leads de @alomercadeo, y las 6 terminaron `no_disponible` con `tipo_no_permitido`** (detalle abajo).
- **Trabadas** (intentos en 5 o más, sin `descargado` ni `no_disponible`): **0**.
- **Objetos en `message-media`: 3**, los de la prueba del 09/10.
- **`tareas_estado`:** `reintento_adjuntos`, última corrida buena 19/10 13:01:04, con 0 revisados; `vigilancia_canales` de los dos espacios, buena a las 13:01. Que el reintento corrió en estos días lo prueba `27758899`, que se reintentó el 17/10. `importacion_historial`, última el 08/10: no hay importación corriendo.
- **Los históricos de @alomercadeo con archivo y dirección: 13**, los mismos del 09/10 (3 fotos, 8 videos, 2 audios).

**Los 6 rechazos reales, del 13/10 al 18/10. Son el primer dato real del criterio 5 y, a la vez, un posible defecto abierto. No es una tilde.** Los 6 son entrantes de tipo `video` según Zernio, con dirección. El detector no reconoció lo que bajó, y el código de entonces no guardaba nada que diga qué era. Por eso hoy se suma el diagnóstico al despliegue del arreglo del quinto intento (ver abajo).

| id | conversación | llegó | cierre | intentos |
|---|---|---|---|---|
| `0dfb24cd` | `273fa884` | 13/10/2026 13:03:17 | 13:03:23 | 1 |
| `9b1d964a` | `87255fa7` | 13/10/2026 23:04:03 | 23:04:10 | 1 |
| `fcdb330c` | `953cd423` | 16/10/2026 14:09:41 | 14:09:49 | 1 |
| `27758899` | `273fa884` | 17/10/2026 09:51:17 | 09:51:29 (hora del último reclamo; el primer error no se conoce, ver abajo) | 2 |
| `a7459395` | `273fa884` | 18/10/2026 12:44:43 | 12:44:48 | 1 |
| `36fe1f57` | `97ab6fcf` | 18/10/2026 17:36:25 | 17:36:34 | 1 |

«Cierre» es `media_reclamado_at`, la hora en que se tomó el último intento; la escritura del cierre no tiene hora propia. **Hipótesis, sin verificar: son reels compartidos, y la dirección devuelve una página en vez de un archivo.** Que 3 de los 6 vengan de la misma conversación encaja, pero no lo prueba. **Decidido por Marcos el 19/10/2026: los 6 no se tocan** hasta tener el diagnóstico. Si resulta ser un formato que falta, reabrirlos es una escritura en producción aparte, con las filas mostradas antes y su OK. Sumar un formato es una migración, porque `allowed_mime_types` del bucket tiene que coincidir con `FORMATOS_PERMITIDOS`, y se propone con su motivo antes de hacerla.

**El arreglo del quinto intento y el diagnóstico del rechazo (`a02fa82`).** Hay dos cambios en `lib/adjuntos.ts`:
- `Almacen.trabadas` toma las filas abiertas con intentos en el techo y sin reclamo en la espera, y `reintentarAdjuntos` las cierra en `no_disponible` con `intento_cortado`, con la condición de intentos de `cerrar`.
- El rechazo por tipo deja en `media_error` `tipo_no_permitido|<Content-Type sin parámetros>|<host final>|<16 bytes en hex>`.

Antes de cambiar el formato, `git grep` de `media_error` y `tipo_no_permitido`: la única comparación por igualdad era `lib/adjuntos.test.ts:144`, que pasó a comparar el prefijo. La bandeja no lee `media_error` (`GET /api/v1/messages` no lo selecciona, `route.ts:74`), y ningún recuento lo nombra.

Tests:
- **Seis tests en rojo antes del arreglo:** el diagnóstico (2), el prefijo (1), el quinto intento cortado (2) y la consulta de `trabadas` (1).
- **El control «la dirección no aparece en `media_error`»** pasaba antes del cambio, que es lo esperable de un control. Se vio en rojo con una rotura a propósito: guardar `res.url` entero en lugar del host.
- **El cierre de las trabadas** se vio en rojo con otra: el reintento sin la pasada de trabadas.
- Suite 725 de 725, `typecheck` en cero, `npm run build` bien.

**Migración 00035 (`adjuntos_whatsapp`), aplicada el 19/10/2026 a las 15:03:12 con `npx supabase db push`, con la aprobación de Marcos** (por la conexión del CLI, avisada antes). Crea la tabla `whatsapp_adjuntos_por_bajar`.
- **Antes:** sin importación corriendo (leído a las 15:03:08). `--dry-run`: solo la 00035. Recuento a las 14:54:43: 29 tablas, 34 migraciones (última 00034), `messages` 4002, `audit_log` 414 (23 sin espacio).
- **Salida del push:** «Applying migration 00035_adjuntos_whatsapp.sql… Finished supabase db push.». El código de salida no se capturó: el comando iba por un `tail`, que es el que devolvió 0. Lo prueba el recuento.
- **Después (15:03:22):** 30 tablas, 35 migraciones (última 00035), y las cantidades de todas las tablas iguales. `pg_policies` de la tabla: **0**. `relrowsecurity` true. **Ningún permiso** para `anon` ni `authenticated` en `information_schema.role_table_grants`. 0 filas. No está en la publicación de Realtime.

**5a, la dirección firmada con sesiones reales de un Owner y de un Member** (`scripts/verify-alcance-firmada.mjs`, nuevo), contra `GET /api/v1/messages` de producción, 19/10/2026 de 15:32:10 a 15:32:23. **11 comprobaciones pasaron y 0 fallaron**, salida 0.
- **El escenario:** un espacio fantasma, creado y borrado en la misma corrida. Un Owner y un Member, usuarios de Auth `@ssa-test.local` con contraseña al azar que solo vivió en memoria. La sesión va en la cookie como la arma `@supabase/ssr` 0.8.0 (`sb-<ref>-auth-token`, `base64-`, partes de 3180 caracteres). Dos leads con un PNG chico cada uno en `message-media`: el A asignado al Owner (setter y conversación) y el B al Member.
- **Owner, lead A (control positivo):** 200 con la dirección firmada del bucket privado, y la dirección sirve el archivo. `media_path` no viaja como campo.
- **Member, lead B (control positivo del rol):** 200 con la dirección de su propio lead. Su sesión funciona, así que el 403 que sigue no es una cookie mal armada.
- **Member, lead A:** **403**, y la respuesta no trae la dirección, la ruta ni el id del mensaje.
- **Limpieza:** los 2 archivos de Storage (0 objetos del espacio al recontar), los contactos con sus conversaciones y mensajes, el canal, los 2 usuarios y los 2 espacios. Recuento posterior: 0 usuarios `b3-firma-*` en `auth.users`, 9 objetos en el bucket (los mismos de antes), y las filas de `audit_log` sin espacio siguen en 23 (esta prueba no registró ninguna). El único espacio fantasma vivo es el de la 4h.
- **Límite:** este script no se corrió contra una versión rota de la ruta, porque no se rompe producción. Su comprobación negativa (el 403) se apoya en los dos controles positivos, y la rotura a propósito de la ruta ya se hizo el 09/10 en el test simulado (`app/api/v1/messages/route.test.ts`).

**5b, la marca visible del reintento de adjuntos (§15, «Vigilancia por ausencia»), sin criterio nuevo.** En Configuración › Vigilancia de canales (`app/(dashboard)/dashboard/settings/vigilancia/page.tsx`), debajo de la marca de F39, una tarjeta muestra la fila `reintento_adjuntos` de `tareas_estado`.
- La lee con el cliente de servicio, después del control de rol, igual que la de F39.
- La regla es la misma: manda `ultimo_ok_at`, y se pone en rojo a los 30 minutos (`marcaVencida`), con el error de la última corrida. El texto es «Último reintento de archivos adjuntos: hace N min» o «El reintento de archivos adjuntos todavía no corrió nunca.».
- El texto sale de `textoDelReintento` (`lib/tareas-estado.ts`), con 4 tests vistos en rojo antes de escribirla. La tarjeta de F39 no se tocó.
- **No se vio en el navegador:** desde localhost habría que iniciar sesión contra producción. La ve Marcos después del despliegue.
- Se sube **después de la 4h**, para que un redespliegue no corte su quinto intento.

**Despliegue K, `f4469cc` (la bajada de WhatsApp), sin confirmar.** Push `a02fa82..f4469cc` a las 15:05. Antes: suite 739 de 739, `typecheck` en cero, `npm run build` bien, y la 00035 ya aplicada. `node scripts/verificar-despliegue.mjs` **salió sin verde**: «Lo subido no está desplegado: en 5 minutos el build siguió en `96QfJA7-DZg9527NP2Zml`», de 15:05:01 a 15:10:03. Releído a las 15:10:11: el mismo build, `/login` en 200. Se le pidió a Marcos que mire el historial de Railway.
- **Railway, dicho por Marcos con captura el 19/10/2026 hacia las 15:17:** ACTIVE «feat(F28): bajar los adjuntos de WhatsApp desde Evolution (p…», «12 minutes ago via GitHub», en «Deployment successful». **Identificado por título** (`f4469cc`).
- **Releído a las 15:17:54:** producción sirve el build `EEyYAmFlO5sm89vpt88Z_`, con `/login` en 200. **El despliegue tardó más de los 5 minutos que espera el script**: el script no se equivocó, el build todavía no había cambiado cuando dejó de esperar. La hora exacta del cambio no se midió. Queda desplegado por título en Railway y por el cambio de build, no por la salida del script.

**La prueba 4h: un aviso firmado de WhatsApp con una foto, contra el receptor de producción** (`scripts/verify-adjuntos-whatsapp.mjs`, aprobada por Marcos el 19/10/2026). Espacio fantasma `f405e19e`, usuario de Auth `c658a7eb` (`@ssa-test.local`), canal `05ea1ada` con la instancia inventada `b3-adjuntos-e65e670d` y `umbral_silencio_horas` en nulo. El secreto del webhook y el token de la instancia los generó el script, que no leyó ninguna clave existente.
- **«preparar», 15:18:07, salida 0:**
  - El receptor acusó **200 en 3.886 ms**; el acuse terminó a las 15:18:14.137.
  - El mensaje `f31a7314` quedó guardado y marcado. **El primer intento se tomó a las 15:18:14.288**, 151 ms después de que llegó la respuesta: es el `after()`. Quedó **`fallido` con `http_404`**.
  - **Control de la clave de descifrado:** con la clave de servicio, la fila de `whatsapp_adjuntos_por_bajar` está (control positivo). Con el token del Owner del espacio fantasma, la tabla responde **HTTP 403 y 0 filas**. `messages` no tiene `mediaKey`.
- **Cómo se anota esta falla:** es **«instancia inexistente»** (404, `instance.guard.ts:36`), no «sin número vinculado». Ese 404 sale **antes de que Evolution mire la clave y lea el cuerpo** (orden de guards, `index.router.ts:41`). **La prueba no demuestra que Evolution acepte la forma de nuestro pedido** (ruta, cuerpo, `apikey`): eso queda verificado solo contra el código de 2.3.7 y con el test simulado, y se comprueba en la puesta en marcha del número.
- **Intentos de la 4h, leídos cada minuto sin contenido:** 1 a las 15:18:14 (el `after()` del receptor), 2 a las 15:20:32 y 3 a las 15:31:29, **los dos últimos del reintento programado**. Los tres terminaron `fallido` con `http_404`, y el mensaje guardado sigue en su lugar. Es el primer reintento programado real de WhatsApp.
- **El cierre:** el **intento 4 a las 15:40:36** (`fallido`, `http_404`) y el **intento 5 a las 15:50:49**, que la dejó **`no_disponible` con `http_404`**. En el mismo cierre, **el mensaje guardado se borró** de `whatsapp_adjuntos_por_bajar`, con su clave de descifrado: la lectura de las 15:51 da 0 filas. Los 5 intentos, en resumen: 15:18:14 (el `after()`), 15:20:32, 15:31:29, 15:40:36 y 15:50:49 (el reintento programado). El 404 es «instancia inexistente», no «sin número vinculado».
- **«borrar», 15:55:00 a 15:55:10, salida 0**, dentro del minuto 5 al 8 de la decena, como pidió Marcos. Borró los dos secretos de Vault, los contactos (y en cascada la conversación, el mensaje y el mensaje guardado), los reclamos de `webhook_events`, el canal, el usuario de Auth y el espacio (y en cascada su `tareas_estado` y la membresía). **Recuento posterior, todo en 0:** `workspaces`, `workspace_members`, `channels`, `contacts`, `conversations`, `messages`, `whatsapp_adjuntos_por_bajar`, `webhook_events`, `tareas_estado`, `webhook_alerts`, `email_log`, `integration_configs`, `auth.users`, los nombres de Vault del espacio (solo nombres, nunca valores) y `storage.objects`.
  - **`webhook_events` y `tareas_estado`, recontados el 19/10/2026 a las 16:34:24 por la instancia `b3-adjuntos-e65e670d` y por el id del espacio `f405e19e`: no queda ninguna fila; que las haya habido antes de borrar no se comprobó: no concluyente.**
- **`audit_log`, después de «borrar» (recuento general de las 15:55):** las filas sin espacio **pasaron de 23 a 24** por esta prueba. La nueva es **`f6eba706`** («contacto.creado»), con su espacio ya borrado. No se borra (F31).
- **Recuento general posterior:** 30 tablas, 35 migraciones; los espacios son de nuevo «Ale Admin's Workspace» y «Pruebas de correo»; `messages` 4002.
- **Despliegue L, `7fc09d0`** (el 5a, el 5b y estos registros: `704fc39` y `7fc09d0`), después de cerrada la 4h. Antes: sin importación corriendo, suite 743 de 743, `typecheck` en cero, `npm run build` bien. `node scripts/verificar-despliegue.mjs` imprimió «Desplegado: el build pasó de `EEyYAmFlO5sm89vpt88Z_` a `QJjOVEKD_tV6Z5_OUUBv7` y /login responde 200», de 15:56:15 a 15:58:45. **El código de salida no se capturó**, porque iba por un filtro. Ese mensaje es el que el script da cuando sale con 0 (`scripts/verificar-despliegue.mjs:135`).
- **Railway, dicho por Marcos el 19/10/2026 a las 16:11:** ACTIVE «docs: la prueba firmada de WhatsApp (4h) hasta no_disponibl…», «14 minutes ago via GitHub», «Deployment successful». **Identificado por título** (`7fc09d0`).
- **La bandeja de @poderosascomunidad, vista por Marcos recargando el 19/10/2026:** una burbuja a las 02:39 PM con «Este archivo no está disponible.» y, a las 02:40 PM, el video de la cámara, que se reproduce. **Por id y `created_at`, sin contenido:** la de las 02:39 es el reel `15d2ce4c` (14:39:51, `no_disponible`) y la de las 02:40 es `5017f220` (14:40:42, `descargado`), las dos en `c6628c4e`. Son los únicos 2 mensajes de esa conversación entre las 14:38 y las 14:42. La fecha de subida de `d6754c32` en `storage.objects` es 14:50:15, la misma que Marcos vio como «added on 10/19/2026».
- **El «reset: moving to HEAD» de las 14:54:15 en `.git/logs/HEAD`** fue el `git stash` y `git stash pop` que la sesión corrió para comparar los avisos de lint antes y después de los cambios (un `stash` registra ese reset). La pila de stash quedó vacía, `git status` mostró después los mismos 14 archivos, y todos están en `f4469cc`. No se perdió nada.
- **Las 13 filas históricas, releídas a las 15:59:21 sin contenido:** las mismas 13, sin cambios desde las 14:50. 5 `descargado` y 8 `no_disponible` con el diagnóstico de página de `www.instagram.com`, todas con intentos en 1. El resto de las filas con intentos: 4 `descargado` (las 3 del 09/10 y el video de la cámara de hoy) y 7 `no_disponible` con `tipo_no_permitido` (los 6 de leads y el reel de hoy). **Desde el despliegue no entró ningún adjunto nuevo de un lead.**
- **`audit_log`:** el receptor registró `f6eba706` («contacto.creado», 15:18:12) en el espacio fantasma. Esa tabla no se borra (F31). Cuando «borrar» elimine el espacio, **las filas sin espacio del recuento van a pasar de 23 a 24 por esta prueba.**

**Despliegue J, `a02fa82`.** Push `01511a5..a02fa82`, `node scripts/verificar-despliegue.mjs`, salida 0: el build pasó de `KPbo3Qx8MHA76xlsORB8q` a `96QfJA7-DZg9527NP2Zml`, de 13:45:17 a 13:49:28, con `/login` en 200. Sin importación corriendo (leído a las 13:45:10).

**El reel compartido, con el diagnóstico nuevo (19/10/2026).** Marcos compartió un reel desde @marcospittimusic a @poderosascomunidad. Línea de base: 13:49:43. Fila leída a las 14:40:27, sin contenido:
- **`15d2ce4c`**, en la conversación `c6628c4e`. Entrante, `message_type` `video`, adjunto `video` según Zernio, **con dirección**. Llegó a las 14:39:51.
- Se intentó una vez (reclamo a las 14:39:58) y quedó **`no_disponible`** con `tipo_no_permitido|text/html|www.instagram.com|3c21444f43545950452068746d6c3e3c`.
- **Lectura:** los 16 bytes son `<!DOCTYPE html><`. La dirección de un reel compartido devuelve una página de `www.instagram.com`, no un archivo, y Zernio lo manda con el mismo tipo `video` que un video de verdad. **El detector hizo lo correcto: no es un formato que falte.**
- **Para los 6 rechazos del 13 al 18/10:** que sean reels compartidos pasa a ser la explicación más probable, porque llegaron con el mismo tipo y la misma clase de rechazo. **No está probado para esas 6 filas**: se rechazaron antes del diagnóstico, y su `media_error` dice solo `tipo_no_permitido`. Siguen sin tocarse.
- **Consecuencia visible, sin criterio y sin construir:** la bandeja muestra un reel compartido como «Este archivo no está disponible.», que es cierto pero no dice que es un reel. Es la misma familia que los `share` (§15 del plano, «los `share` de Instagram no se ven en la bandeja»), candidata para F35. No es de F28.

**Segunda tanda: un video grabado con la cámara del teléfono**, mandado por Marcos desde la galería a @poderosascomunidad. Fila leída a las 14:41:17, sin contenido:
- **`5017f220`**, en la conversación `c6628c4e`. Entrante, adjunto `video` según Zernio, con dirección. Llegó a las 14:40:42.
- **`descargado` en el primer intento** (reclamo 14:40:48): `video/mp4`, 593.738 bytes.
- **Es el control positivo del reel:** el mismo tipo según Zernio, el mismo canal y la misma hora, pero con un archivo de verdad detrás, se baja. Lo que separa los dos casos es lo que hay detrás de la dirección, no el tipo que manda Zernio.

**Los 13 históricos de @alomercadeo, puestos en marcha con la aprobación de Marcos.**
- **La escritura (19/10/2026 14:44:13):** `media_intentos` de nulo a 0, con la clave de servicio, en los 13 ids aprobados y con la condición `media_intentos is null`, sin tolerancia. Antes de escribir, el script comprobó que la lista del momento era exactamente la aprobada. PATCH 200, 13 filas escritas. Al releer, las 13 tenían intentos en 0 y estaban `pendiente`.
- **Recuento posterior (14:44:30):** 24 filas con intentos no nulos (9 + 13 + las 2 de la prueba de hoy), 0 trabadas, 4 objetos.
- **Las tomó la corrida de `vigilancia-cron` de las 14:50 y se cerraron las 13 en el primer intento.** Las horas son las de cada reclamo; la vigilancia de esta sesión las leyó cada minuto, sin contenido:

| id | tipo | resultado | `media_error` | intento 1 |
|---|---|---|---|---|
| `d6754c32` | image (17/06/2021) | `descargado`, `image/jpeg`, 103.259 bytes | — | 14:50:14 |
| `bc4a7309` | image | `descargado`, `image/jpeg`, 281.737 bytes | — | 14:50:15 |
| `9a064b31` | image | `descargado`, `image/jpeg`, 267.273 bytes | — | 14:50:17 |
| `a4c7136a` | video | `no_disponible` | `tipo_no_permitido\|text/html\|www.instagram.com\|3c21444f43545950452068746d6c3e3c` | 14:50:19 |
| `dbf27a0d` | video | `no_disponible` | ídem | 14:50:20 |
| `edf82bd9` | video | `no_disponible` | ídem | 14:50:21 |
| `ce22addc` | video | `no_disponible` | ídem | 14:50:22 |
| `b24d7cba` | video | `no_disponible` | ídem | 14:50:23 |
| `13b44e2c` | audio | `descargado`, `video/mp4`, 35.457 bytes | — | 14:50:25 |
| `90b96045` | video | `no_disponible` | ídem | 14:50:25 |
| `88f8ff46` | video | `no_disponible` | ídem | 14:50:27 |
| `7db24765` | video | `no_disponible` | ídem | 14:50:28 |
| `acf93c5f` | audio | `descargado`, `video/mp4`, 377.190 bytes | — | 14:50:29 |

- **Ninguna foto ni audio volvió con `text/html`.** Los 8 videos devolvieron una página de **`www.instagram.com`**, el mismo host y los mismos 16 bytes que el reel compartido de la prueba (`<!DOCTYPE html><`). Por la regla de Marcos, no se clasifica como reel solo por `text/html`, también por el host. **Que sean reels compartidos es inferencia fuerte, no está verificado:** no se leyó el contenido de esos mensajes.
- **Ninguna dirección vencida:** las 5 que traían un archivo se bajaron en el primer intento, incluida la foto de 2021. **Ningún histórico pasó por `fallido`**: los rechazos son definitivos y cierran en el primer intento. Esta corrida no suma un dato del reintento.
- **Corregido el 19/10/2026, a pedido de Marcos: Instagram sí tiene un segundo intento real, `27758899`** (la fila de los 6 rechazos). Se lo había anotado como dato del reintento a las 13:06 y después se dijo que Instagram no tenía ninguno: eso se contradecía.
  - Llegó el 17/10/2026 a las 09:51:17 (hora del proveedor). `media_intentos` 2. `media_reclamado_at`, el reclamo del último intento, 09:51:29. Quedó `no_disponible` con `tipo_no_permitido`.
  - **El primer intento falló sin cierre definitivo**, porque si no no habría habido un segundo. **Su error no se conoce:** `media_error` guarda solo el último.
  - **Lo que no encaja, leído el 19/10 sin contenido:** entre las 09:50 y las 09:55 de ese día hay un solo evento en `webhook_events`, recibido a las 09:51:28. El último reclamo es 1 segundo posterior. El reintento programado corre en los minutos :x0 y espera 2 minutos desde el último reclamo (`ESPERA_DEL_REINTENTO_MS`), así que **con esas horas el segundo intento no pudo ser del reintento programado**. Es una inferencia sobre el código y las horas.
  - **Quién hizo cada intento no se sabe.** Es un segundo intento real después de una falla abierta, pero no prueba que el reintento programado funcione.
- **Objetos en `message-media` después:** 9 (los 4 de las pruebas y los 5 históricos).
- **Los 5 bajados no se pueden ver en la bandeja, por un límite que no es de F28.** Dicho por Marcos con captura el 19/10/2026 hacia las 15:21: la lista llega hasta las conversaciones de las 15:24 de hoy y no tiene cómo ver más.
  - La bandeja carga **50 conversaciones** (`app/(dashboard)/dashboard/inbox/page.tsx:12`, `.limit(50)`, del fork), y el buscador filtra **solo entre esas 50**, en el navegador (`components/inbox/conversation-list.tsx:105-108`).
  - Además, `d6754c32` (la foto de 2021) tiene 200 mensajes posteriores en su conversación, y el hilo muestra los últimos 200 (`MENSAJES_POR_HILO`, `app/api/v1/messages/route.ts:11`).
  - **Anotado sin criterio y sin construir**, junto con «Ver mensajes anteriores»: llegar desde la bandeja a una conversación vieja no lo pide F28. Quién lo toma lo decide Marcos. **Decidido el 19/10/2026: es de F35**, con los criterios agregados ese día (la lista por páginas y la búsqueda en el servidor, y el hilo que deja cargar los mensajes anteriores a los últimos 200, hasta el primero guardado).
  - La confirmación de los 5 se pasa al panel de Storage, como el 09/10.
- **Confirmado por Marcos el 19/10/2026, en el panel de Storage de Supabase (bucket `message-media`):** se ven las tres fotos (`bc4a7309`, `9a064b31` y `d6754c32`) y se escuchan las dos notas de voz (`13b44e2c` y `acf93c5f`). Sin describir el contenido. Es la prueba de que lo guardado es un archivo de verdad del tipo esperado.
  - Para `d6754c32`, Storage dice «added on 10/19/2026»: es la fecha de subida (hoy, 14:50:14), no la del mensaje. La del mensaje, 17/06/2021, es la que dio Instagram y vive en `messages.created_at`.
  - Que la bandeja muestra un archivo bajado ya quedó visto el 09/10 con el mismo código. Para estos 5, en la bandeja no se vio, por el límite de 50 conversaciones.

**WhatsApp, el diseño reverificado contra el código (4a), 19/10/2026.** Es lectura de código público, sin ninguna llamada a Evolution. Clon de la etiqueta `2.3.7` con `--depth 1 --filter=blob:none`, fuera del repo: commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`, y `git ls-tree` da el blob `60e857fcc1206776575921c9060d05efdd7ff432`, el mismo de antes. `B` es `whatsapp.baileys.service.ts`.
- **Se confirma todo lo del diseño:**
  - la ruta (`index.router.ts:220`, `chat.router.ts:113`, 201 en `:121`);
  - el cuerpo `{ message, convertToMp4? }` (`chat.dto.ts:20-23`);
  - con el mensaje entero no consulta su base, y sin él responde «Message not found» (`B:3837-3845`);
  - la descarga con el pedido de volver a subir y su respaldo (`B:3899-3929`);
  - la respuesta con `base64` **sin prefijo** (`buffer.toString('base64')`, `B:3962-3970`);
  - cualquier error del servicio sale como `BadRequestException`, un 400.
- **Lo que el diseño no citaba:**
  - **El orden de los guards es `[instanceExistsGuard, instanceLoggedGuard, authGuard]`** (`index.router.ts:41`). Una instancia que no existe responde **404** («The "X" instance does not exist», `instance.guard.ts:36`) **antes de mirar la clave y antes de leer el cuerpo**.
  - El guard de la clave acepta la global (`auth.guard.ts:19-21`) o el token de esa instancia (`:28-34`).
  - El `mediaKey` del aviso llega como objeto indexado, porque `prepareMessage` lo deja como `Uint8Array` (`deserializeMessageBuffers`), y `getBase64FromMediaMessage` lo vuelve a convertir si es objeto (`typeof mediaKey === 'object'`). O sea que **devolverle el mensaje tal como vino en el aviso es la forma que el endpoint espera**.
  - `documentWithCaptionMessage` ya llega como `documentMessage` (`prepareMessage`, `B:4685-4689`).
- **Ningún motivo para otro camino.**
- **Anotado:** Evolution imprime el `messageRaw` entero en su propio log, con el `mediaKey` (`B:1481`, `console.log(messageRaw)`). Es el log del servicio de Evolution en Railway, no el nuestro.
- **Sin verificar, queda para la puesta en marcha:** que el pedido de volver a subir funcione con la `key` que Evolution reescribió (`remoteJid` pasado de `@lid` al teléfono, `B:1478-1479`).

**El token de la instancia, en la puesta en marcha (corrección 3 de Marcos).** Verificado en el código, no en producción y sin leer ningún secreto:
- `scripts/setup-evolution-channel.mjs` guarda el token que devuelve Evolution como `evolution_instance_token:<canal>` en el espacio del canal (paso 4, `:584-593`). Si ese paso falla, corta antes de activar el canal (`FalloDePaso`). Con `--borrar-instancia` lo borra (`:543-546`).
- No hay otra acción que dé de alta un canal de Evolution: ni la pantalla de Canales ni `lib/actions` crean instancias.
- Por eso, un canal creado con ese script termina con su token en Vault. El canal real `alomercadeo-ventas` existe y está activo (recuento de las 14:54). **Que su token esté en Vault no se verificó**: hacerlo pediría leer el nombre del secreto en Vault, y no se hizo.
- **`sin_clave` se reintenta, no es definitivo.** Es una falla de configuración que se corrige volviendo a guardar el token, y el archivo sigue disponible en los servidores de WhatsApp; si fuera definitivo, un token faltante perdería para siempre todos los archivos de esa ventana. Lo mismo vale para `sin_configurar` (falta `EVOLUTION_API_URL`). `sin_mensaje` sí es definitivo, porque sin el mensaje no hay con qué pedirlo.

**La marca del reintento en producción (5b), vista por Marcos el 19/10/2026, con captura, después de las 16:34 (la hora exacta no se anotó):** en Configuración › Vigilancia de canales, «Último reintento de archivos adjuntos: hace 3 min», sin rojo, con el mismo fondo que «Última revisión: hace 3 min».

**Criterios de F28, decididos por Marcos el 19/10/2026: se tildan el 2, el 5 y el 6. El 1, el 3 y el 4 quedan sin tildar.** Regla: un criterio que no nombra canal se tilda con los dos canales cubiertos. Cada tilde está en `docs/criterios-bajas.json` como reescrita, con su prueba por canal y sus límites, y la foto se reescribió con `node scripts/foto-criterios.mjs --escribir` (324 líneas, 0 faltantes sin explicar).
- **2. Bucket privado y direcciones firmadas.** Instagram, con datos reales y con el 5a con sesiones reales. WhatsApp, con el 5a sobre conversaciones de un canal de WhatsApp: **el archivo lo subió el script, y lo probado es quién lo ve.**
- **5. Si falla, queda marcado y se reintenta.**
  - WhatsApp, con el aviso firmado: la falla es **«instancia inexistente»** (404 antes de que Evolution lea el pedido). **El reintento programado se vio en producción con WhatsApp, y es código común.**
  - Instagram: **las fallas reales son definitivas**, y **el segundo intento de `27758899` no se sabe quién lo hizo.**
  - **Marcos vio «Este archivo no está disponible.» en la bandeja sobre el reel `15d2ce4c`.**
- **6. La descarga no bloquea el acuse.** Los dos tests con rotura a propósito, y los **151 ms** del aviso firmado entre la respuesta y el primer reclamo.
- **F28 queda «construida en parte», 3 de 6.** Los criterios **1, 3 y 4 se cumplen en la puesta en marcha del número**, con un archivo real de WhatsApp: foto, audio y video mandados al número vinculado, y la fila leída sin contenido.
  - **El dueño es la puesta en marcha.** La función que se prueba es `bytesDeEvolution` (`lib/adjuntos.ts`), y lo que la 4h no probó es **que Evolution acepte nuestro pedido** (ruta, cuerpo y `apikey`).
  - **F28 no puede completarse dentro del Bloque 3**: el número no se vincula hasta después de F32, del Bloque 4 (§4.7). **No es atraso del bloque.**
- **El avance sigue en 11 de 26.**

**Pendientes, anotados en este tramo:**
- **Puesta en marcha del número, para F28:**
  - mandar al número vinculado una foto, un audio y un video, y leer las filas sin contenido (criterios 1, 3 y 4);
  - verificar que el pedido de volver a subir funcione con la `key` que Evolution reescribe (`remoteJid` de `@lid` al teléfono, `B:1478-1479`);
  - comprobar, leyendo solo el nombre en Vault, que `evolution_instance_token:<canal>` del canal real `alomercadeo-ventas` existe. Sin él, todo termina en `sin_clave`.
- **Los 6 videos de leads del 13 al 18/10** siguen sin tocarse, con `tipo_no_permitido` sin diagnóstico. Lo más probable es que sean reels compartidos, por la misma clase de rechazo que los 8 históricos y el reel de prueba, pero no está probado. Si algún día se quiere el diagnóstico, reabrirlos es una escritura en producción aparte, con el OK de Marcos.
- **Instagram no tiene un reintento programado real visto:** las fallas reales de hoy fueron todas definitivas. El reintento es código común y quedó probado en producción con WhatsApp.
- **Los reels compartidos y la bandeja que no llega a conversaciones viejas:** anotados en §15 del plano, sin dueño y sin criterio.
- **`verificar-despliegue.mjs` espera 5 minutos**, y el despliegue de `f4469cc` tardó más: dio «no desplegado» y estaba bien. Si vuelve a pasar, se relee el build y se mira Railway, como hoy. No se cambió el plazo.
- **Los códigos de salida de los despliegues K y L y del push de la 00035 no se capturaron directo**, porque los comandos iban por un filtro. Los mensajes del script y los recuentos los sustituyen. En los próximos, el código de salida se lee sin filtro.
- **Anotado, sin arreglar:** el receptor de Evolution acusó el aviso de la 4h en 3.886 ms. Es un solo dato y no se investigó. El presupuesto de Evolution es de 30 segundos (`route.ts`, el comentario del acuse).

**`DATABASE_SAVE_DATA_NEW_MESSAGE` en nuestro Evolution: `true`**, dicho por Marcos el 19/10/2026 desde las variables del servicio «evolution» en Railway (sin cambiar nada). Queda para el registro: con ese valor, un reintento con solo la `key` también encontraría el mensaje en la base de Evolution. La recomendación de guardar el mensaje en `whatsapp_adjuntos_por_bajar` no depende de este valor, porque `docs/despliegue-evolution.md` deja abierta la decisión de apagar ese guardado.

**Fin del tramo 5: 19/10/2026 16:39:42**, leída antes de commitear el cierre. Suma: 230 min (3 h 50 min), de 12:48:47 a 16:39:42, sin cortes. Suma de la sesión 2: 803 min (13 h 23 min). La línea de base no cambió: no se agregó ningún criterio a F28.

---

## Sesión del 19 de octubre de 2026, tarde: Bloque 3, sesión 3 (F29, F30 y F41)

### Tramo 1: F41

**Inicio del tramo 1: 19/10/2026 17:01:56 de Costa Rica**, leída con `TZ=America/Costa_Rica date` antes de explorar para el plan. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `f3230a0`, comprobado con `git log`.

**El plan de la sesión, aprobado por Marcos el 19/10/2026:** F41 en este tramo; después F30 (antes que F29, porque la unión de F29 necesita que `fusionar_contactos` conozca `contact_notes`, y su búsqueda tiene que ignorar los contactos eliminados, que no existen hasta F30); F29 al final. El panel de la bandeja no lleva setter ni vendedor: §11 no lo pide (solo lo muestra el prototipo), corregido por Marcos al aprobar.

**Corte del tramo: la apertura (ítem 0), fuera de la medición.** Empezó a las 17:15:57.

- **Despliegue M, `f3230a0`** (el cierre del tramo 5, que no podía figurar en sí mismo). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: el build pasó de `QJjOVEKD_tV6Z5_OUUBv7` a `5XHPgg5DB0wUHvoayREdD`, de 16:40:15 a 16:44:04, con `/login` en 200.
- **Railway, dicho por Marcos con captura el 19/10/2026 a las 16:45:** ACTIVE «docs: cierre del tramo 5 de la sesión 2 del Bloque 3 (F28, part…», «4 minutes ago via GitHub», «Deployment successful». **Identificado por título** (`f3230a0`).
- **Criterios nuevos de F35, decididos por Marcos el 19/10/2026**, adelantando una de las decisiones de antes de S7: la lista de la bandeja por páginas desde el servidor con el total, la búsqueda y los filtros en el servidor sobre todo el alcance de quien mira, «Ver mensajes anteriores» hasta el primero guardado, y su control positivo con el token de un Member y de un Owner. **F35 es del Bloque 4: no toca la línea de base del Bloque 3.** No se construyen en esta sesión. La nota de F35 del 22/09/2026 ahora dice que se decidió; la nota de §15 del 19/10 («sin dueño: la bandeja no llega a las conversaciones viejas») se corrigió: no estaba sin dueño ni era nueva, remite a la nota de F35 y a los criterios nuevos, y la lista de contactos (tope de 100) queda como está, porque no es de la bandeja. Las dos líneas de este archivo que dejaban «Ver mensajes anteriores» como pendiente remiten al criterio nuevo.
- `node scripts/foto-criterios.mjs --escribir`: 0 faltantes, 4 apariciones nuevas (las altas), 328 líneas. Suite 743 de 743. Commit `8f94e46`.
- **Despliegue N, `8f94e46`** (la apertura). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: el build pasó de `5XHPgg5DB0wUHvoayREdD` a `V-i2zcza7MgTC1_Cqe4P8`, de 17:16:56 a 17:20:56, con `/login` en 200.
- **Fin del corte: 17:20:59.** El ítem 0 duró de 17:15:57 a 17:20:59 y no se cuenta. **El tramo se retoma a las 17:20:59.**

**Apartamiento deliberado del patrón «mutaciones de UI en acciones de servidor» del CLAUDE.md, aprobado por Marcos el 19/10/2026: la asignación de F41 se guarda con una ruta, `PATCH /api/v1/contacts/[contactId]/asignacion`, que el desplegable llama con `fetch`.**
- **Motivo:** el control positivo de F41 pide probar que asignar «desde el desplegable» cambia lo que el Member lee con su token. Con una ruta, `scripts/verify-asignacion.mjs` llama exactamente lo mismo que el desplegable, con la sesión real del Owner, igual que el 5a del tramo 5 con `GET /api/v1/messages`. **Inferencia, no verificada en la documentación de Next 16:** a una acción de servidor no se la puede llamar desde un script de forma confiable, porque su identificador cambia en cada build. El fork ya usa rutas para mutaciones de la interfaz (`POST /api/v1/messages`).
- **Lo que una ruta propia no trae sola, y cómo quedó (condición de Marcos):** las acciones de servidor traen un control de origen; una ruta no. **Verificado en el código el 19/10/2026**, qué impide que otro sitio dispare el PATCH con la cookie de un usuario logueado:
  - **La cookie de sesión va con `SameSite=Lax`.** `DEFAULT_COOKIE_OPTIONS` de `@supabase/ssr` 0.8.0 (`dist/main/utils/constants.js`), aplicado al escribir la sesión (`dist/main/cookies.js:325-329`); el proyecto no pasa `cookieOptions` en `lib/supabase/server.ts`, `middleware.ts` ni `client.ts`. Que el navegador no mande una cookie `Lax` en un PATCH de otro sitio es la definición del estándar, no algo medido acá. **No cubre un subdominio hermano** (`otro.alomercadeo.com` es el mismo sitio).
  - **Un PATCH de otro origen necesita una consulta previa (preflight), y nadie la autoriza.** La ruta no exporta `OPTIONS`, y Next 16.1.6 la contesta sola con 204 y solo el encabezado `Allow` (`next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`). En el repo no hay ningún `Access-Control-*` fuera de `node_modules`. Que sin `Access-Control-Allow-Origin` el navegador no mande el PATCH es el estándar Fetch, no algo medido acá.
  - **Había algo que lo impedía, y aun así se sumó un control de origen propio** (`origenPermitido`, `lib/asignacion.ts`), porque es barato y cubre el subdominio hermano: se acepta el origen de `NEXT_PUBLIC_APP_URL` o el que coincide con el host de la petición, y sin `Origin`, no. Sus tres tests de rechazo se vieron **en rojo** con la función devolviendo siempre `true`, y en verde después. La ruta lo aplica antes de mirar la sesión o la base (test de la ruta).

**F41, lo construido.** Migración 00036 (el `check` de acciones de `audit_log` con «contacto.asignado»). La ruta `PATCH /api/v1/contacts/[contactId]/asignacion` (`lib/asignacion.ts`, `lib/miembros.ts`), que escribe con el cliente del usuario (la RLS de la 00019 decide) y registra «contacto.asignado» con los ids en `changes` y los nombres de ese momento en `detail.nombres`. La pieza `components/contacts/asignacion-contacto.tsx` en la ficha, que F30 reubica sin reescribir. La lista de contactos filtra por setter y vendedor **en el servidor, antes del tope de 100**, con el total contado en la base («Se muestran 100 de N…») y la columna «Setter». **El tope de 100 no se tocó:** paginar la lista de contactos no es de F41 ni tiene dueño (nota de F35). El buscador de la lista sigue en el navegador, como venía del fork. El panel de la bandeja no lleva setter ni vendedor (§11 no lo pide).

**El verificador con sesiones reales, `scripts/verify-asignacion.mjs`, corrido contra producción antes del despliegue, autorizado por Marcos:**
- **Primera corrida, 17:41:54 a 17:42:00, salida 1: no concluyente, por un error del script.** El alta conjunta de los 104 contactos dio HTTP 400 antes del primer paso: la fila «propio» traía `setter_id` y las otras no (que PostgREST exija las mismas columnas en un alta conjunta es inferencia; el cuerpo del 400 no se guardó). La limpieza corrió y el recuento dio 0. **Recuento de las 17:43:36**, solo lectura y sin contenido, pedido por Marcos: usuarios `b3-asig-*` 0, los dos de la corrida 0, espacios 0 (2 en total, los de siempre), membresías 0, contactos `b3-asig-*` 0, `audit_log` sin espacio 24 (sin cambios). Arreglo: todas las filas con las mismas columnas, y el error con el cuerpo de la respuesta.
- **Segunda corrida, 17:43:47 a 17:44:01, salida 1, rojo por las razones correctas: 19 pasaron, 18 fallaron, 1 no concluyente.** Espacio `abfac2f2`, Owner `06b5abe2`, Member `3bdd127e`. **El control del principio pasó** (el Member lee su propio lead), y también «0 filas para X» antes de asignar. **Fallaron por la ruta** (todos los PATCH, HTTP 404: no existe en producción) y **por el filtro** (con «Setter: el Member» o «Vendedor: el Owner», X no aparece y el relleno sí; el título no dice «de 104»). No concluyente: «el Member deja de leer X», porque nunca se probó que lo leyera. **Pasaron sin probar nada antes del arreglo**, y no se leen como verde: el 404 del Member en el paso 9 (la ruta no existe), «X sigue igual» después de los rechazos (nada escribió), «Sin asignar» y «sin filtro, X no aparece» (la lista ignora el filtro). Limpieza y recuento posterior en 0, incluidos los 2 usuarios de Auth; `audit_log`: 0 filas nuevas.

**Antes de la 00036:** sin importación corriendo (`importacion_historial` libre, último ok el 08/10; leído a las 17:44:19). Recuento de las 17:44:19: 30 tablas, 35 migraciones (última 00035), `contacts` 654, `conversations` 654, `messages` 4003, `workspace_members` 2, `audit_log` 415 (24 sin espacio, 388 de «Ale Admin's Workspace», 3 de «Pruebas de correo»). `npx supabase db push --dry-run` a las 17:44:43, salida 0: solo la 00036.
**La 00036 en producción, con el OK de Marcos:** `npx supabase db push` de 17:46:54 a 17:46:58, **salida 0, leída directo**: aplicó solo la 00036. Recuento de las 17:47:07: 30 tablas, **36 migraciones (última 00036)**, y las mismas filas que antes (`contacts` 654, `conversations` 654, `messages` 4003, `workspace_members` 2, `audit_log` 415). El catálogo confirma que `audit_log_action_check` incluye «contacto.asignado».

**Despliegue O, `42efbd3`** (F41), inmediatamente después del push. Antes: suite 763 de 763, `typecheck` en cero, `npm run build` bien. `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: el build pasó de `V-i2zcza7MgTC1_Cqe4P8` a `i34eejBGd3RGf46o5Z_Of`, de 17:47:22 a 17:50:29, con `/login` en 200.

**Tercera corrida del verificador, después del despliegue: 17:50:32 a 17:50:50, salida 0, leída directo. 38 de 38, sin fallas ni no concluyentes.** Espacio `341155b8`, Owner `a55817c1`, Member `02d76ad1`, X `b54a2915`, «propio» `12b9513f`.
- **El control del principio pasó:** el Member lee «propio» con su token. Y no lee X sin asignar.
- **El Owner asigna X al Member como setter por la ruta del desplegable:** 200, en la base setter el Member y vendedor sin tocar, **y el Member lee X con su token** (control positivo). El vendedor se asigna sin tocar al setter.
- **La lista:** sin filtro carga y muestra el relleno más reciente (control), X no aparece (puesto 104) y el título dice «de 104 contactos». Con «Setter: el Member» aparecen X y «propio» y no el relleno; con «Vendedor: el Owner», X y no «propio»; con «Setter: Sin asignar», el relleno y no X.
- **Los rechazos, sin escribir:** otro origen 403, sin Origin 403, un id que no es del equipo 400, el Member que se quitaría X 403 con «dejarías de verlo»; X igual después de los cuatro.
- **El Owner le quita el setter:** 200, **el Member deja de leer X** (la presencia se probó en el paso 4), y sigue leyendo «propio». El Member sobre X, que ya no ve: 404, ahora desde la ruta, y X sigue sin setter.
- **Historial:** 3 filas «contacto.asignado», todas de X y del Owner (los rechazos no dejan fila): setter de nadie al Member con su nombre en `detail.nombres`, vendedor de nadie al Owner, setter del Member a nadie.
- **Limpieza y recuento posterior:** espacios, membresías, contactos y conversaciones en 0; los 2 usuarios de Auth no existen. **`audit_log`: 3 filas del espacio fantasma, que no se borran (F31).** Recuento de las 17:50:54: `audit_log` sin espacio **de 24 a 27** (total de 415 a 418), usuarios y contactos `b3-asig-*` 0, espacios 2, `contacts` 654, `workspace_members` 2.

**Lo que vio Marcos en producción, el 19/10/2026, con capturas, sin elegir nada:** la lista de contactos dice «Se muestran 100 de 654 contactos, los de interacción más reciente. Los filtros de setter y vendedor buscan en todos.»; con «Setter: Ale Admin», «0 contactos» y la lista vacía; en la ficha de @marcospittimusic, «Setter» y «Vendedor» en «Sin asignar», y el desplegable con «Sin asignar» y «Ale Admin», el único miembro. Recuento de las 17:55:23: 0 contactos reales asignados.

**La prueba del clic, decidida por Marcos, sobre @marcospittimusic** (su cuenta de prueba, no un lead; precedente del 08/10, el control de F25). **Es la única excepción de este tramo a «no se asigna ningún contacto real».** La hizo Marcos a mano en producción:
- En la ficha de «Marcos Pitti music» eligió Setter «Ale Admin» y apareció «Asignación guardada. Queda en el historial.». Después volvió a «Sin asignar», con el mismo aviso. Vendedor quedó en «Sin asignar» las dos veces.
- En Configuración › Historial de cambios vio dos eventos: «19 oct 17:58 · Ale Admin · Asignación cambiada: Marcos Pitti music · setter: sin asignar → Ale Admin» y «19 oct 17:59 · Ale Admin · Asignación cambiada: Marcos Pitti music · setter: Ale Admin → sin asignar».
- **Releído a las 18:02:08, sin contenido:** en «Ale Admin's Workspace» hay exactamente 2 filas «contacto.asignado», las dos del contacto `f2747f9b` y de «Ale Admin» (`9b341ca2`): **`e09fd41e`** a las 17:58:31, setter de nulo a `9b341ca2` (nombres: nadie → «Ale Admin»), y **`ccac15ce`** a las 17:59:30, setter de `9b341ca2` a nulo. Ninguna toca el vendedor. El setter y el vendedor de `f2747f9b` están en nulo, y no hay ningún contacto asignado en la base. **Esas 2 filas quedan para siempre en el historial real: `audit_log` no se borra (F31).**

**Criterios de F41, decididos por Marcos el 19/10/2026: se tildan los 7.** Cada tilde está en `docs/criterios-bajas.json` como reescrita, con su prueba y sus límites (el 2: la lista con 2 miembros no se vio en pantalla; el 5: el tope de 100 sin filtro sigue, avisado; el 7 suma el clic real de Marcos, que cubre el paso del desplegable a la ruta; el 4, los dos eventos que Marcos vio en Historial de cambios). `node scripts/foto-criterios.mjs --escribir`: 0 faltantes, 7 reescrituras, 328 líneas. **F41 pasa a completa. El avance pasa de 11 a 12 de 26.** En F31, «Registran entrada…» sigue sin tildar por F30, F34 y F37; la parte de F41 queda cubierta.

**Anotado para F30, sin arreglar: la ficha muestra la hora en UTC.** En la captura de Marcos, «Last active Oct 19, 2026, 08:40 PM» para @marcospittimusic, cuyo último entrante fue a las 20:40 UTC, 14:40 de Costa Rica. Inferencia: `formatDate` de la ficha del fork (`app/(dashboard)/dashboard/contacts/[contactId]/page.tsx`) corre en el servidor, que está en UTC. F30 rehace la ficha.

- **Anotado el 19/10/2026 y arreglado el mismo día, fuera de la medición (commit de las tareas chicas, abajo):** `scripts/recuento-base.mjs`, en «audit_log por acción», imprimía la etiqueta de la última fila de cada acción, y para «contacto.creado» esa etiqueta es el nombre de un lead real. Era contenido, en un recuento que se presenta como sin contenido. No se repitió en ningún registro. Ahora imprime solo la cantidad y la hora de la última (`scripts/recuento-auditoria.mjs`, con su test, visto en rojo antes del arreglo).

**Pendientes para el tramo 2:**
1. **F30, la base de las notas**, tal como se propuso el 19/10/2026 y Marcos decidió no arrancar ese día (no había margen, reescribe una función viva de producción y encadenaba dos despliegues antes de las 20:00):
   - **Migración 00037:** la tabla `contact_notes` (con `deleted_at`) y su RLS. Un Member lee y crea notas solo en los contactos de su alcance (`can_see_contact` de la 00019); edita o elimina solo el autor, un Admin o el Owner; Owner y Admin ven todas; las notas eliminadas no se listan.
   - **La misma 00037 suma las notas a `fusionar_contactos`** (la función entera, con la línea que pasa las notas del absorbido al que queda). Cierra la parte «notas» del criterio de F26. Hoy la fusión no falla por la tabla sino por filas: recorre las claves hacia `contacts` y corta si alguna fila sigue apuntando al absorbido (00031). **Condición de Marcos:** antes de reescribirla, leer su definición en producción con `pg_get_functiondef` (solo lectura) y mostrarle la diferencia con la nueva, que tiene que ser solo lo de las notas; los tests de fusión que ya existen pasan sin cambios.
   - **`scripts/verify-notas.mjs`**, en un espacio fantasma con sesiones reales, corrido **en rojo antes de aplicar la 00037**: el Member lee y crea notas en su lead y no en el ajeno; el Owner ve todas; el Member no edita la nota de otro y el Admin sí; una nota eliminada no se lista.
   - El criterio 2 de F30 se puede decidir con eso; el 1 queda a medias (la lista cronológica en la ficha es pantalla); el 8 y el 9 tocan también contactos y conversaciones.
2. **Decisión de Marcos, antes del borrado suave de F30: qué pasa si escribe un lead eliminado** (por ejemplo: se restaura solo, se crea un contacto nuevo, o el mensaje queda en una conversación que nadie ve). Hoy el receptor encuentra el contacto por su canal (`upsertContactForSender`) y no sabe de eliminados. **Decidido el 19/10/2026: se restaura solo** (ver «Tramo 2», apertura).
3. **F30, lo demás del plan aprobado:** la purga diaria como tarea de `lib/tareas-programadas.ts`, con marca por espacio en `tareas_estado`, que corre si la última buena fue hace más de 24 horas, borra antes los archivos de `message-media`, y se ve en Vigilancia de canales; los eventos editado, eliminado y restaurado en el historial (con su migración del `check`); la ficha en dos columnas con «Editar datos», que reubica `components/contacts/asignacion-contacto.tsx`; la hora de la ficha, que hoy sale en UTC; `deleted_at` de respuestas rápidas queda para F36.
4. **F29**, después de F30.

**Fin del tramo 1: 19/10/2026 18:14:48**, leída antes de commitear el cierre. Suma: 67 min (1 h 7 min; 67 min 50 s), de 17:01:56 a 18:14:48, **menos el corte del ítem 0, de 17:15:57 a 17:20:59 (5 min 2 s), que no se cuenta.** **Corregido el 19/10/2026, a pedido de Marcos: decía 68 min**, redondeado; los tramos anteriores truncan los segundos (el 4 dio 63 min 35 s y se anotó 63; el 5, 230 min 55 s y se anotó 230), y este también. F41 completa, 7 de 7. La línea de base no cambió: no se agregó ningún criterio a F29, F30 ni F41; las 4 altas del día son de F35, del Bloque 4.

**Después del cierre del tramo 1, fuera de la medición.**
- **Despliegue P, `8fe55a5` y `10d7b6b`** (F41 completa y el cierre del tramo 1). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: el build pasó de `i34eejBGd3RGf46o5Z_Of` a `mNK2VZA3AgEzgYeTxw5zR`, de 18:15:15 a 18:18:23, con `/login` en 200.
- **Tarea a, el recuento sin etiquetas: de 18:20:37 a 18:21:50.** `scripts/recuento-base.mjs` usa `scripts/recuento-auditoria.mjs` (la consulta y las líneas de «audit_log por acción»), que ya no pide `entity_label` ni la imprime. `scripts/recuento-auditoria.test.ts`: los dos tests se vieron en rojo con el código movido tal como estaba, y en verde después. El recuento real, corrido después (solo lectura, salida 0), imprime solo cantidades y la hora de la última.
- **Tarea b, la línea del CLAUDE.md: de 18:21:55 a 18:22:02.** En «Apertura y cierre de sesión»: la pantalla de Deployments de Railway no muestra hashes de commits, ni en ACTIVE ni en HISTORY; Marcos pasa el título del despliegue, se compara con `git log` y se anota como «identificado por título».
- **El despliegue de las dos tareas (`580f1ae` y el commit de la tarea b) se registra en la apertura del tramo 2:** no puede figurar en su propio commit.

### Tramo 2: F30 (y F29 si entra)

**Inicio del tramo 2: 20/10/2026 10:13:10 de Costa Rica**, leída con `TZ=America/Costa_Rica date` antes de explorar para el plan. `node scripts/commits-sin-subir.mjs`: «Sin commits sin subir contra origin/bloque-1-foundation»; último commit `e55d1d8`, comprobado con `git log`.

**Leído en producción antes de aprobar el plan (20/10/2026 10:40, solo lectura, `pg_policies`):** las 8 políticas de `contacts` y `conversations` son las de la 00019, con los mismos nombres y las mismas expresiones (`can_see_contact` y `can_see_conversation` para leer y editar; borrar, y crear conversaciones, solo manager; crear contactos, un Member solo asignado a sí mismo). Ninguna migración posterior las redefine.

**Corte del tramo: la apertura (ítem 0), fuera de la medición.** Empezó a las 10:47:19.

- **Despliegue Q, `580f1ae` y `e55d1d8`** (las dos tareas de después del cierre del tramo 1, que no podían figurar en sí mismas). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo con `echo $?`**: push `10d7b6b..e55d1d8`, el build pasó de `mNK2VZA3AgEzgYeTxw5zR` a `yrt0u_UZmO6XTEX5bLhrL`, de 18:22:09 a 18:25:50 del 19/10/2026, con `/login` en 200.
- **Railway, dicho por Marcos con captura el 19/10/2026 a las 18:36:** ACTIVE «docs(CLAUDE.md): Railway no muestra hashes; los desplieg…», «12 minutes ago via GitHub», «Deployment successful». **Identificado por título: `e55d1d8`.** El HISTORY no se ve en la captura.
- **Decisión de Marcos del 19/10/2026: si escribe un lead que está eliminado, dentro de los 30 días, el contacto se restaura solo**, con «contacto restaurado» en el historial y el mensaje en su conversación de siempre. **Motivo:** el lead que vuelve a escribir está activo; ocultar su mensaje es una bandeja silenciosa, y crear otro contacto rompe la deduplicación. Después de la purga entra como un contacto nuevo (la fila de su canal se fue con él). No es un criterio nuevo. **Autor de esa restauración en el historial: «Sistema»** (actor nulo), con `detalle.via = "mensaje_entrante"` y el canal: ninguna persona la hizo, y atribuírsela a quien lo eliminó o al Owner sería falso; es la misma convención que «contacto creado» por un aviso (`lib/inbox-sync.ts:162`; «Sistema» en `lib/auditoria.ts:88`). La importación del historial no restaura: no es el lead escribiendo ahora. Cierra el pendiente 2 del tramo 1.
- **Decisión de Marcos del 20/10/2026: eliminar y restaurar un contacto, solo Owner y Admin, aplicado en la base.** Es el permiso de borrado de la 00019 («contacts: borrar solo manager») llevado al borrado suave; no es un criterio nuevo. **La condición de Marcos:** con el borrado suave, eliminar y restaurar pasan a ser un `UPDATE` de `deleted_at`, y la política de edición de la 00019 le deja a un Member editar sus leads; un Member no puede cambiar `deleted_at` en `contacts` ni en `conversations` pidiéndolo directo a la base. **El mecanismo:** las políticas de edición de las dos tablas suman `deleted_at is null` en `using` y en `with check` (un Member que pide poner la fecha choca con el `with check`; uno que intenta restaurar no ve la fila), y eliminar y restaurar pasan solo por funciones `security definer` que exigen `is_workspace_manager`, como `fusionar_contactos`. Elegido por quedar en la misma capa que el resto del alcance, sin un mecanismo nuevo; los permisos por columna obligan a acordarse de cada columna nueva y se rompen en silencio. El Member ve «Eliminados» con sus leads (§11), sin «Restaurar». **La restauración automática no se afecta:** el receptor entra con la clave de servicio, que no pasa por la seguridad por filas. La prueba, con el token real de un Member en un espacio fantasma, va en el ítem 2.
- **Despliegue R, `2839faf`** (la apertura). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: push `e55d1d8..2839faf`, el build pasó de `yrt0u_UZmO6XTEX5bLhrL` a `CJ2ubR8ilo1Ra8VHEm2fw`, de 10:47:55 a 10:51:34, con `/login` en 200.
- **Fin del corte: 10:51:36.** El ítem 0 duró de 10:47:19 a 10:51:36 y no se cuenta. **El tramo se retoma a las 10:51:36.**

**Ítem 1, la base de las notas: de 10:51:36 a 11:49:38** (estimado: 75 min).
- **`fusionar_contactos` en producción, leída antes de reescribirla** (`pg_get_functiondef`, solo lectura, 10:52): el cuerpo es el de la 00031 sin cambios. La 00037 la reescribe entera, y la diferencia con producción es una sola línea, mostrada a Marcos: `update public.contact_notes set contact_id = v_c.id where contact_id = v_a.id;`.
- **La 00037** (`contact_notes` con borrado suave; leer y crear en el alcance de `can_see_contact`; editar el autor o un manager, nunca una eliminada ni dejándola eliminada; `eliminar_nota` para el autor, un Admin o el Owner; el autor y su nombre los pone la base, y desde la API solo cambia el texto). **Un error corregido antes de aplicarla:** el trigger de la nota estaba escrito `security definer`, y adentro de uno así `current_user` es el dueño y nunca `authenticated`, así que el control no habría funcionado; pasó a `security invoker`, con `etiqueta_propia()` para el nombre del autor.
- **`scripts/verify-notas.mjs` antes de la 00037, 10:55:20 a 10:55:29: salida 1, rojo por la razón correcta.** La tabla no existe (`PGRST205`) y el control del principio pasó (el Member lee su lead). Pasaron sin probar nada, y no se leen como verde: «el Member NO crea en un lead ajeno» y «no puede firmar a nombre del Owner» (cualquier pedido a una tabla inexistente da 404). Limpieza y recuento en 0.
- **Antes del push**, con el OK de Marcos condicionado a repetir las lecturas inmediatamente antes: a las 10:55, `importacion_historial` libre (último ok el 08/10), `--dry-run` con salida 0 y solo la 00037, y recuento (30 tablas, 36 migraciones, `contacts` 667, `conversations` 667, `messages` 4060, `audit_log` 433). **A las 11:36, `messages` dio 4062:** 2 filas de @alomercadeo, un entrante (el último, a las 11:18:15) y un saliente, en conversaciones existentes; contactos, conversaciones y `audit_log` iguales. Se frenó y se informó; **Marcos tomó el recuento de las 11:36 como el de antes**, y decidió que en esta sesión una diferencia en `messages` que sean solo entrantes y salientes de conversaciones existentes es tráfico del negocio: se informa y no frena; cualquier otra diferencia frena.
- **La 00037 en producción:** `npx supabase db push` de 11:39:28 a 11:39:32, **salida 0, leída directo**: aplicó solo la 00037. Recuento de las 11:39:35: **31 tablas, 37 migraciones (última 00037)**, y las mismas filas que a las 11:36 (`messages` 4062, `audit_log` 433); `contact_notes` 0.
- **Commit `07b1764`.** Suite 765 de 765, `typecheck` en cero.
- **Despliegue S, `07b1764`: no se desplegó.** `node scripts/verificar-despliegue.mjs`, **salida 1, leída directo**: push `2839faf..07b1764` a las 11:40:08, y en 5 minutos el build siguió en `CJ2ubR8ilo1Ra8VHEm2fw`; releído a las 11:45, 11:46, 11:47 y 11:48, igual. `npm run build` local, salida 0. **Causa, dicha por Marcos con captura a las 11:49:** Railway muestra «New builds are temporarily paused. We've found the cause and are working on a fix.» y, en Deployments del servicio, «Limited Access · Deploys have been paused temporarily». Es una pausa de la plataforma, no un fallo del commit. **Producción sigue en `2839faf` con la base en la 00037**: no rompe nada, porque ningún código desplegado lee `contact_notes`, y la fusión con la línea nueva se probó. **Condición de destrabe:** que Railway reanude los builds; entonces se confirma el despliegue con `verificar-despliegue.mjs` y el título en el historial. **Mientras tanto no se pushea la 00038:** va inmediatamente antes del despliegue del código que la usa.
- **`scripts/verify-notas.mjs` con la 00037 aplicada (corre contra la base y no depende del despliegue), 11:47:28 a 11:47:40: salida 0, leída directo, 43 de 43.** Espacio `017e1375`, Owner `0d71e329`, Admin `e6b932a1`, Member `cfa77f7b`. El control (el Member lee su lead); el Member crea en su lead, con autor y nombre puestos por la base, y no en uno ajeno (releído con la clave de servicio), ni firmando a nombre del Owner; el Owner sí crea en A. El Owner ve la nota de A y el Member no (presencia antes que ausencia); el Member ve las 2 de su lead; Owner y Admin ven las 3. El Member no edita la del Admin y sí la suya, no la mueve a otro contacto; el Admin edita la del Member. El Member no elimina la del Admin ni marca `deleted_at` a mano; elimina la suya por la función (listada antes, no listada después, ni para el Owner; la fila sigue con su fecha); el Admin elimina la del Owner; nadie restaura a mano. **La fusión pasa las notas:** F2 con una viva y una eliminada; el Owner une F2 en F1, las dos quedan en F1 (la eliminada también: si no, la guarda cortaba), F2 no existe, y en F1 se lista solo la viva. Limpieza y recuento en 0; 1 fila de `audit_log` (la fusión), que no se borra. **Cierra la parte «notas» del criterio de F26 sobre la fusión.**
- **`scripts/verify-identidad-canal.mjs` sin cambios, 11:47:48 a 11:48:00: 32 de 32, 0 fallaron** (las pruebas de fusión que ya existían, en su espacio fantasma). El código de salida no se leyó directo: se corrió con una tubería; el resultado sale del resumen del script.

**Ítem 2, el borrado suave: arranca a las 11:49:38** (estimado: 140 min).

**Railway, desde las 11:49: los builds pausados en toda la plataforma.** Dicho por Marcos el 20/10/2026, según status.railway.com: incidente desde las 11:03, builds pausados para todos desde las 11:18. `07b1764` se subió a las 11:40, durante la pausa. **Regla de Marcos mientras dure:** ningún `git push`, ningún `verificar-despliegue.mjs` y ningún `supabase db push`, porque lo subido queda en cola y se despliega solo cuando vuelve, sin que nadie lo mire, y el código del ítem 2 llama a funciones de la 00038. Los ítems 2, 3 y 4 se construyeron en local y van en un commit local cada uno, sin subir, con «[sin verificar en producción]» en el título.

- **Ítem 2, construido de 11:49:38 a 11:58** (la migración 00038 sin aplicar, la restauración automática, «Eliminar», «Eliminados» y `scripts/verify-borrado.mjs`). Tests unitarios de la restauración automática vistos en rojo con el código anterior y en verde después: WhatsApp (3 de 20 en rojo), el webhook de Instagram y los comentarios (2 de 7). **`verify-borrado.mjs` contra producción antes de la 00038**: primera corrida 11:56:59 a 11:57:11, salida 1, cortada por un error del script en el paso 6, que dejó **1 secreto de Vault huérfano** del espacio fantasma (`08ef0566`): el borrado del secreto estaba en el cuerpo y no en un `finally`. Contado (1) y borrado con `delete_secret` (recuento: 0); el script ahora lo borra en un `finally` y lo recuenta. Segunda corrida 11:57:50 a 11:58:10, salida 1, **rojo por las razones correctas: con las políticas de hoy el Member elimina (PATCH de `contacts.deleted_at`, HTTP 200) y restaura (HTTP 200, 1 fila) su propio lead pidiéndolo directo**, que es el riesgo que señaló Marcos; las funciones no existen (`PGRST202`) y `conversations.deleted_at` tampoco (HTTP 400). Los dos controles pasaron (el Member lee su lead, y edita otro dato). **El receptor de Zernio de producción aceptó el aviso firmado con el secreto del espacio fantasma** (HTTP 200) y guardó el mensaje: el camino de prueba de Instagram funciona sin tocar Zernio. Limpieza en 0, secretos incluidos.
- **Ítem 3, construido de 11:58:34 a 12:02** (`lib/purga.ts`, la tarea en `correrTareas`, la marca de 25 horas en Vigilancia, `scripts/verify-purga.mjs` en tres fases). La prueba real necesita el despliegue.
- **Ítem 4, construido de 12:02 a 12:11** (la ficha, la ruta de «Editar datos», `?conversacion=` en la bandeja, `scripts/verify-ficha.mjs`). **Dos defectos encontrados y corregidos antes de commitear:** (a) `npm run build` fallaba: `lib/ficha.ts`, que usan componentes de cliente, importaba `lib/auditoria.ts`, que usa el cliente de servicio; ni los tests ni `tsc` lo ven; la etiqueta del canal ahora la pasa la página. (b) En `verify-ficha.mjs`, «con `?conversacion=D`, D llega a la página» pasaba contra el código viejo: Next escribe en la página la dirección pedida con su parámetro, y el script buscaba el id suelto. Ahora cuenta solo el id que llega como dato (`"id":"…"`). **`verify-ficha.mjs` contra producción, corregido, 12:24:48 a 12:25:08: salida 1, leída directo, 28 pasaron y 30 fallaron**, entre ellos ese paso. Pasaron sin probar nada: el Member que no edita un lead ajeno (la ruta no existe) y la conversación ajena que no llega (el código viejo no la carga).
- **`verify-identidad-canal.mjs` vuelto a correr para leer la salida directo, 12:25:08 a 12:25:20: salida 0, 32 de 32.**
- **Los tres commits locales, sin subir**, cada foto probada sola antes de commitear (con el árbol idéntico al índice que se commiteó, no por checkout del commit): **`a11f402`** (ítem 2), build 0, `typecheck` 0, 778 de 778; **`db68408`** (ítem 3), build 0, `typecheck` 0, 787 de 787; **`fe22949`** (ítem 4), build 0, `typecheck` 0, 801 de 801. `lib/auditoria.ts` y la ficha las tocan el 2 y el 4: el commit del 2 lleva su versión intermedia. Respaldo del estado final antes de separar; comparado cada archivo contra `git show HEAD:<ruta>`: antes del commit del 4, 13 distintos (los 12 del 4 y este archivo) y 24 iguales; después, 36 iguales y solo este archivo distinto.
- **Ítem 5, F29, construido en local de 12:33 a 12:39, sin commitear** (decisión de Marcos: nada de F29 en los commits de los ítems 2 a 4). La migración 00039, sin aplicar: `buscar_contacto_entre_canales` (solo contactos vivos del espacio y solo si la coincidencia es única; teléfono y correo exactos vinculan, el usuario sugiere; solo la clave de servicio), la tabla `sugerencias_union` (se lee si se ven los dos contactos; sin escritura desde la API), `descartar_sugerencia`, «contacto.vinculado» en el `check`, y `fusionar_contactos` reescrita con una sola línea nueva contra la 00037: `delete from public.sugerencias_union where contacto_id = v_a.id or otro_id = v_a.id;` (la tabla tiene clave hacia `contacts`, y sin esto la guarda de la fusión cortaba). En el receptor (`lib/entre-canales.ts`): WhatsApp vincula un remitente nuevo por teléfono exacto, con su registro de canal y su propia conversación; Instagram deja la sugerencia «usuario» para un remitente nuevo (solo el webhook, no la importación); un conflicto de `reconciliar_telefono` en el camino automático deja la sugerencia «teléfono». En la bandeja, «¿Es la misma persona?» con «Ver y unir», la comparación lado a lado, «Unir contactos» (Owner y Admin) y «No es la misma», con los textos de §11. Tests unitarios del receptor de WhatsApp vistos en rojo con el receptor anterior (2 de 24) y en verde después. **`scripts/verify-entre-canales.mjs` contra producción antes de la 00039, 12:39:10 a 12:39:37: salida 1, leída directo, 20 pasaron, 15 fallaron y 1 no concluyente**, por las razones correctas (no vincula, no hay sugerencias, la función no existe). Pasaron sin probar nada: «L sigue sin resolver» (el receptor viejo tampoco escribe en un conflicto), la unión manual (sin la tabla nueva no hay qué mover) y «la búsqueda es solo del servidor» (la función no existe). Suite 811 de 811, `typecheck` en cero, build bien. El correo se prueba simulado, llamando la búsqueda directo en el espacio fantasma: ningún canal trae correo al llegar, y el dato real llega con F37.
- **Condición de destrabe de los commits locales, corregida por Marcos a las 13:10 con un dato de status.railway.com**, leído textual: «Deploys triggered during this period will need to be triggered again once we resume builds». **`07b1764` no está en cola y no se va a desplegar solo**, y no se despliega suelto ni se dispara a mano. **La condición es que Railway reanude los builds.** Después, en este orden: el protocolo de la 00038 (sin importación corriendo, recuento de contactos y conversaciones reales con `deleted_at` no nulo, `--dry-run`, recuento y OK de Marcos), el push de la 00038, y el push de `a11f402`, `db68408`, `fe22949`, `9ad442e`, `d97cec1` y `33c123d` juntos con `verificar-despliegue.mjs` y `echo $?`; ese build incluye a `07b1764`. Después, los verificadores en verde: `verify-borrado.mjs`, `verify-ficha.mjs`, `verify-purga.mjs` (sus tres fases), y **`verify-identidad-canal.mjs` y `verify-notas.mjs` (la fusión con notas)**, porque la 00038 cambia todas las políticas de `contacts` y `conversations` y la fusión con sesiones reales es la confirmación de que sacar las políticas de borrar no la afecta. (Antes decía que la condición era ver `07b1764` activo y que, si no aparecía a los 10 minutos, lo disparaba Marcos: superado por ese dato.)
- **Ensayo del protocolo de la 00038, sin escribir nada, 14:24:51 a 14:25:00 (pedido por Marcos mientras Railway sigue pausado; no reemplaza las lecturas de antes del push, que se repiten).** Contactos reales con `deleted_at` no nulo: 0 en los dos espacios («Ale Admin's Workspace» con 670 contactos y 670 conversaciones; a la mañana eran 667: leads nuevos). `conversations.deleted_at` todavía no existe (lo crea la 00038). Importación: ninguna corriendo. **`--dry-run`, salida 0, pero lista la 00038 Y la 00039**: el archivo de la 00039 (F29, sin commitear) está en la carpeta y el CLI aplica todo lo que encuentra. **Por eso, en el protocolo real: antes del push de la 00038, F29 se guarda aparte (respaldo y `git stash -u`, con los archivos nuevos; un `git stash` común dejaría la 00039 en la carpeta), y el `--dry-run` tiene que listar solo la 00038**, que sigue siendo la comprobación. La 00039 va después, con F29 commiteado y su propio protocolo.
- **Borrador para el cierre: los criterios de F30 y F29, con la prueba que los cubriría y lo que falta (14:26).** Ninguno se tilda sin que Marcos lo decida. «Falta» es lo mínimo para poder decidirlo.
  - **F30.** (1) Notas con lista cronológica y permisos: la base, probada (`verify-notas`, 43 de 43); falta la lista en la ficha desplegada (`verify-ficha`, la nota en el HTML), y el clic en pantalla si Marcos lo decide. (2) La seguridad por filas de las notas: **probada contra producción** (`verify-notas`, con el token del Member y del Owner); se puede decidir hoy. (3) Ficha completa y (4) todos los datos: falta `verify-ficha` en verde y la lectura de Marcos sobre @marcospittimusic; «No contactar» con el dato puesto a mano en el espacio fantasma (lo escribe F34). (5) Editar todos los datos: falta `verify-ficha` (la ruta con sesiones reales). (6) Clic al hilo: falta `verify-ficha` (incluida la conversación más abajo de las 50, con el Member). (7) Marcas: falta `verify-ficha`. (8) `deleted_at` en contactos, notas, conversaciones y respuestas rápidas: **no se completa en esta sesión**, porque respuestas rápidas no existe hasta F36; lo demás, con `verify-borrado` y `verify-notas`. (9) Listados y seguridad excluyen lo eliminado: falta `verify-borrado` en verde. (10) La purga diaria: falta `verify-purga` en sus tres fases, con la tarea real. (11) El historial no se purga: falta `verify-purga` (el recuento antes y después, y las filas del purgado siguen).
  - **F29.** (1) La búsqueda al llegar: teléfono con aviso firmado y `whatsapp_phone` (falta `verify-entre-canales`); correo y correo secundario, simulados (ningún canal trae correo al llegar; el dato real llega con F37); usuario, con aviso firmado de Zernio en una segunda cuenta fantasma. (2) Vincula sola por teléfono o correo: teléfono con aviso firmado, correo simulado. (3) El usuario sugiere, no une: aviso firmado y la pantalla. (4) El registro de canal y (5) las conversaciones separadas: aviso firmado. (6) La ficha agrupada por canal: `verify-ficha` (el HTML de la ficha con dos canales). (7) Las vinculaciones en el historial: aviso firmado («vinculado») y la unión manual con sesión real («unidos»). **Todo F29 espera:** el commit de F29, la 00039 con su protocolo y el despliegue. La llegada real de WhatsApp, en la puesta en marcha del número.
  - **Si Railway no vuelve antes de que Marcos cierre** (cambiado por Marcos el 20/10/2026; antes decía que se deshacían los commits con `git reset`): **NO se deshacen los commits.** `a11f402` a `33c123d` quedan como están, y F29 se commitea como un commit local más, con «[sin verificar en producción]», sin subir nada. **Motivo de Marcos:** deshacerlos deja toda la sesión como archivos sueltos y mezclados, y separarlos por ítem es justo lo que hoy costó conflictos y un stash perdido. La compuerta de un día (`scripts/compuerta-cierre.test.ts`) va a poner la suite en rojo mañana: es la señal esperada, no un error. **La primera línea del pendiente para la próxima sesión dice que nada se sube antes del push de la 00038.** La 00037 sigue aplicada en producción con su verificador en verde. El avance queda en 12 de 26.
- **Cuarto corte por la espera de Railway: desde las 14:25:48**, acordado con Marcos, que vuelve cuando Railway reanude los builds (la hora de vuelta se anota al retomar). Lo trabajado desde el tercer corte va de 13:52:26 a 14:25:48, sin hueco: la revisión de errores y sus arreglos, el ensayo del protocolo y el borrador del cierre. **Al retomar, en este orden:** confirmar que Railway reanudó; guardar F29 aparte con **`git stash -u`** (con los archivos nuevos: un `git stash` común deja la 00039 en la carpeta y el push la aplicaría; corregido por Marcos el 20/10/2026); el protocolo de la 00038 (importación, recuento de reales con `deleted_at`, `--dry-run` con solo la 00038, recuento) y el OK de Marcos; el push de la 00038; el push de `a11f402` a `33c123d` con `verificar-despliegue.mjs`; los verificadores en verde; después F29 con la 00039.
- **Railway volvió. Fin del cuarto corte: 15:07:45** (de 14:25:48 a 15:07:45, que no se cuenta). **Dicho por Marcos con captura de status.railway.com a las 15:06:** el incidente figura «Resolved» a las 20:56 UTC (14:56 de Costa Rica), textual: «Builds have resumed for all workspaces and are completing normally.» y «If you triggered a deploy, pushed to GitHub, or restarted a service while builds were paused, please trigger it again. Those were not queued during the pause and will not start on their own. Cron jobs scheduled during the pause did not run, and will continue from their next scheduled time.» **Corregido el 20/10/2026 con el registro de Railway: no hubo hueco. «vigilancia-cron» corrió cada 10 minutos durante toda la pausa, sin saltear ninguna.** **La prueba, el registro del servicio en Railway (Deploy Logs, horas de Costa Rica), capturas de Marcos a las 16:04 y 16:08:** corridas a las 11:01:26, 11:10:31, 11:20:57, 11:30:54, 11:40:39, 11:51:54, 12:00:59, 12:10:32, 12:21:16, 12:30:59, 12:40:43, 12:51:27, 13:00:50, 13:11:46, 13:22:13, 13:30:46, 13:42:14, 13:50:18, 14:02:06, 14:12:00, 14:21:45, 14:31:12, 14:42:07, 14:51:21, 15:02:06, 15:10:59, 15:20:55, 15:31:49, 15:41:03, 15:51:38 y 16:01:52, todas con «fallidas: 0» (las de antes de las 15:31 con «espacios: 2 fallidas: 0 ocupadas: 0 adjuntos: ok», cada una con su «Starting Container» unos 20 segundos antes). Las de 15:10:59 y 15:20:55 no traen «purgas» (código viejo); desde la de 15:31:49, sí («purgas.ok: 2», después 1, 1 y 0). **Las de 14:31, 14:42 y 14:51 corrieron antes de que Railway diera el incidente por resuelto (14:56).** La frase de Railway sobre los cron («Cron jobs scheduled during the pause did not run…») no aplicó a este servicio; inferencia de Marcos: el cron arranca el contenedor ya desplegado y no necesita un build. **La causa del error:** la conclusión salió de dos lecturas que no podían mostrar corridas durante la pausa: la frase de Railway, que es general, y `tareas_estado`, que guarda solo la última corrida de cada tarea y espacio, así que cada corrida pisa la anterior y la de las 15:01 tapaba todas las de antes. Una ausencia en un lugar que no puede mostrar la presencia no prueba nada. **Antes decía:** «Consecuencia: «vigilancia-cron» no corrió durante la pausa. Leído en `tareas_estado` a las 15:07:45, solo las marcas: la primera corrida que se ve después del incidente es la de las 15:01:43 (vigilancia de «Ale Admin's Workspace», ok a las 15:01:44; «Pruebas de correo», 15:01:45; el reintento de adjuntos, 15:01:46; las tres sin error). El principio del hueco no se puede leer en la base: `tareas_estado` guarda solo la última marca de cada tarea, no las corridas anteriores. Lo que la base sí dice es que el hueco terminó a las 15:01:43.»
- **Después de la vuelta de Railway (desde las 15:07:45).**
  - **F29 guardado aparte** con `git stash -u` (16 archivos, con respaldo). **Protocolo de la 00038, 15:08:13 a 15:08:30:** importación libre; 0 contactos reales con `deleted_at`; `--dry-run` con **salida 0, leída directo**, y **solo la 00038**; recuento de antes: 31 tablas, 37 migraciones (última 00037), `contacts` 671, `conversations` 671, `contact_channels` 657, `messages` 4070, `audit_log` 448 (38 sin espacio, 407 de «Ale Admin's Workspace», 3 de «Pruebas de correo»). Diferencias con las 11:39, informadas a Marcos: 4 leads nuevos (`contacts`, `conversations` y `contact_channels`, +4 cada uno, y +4 «contacto creado» en el espacio real), y 11 filas de historial sin espacio de los verificadores. **Marcos decidió para el resto de la sesión:** no frenan y se informan (a) entrantes y salientes en conversaciones existentes, (b) contactos nuevos si suben igual `contacts`, `conversations` y `contact_channels` y el historial suma los mismos «contacto creado» en el espacio real, (c) filas de historial sin espacio de los verificadores, contadas por verificador; cualquier otra diferencia, o una que no cuadre así, frena.
  - **La 00038 en producción, con el OK de Marcos:** `npx supabase db push` de 15:15:44 a 15:15:48, **salida 0, leída directo**, aplicó solo la 00038. Recuento de las 15:15:53: 31 tablas, **38 migraciones (última 00038)**, las mismas filas. En el catálogo: 0 políticas de borrar en `contacts` y `conversations`, 0 conversaciones eliminadas, y el `check` de `audit_log` con «contacto.restaurado».
  - **Despliegue T, `a11f402` a `53a25b8`** (los ítems 2, 3 y 4, el saliente, el DELETE, la revisión y los commits del estado; incluye `07b1764`). `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: push `07b1764..53a25b8` a las 15:16:21, el build pasó de `CJ2ubR8ilo1Ra8VHEm2fw` a `ESpoYdg7TDcW3DWlZMkym` a las 15:20:33, `/login` en 200. **La ventana entre la 00038 y el código que la usa: de 15:15:48 a 15:20:33.**
  - **Los verificadores contra producción** (las filas de historial sin espacio, contadas antes y después de cada uno, son todas de los verificadores):
    - `verify-borrado.mjs`, 15:20:48 a 15:21:17: **salida 0, 73 de 73**. Historial sin espacio de 38 a 50 (12: L 3 eliminado y 3 restaurado, I 2 y 2, J 1 y B 1).
    - `verify-ficha.mjs`, 15:21:28 a 15:21:51: **salida 1, 60 pasaron y 2 fallaron**: el campo propio y su valor no aparecían. Sin espacio de 50 a 53.
    - `verify-identidad-canal.mjs`, 15:22:29 a 15:22:43: **salida 0, 32 de 32** (la fusión con sesiones reales, después de la 00038). Sin espacio de 53 a 56.
    - `verify-notas.mjs`, hasta las 15:22:58: **salida 0, 43 de 43** (la fusión con notas). Sin espacio de 56 a 57.
  - **El error de `field_type`.** La columna de `custom_field_definitions` es `type` (00001:100). **La ficha pedía `custom_field_definitions(name, slug, field_type)`** (venía así del fork y se mantuvo sin revisar): la consulta fallaba entera y la ficha no mostraba ningún campo propio en ningún contacto. **Y el script creaba el campo con el mismo nombre equivocado**, sin comprobar que se creara. Primero se corrigió solo el script (`type`, y corta si no puede crear el campo) y se corrió contra la ficha de producción, 15:23:17 a 15:23:38: **salida 1, falla solo por la ficha** (60 pasaron, 2 fallaron); sin espacio de 57 a 60. **`lib/types/database.ts` dice `type`, y se mantiene a mano** (no hay script de generación en `package.json`, importa `Platform` de `lib/platforms`, y hoy se le sumaron tablas a mano): por eso el test nuevo, `lib/ficha-consultas.test.ts`, compara contra la 00001, no contra ese archivo; visto en rojo. **La revisión de todas las consultas escritas hoy contra las migraciones**, pedida por Marcos antes del push: un analizador (en el scratchpad) que saca las columnas de las migraciones 00001 a 00039 (la 00039 leída del stash) y recorre las consultas de supabase-js y de PostgREST de los 36 archivos de F30 y los 13 de F29 (266 consultas). Marcó 20 líneas, revisadas a mano una por una: **un solo error real, `field_type`** (la ficha y el script); **en F29, ninguno**; el resto, falsos positivos (`webhook_events` y `workspaces.webhook_secret`, creadas o agregadas en mayúsculas en la 00012 y la 00011; claves adentro de columnas JSON: `mensaje` de `whatsapp_adjuntos_por_bajar`, `metadata` de `analytics_events`, `resultado` de `tareas_estado`; un comentario dentro de un objeto). Límites: no lee argumentos de `rpc` ni consultas armadas con texto variable. **Arreglo, commit `d54f159`**: la ficha pide `type`; suite 816 de 816, `typecheck` 0, build 0.
  - **Despliegue U, `d54f159`.** `node scripts/verificar-despliegue.mjs`, **salida 0, leída directo**: push `53a25b8..d54f159` a las 15:30:45, el build pasó de `ESpoYdg7TDcW3DWlZMkym` a `WyFTxZWGFWgliuMZJz9dn` a las 15:35:48, `/login` en 200. **`verify-ficha.mjs` después, 15:35:57 a 15:36:18: salida 0, leída directo, 62 de 62.** Sin espacio de 60 a 63.
  - **La purga real en los espacios reales**, leída a las 15:36:30: corrió a las 15:31:31 («Ale Admin's Workspace») y 15:31:33 («Pruebas de correo»), sin error, con 0 contactos, 0 conversaciones, 0 notas y 0 archivos; en la base hay 0 contactos, 0 conversaciones y 0 notas eliminados.
  - **`verify-purga.mjs`.** «Preparar», 15:36:45 a 15:36:54: **salida 0, 9 de 9**; espacio fantasma `333cce4a`; presencia de todo lo que se mira después; las 5 filas a retroceder mostradas a Marcos; `audit_log` 475 en total, 2 del espacio fantasma (448 de las 15:15, más 25 sin espacio de los verificadores, más estas 2: el espacio real no cambió). **«Retroceder», con el OK de Marcos, 15:44:18 a 15:44:21: salida 0, 11 de 11**: X `ce4e6637` y su conversación `adc1bd6f` a hace 31 días, Y `923a5321` y `7604ec90` a hace 29, la nota de Z `3375fc89` a hace 31, releídas; se borró 1 marca de purga del espacio fantasma (el cron había pasado por él a las 15:41). **«Comprobar», 15:44:42 a 15:51:48: salida 0, 26 de 26.** La tarea real purgó el espacio fantasma a las 15:51:22 (1 contacto, 1 conversación, 1 nota suelta, 1 archivo); X, su conversación, su mensaje, su fila de canal, su nota y su PNG en `message-media` ya no existen; Y (29 días), su mensaje y su PNG siguen; Z y su nota viva siguen; la nota de Z de 31 días se fue. `audit_log` 475 antes y 475 después, y la fila «eliminado» de X sigue. Limpieza en 0, Storage incluido. Sin espacio de 63 a 65 (las 2 de este verificador).
  - **Las corridas del cron después de las 14:56, corregido el 20/10/2026: no faltó ninguna.** El registro de «vigilancia-cron» en Railway muestra las de 15:02:06, 15:10:59, 15:20:55, 15:31:49, 15:41:03, 15:51:38 y 16:01:52, todas con «fallidas: 0» (ver arriba, en la vuelta de Railway). Lo de «faltan las de las 15:11 y las 15:21» salió de `tareas_estado`, que guarda solo la última corrida por tarea y espacio y no podía mostrar las del medio. La marca de la purga en las 15:31 y no en las 15:21 se explica porque la de las 15:20:55 todavía corrió el código viejo, sin purga (el registro no trae «purgas» en esa corrida). **Antes decía:** «Las corridas del cron después de las 14:56, según las marcas de `tareas_estado` (guarda solo la última de cada tarea, así que solo se ven las que se leyeron en el momento): 15:01:43, 15:31:28, 15:40:36 y 15:51:22 (la de la purga fantasma). Faltan las de las 15:11 y las 15:21: corridas que faltan, con la causa sin confirmar. Indicio, inferencia: si a las 15:21 hubiera corrido el build de `53a25b8` (activo desde las 15:20:33), la marca de la purga diría 15:21 y no 15:31; encaja con que haya empezado antes del cambio de build o con que no haya ocurrido. La de las 15:11 no tiene rastro, y no hay despliegue que la explique (`53a25b8` se subió a las 15:16). Las mira Marcos en el registro de «vigilancia-cron» en Railway. Dicho por Marcos: el cron corrió a las 15:31, 15:40 y 15:51 sin saltear ninguna, así que hoy está sano.»
- **F29 en producción.** `fusionar_contactos` leída en producción (`pg_get_functiondef`, solo lectura) antes del push, como pidió Marcos (la diferencia anterior había salido del archivo de la 00037): contra la de la 00039, una sola línea, la de las sugerencias. **La 00039, con el OK de Marcos:** `npx supabase db push` de 16:07:36 a 16:07:40, **salida 0, leída directo**, solo la 00039 (protocolo de las 16:02: importación libre, `--dry-run` con salida 0 y solo la 00039, recuento: 31 tablas, 38 migraciones, `contacts` 671, `conversations` 671, `contact_channels` 657, `messages` 4070, `audit_log` 475 con 65 sin espacio; desde las 15:15, el espacio real sin cambios y 27 filas sin espacio de los verificadores: `verify-borrado` 12, `verify-ficha` 9, `verify-identidad-canal` 3, `verify-notas` 1, `verify-purga` 2). Recuento de después: **32 tablas, 39 migraciones (última 00039)**, las mismas filas. §14c actualizado para la 00038 y la 00039 (todavía decía «escritas, sin aplicar»). **Despliegue V, `3e0cb9d` y `76e081f`:** `verificar-despliegue.mjs`, **salida 0, leída directo**, push `d54f159..76e081f` a las 16:08:01, el build pasó de `WyFTxZWGFWgliuMZJz9dn` a `drj3YU9bHQL34Ye1L2g0x` a las 16:11:09, `/login` en 200. **Verificadores después:** `verify-entre-canales.mjs`, 16:11:17 a 16:11:50, **salida 0, 45 de 45** (sin espacio de 65 a 73: 3 «vinculado» de P, W y E, «eliminado» y «restaurado» de E, 2 «creado» y 1 «fusionado»); `verify-notas.mjs`, 16:11:53 a 16:12:08, **salida 0, 43 de 43** (de 73 a 74); `verify-identidad-canal.mjs`, 16:12:12 a 16:12:25, **salida 0, 32 de 32** (de 74 a 77).
- **Lecturas de Marcos en producción, solo lectura, con capturas.** **16:03:** en Contactos, buscando «marcos pitti», dos «Marcos Pitti music» («Yesterday» y «4d ago», los dos «Sin asignar»). La ficha del de «Yesterday»: dos columnas; Correo, Correo secundario, Teléfono, País, Etiquetas y Campos propios con «—»; Redes «Instagram: @marcospittimusic»; Setter y Vendedor «Sin asignar»; Temperatura «Sin definir»; Próximo seguimiento «Sin fecha»; Origen primer y último clic «Sin datos»; Última interacción «19 oct 2026, 14:40»; «Editar datos» y «Eliminar». Conversaciones: «Instagram @poderosascomunidad», «Abierta», «19 oct 2026, 14:40», «Sin mensajes». Notas vacías con «Guardar nota». Historial: 19 oct 17:59 y 17:58 (las asignaciones de F41) y 8 oct 12:25 «Sistema · Contacto creado (Instagram)». Horas de Costa Rica. **16:10:** el clic en la conversación de la ficha abre el hilo en la bandeja (**la prueba en pantalla del criterio 6 de F30**). La ficha del de «4d ago»: los mismos datos en «—» o «Sin asignar», Redes «Instagram: @marcospittimusic», Última interacción «16 oct 2026, 09:22»; Conversaciones «Instagram @alomercadeo», «Abierta», «16 oct 2026, 09:22», y de resumen un emoji; Historial «Todavía no hay cambios registrados.».
- **Las revisiones de esas lecturas, solo ids, cantidades, fechas y tipos, autorizadas por Marcos (16:12 a 16:13):** son un contacto por cada cuenta de Instagram del negocio, con el mismo usuario y remitentes distintos (comparados por huella md5, sin mostrar el identificador): `546574a4` (@alomercadeo, alta 22/09/2026 13:40, conversación `5cfaf8a4` con 31 mensajes, el último de texto) y `f2747f9b` (@poderosascomunidad, alta 08/10/2026 12:25, conversación `c6628c4e` con 18 mensajes, el último un video sin texto, entrante). No se tocó ninguno. **El historial vacío de `546574a4` es correcto:** se dio de alta antes del historial de F31 (07/10). **«Sin mensajes» era falso:** el resumen guardado de `c6628c4e` es un texto vacío (un video sin texto), y la ficha mostraba «Sin mensajes» con cualquier resumen vacío. **Arreglado como parte del criterio 3, commit `fbf4402`:** si el resumen está vacío, la ficha muestra el tipo del último mensaje («Video», «Foto», «Audio», «Adjunto» para uno sin tipo), y «Sin mensajes» solo si no hay ninguno. Test visto en rojo; `verify-ficha.mjs` suma el caso, visto en rojo contra producción a las 16:14:03 (salida 1, 62 pasaron, 1 falló; sin espacio de 77 a 80). **Despliegue W, `fbf4402`:** **salida 0, leída directo**, push `76e081f..fbf4402` a las 16:14:39, el build pasó de `drj3YU9bHQL34Ye1L2g0x` a `ahTtp3qmrYpBMxYohvgu9` a las 16:18:51. **`verify-ficha.mjs` después, 16:18:58 a 16:19:20: salida 0, 63 de 63** (sin espacio de 80 a 83). **El duplicado de Marcos, anotado en §15 del plano** como candidato antes de S7, sin construir.
- **La estimación de la sesión 3, escrita por Marcos en el arranque del 19/10/2026 y no en el repo hasta hoy** (fuente: Marcos, 20/10/2026): **F30, entre 4 y 6 horas; F29, entre 2 y 3**, armada con lo medido en las sesiones 1 y 2. Se anota para cerrar la tabla del bloque contra ella.
- **Pruebas pedidas por Marcos antes de decidir los criterios (16:32 a 16:34).** (1) **F30 #1, el orden de las notas:** `verify-ficha.mjs` suma una segunda nota, más nueva (con horas distintas comprobadas en la base), y compara su posición en el HTML de la ficha: la más nueva arriba (orden por fecha, descendente). Con la expectativa invertida a propósito (`INVERTIR_ORDEN=1`), 16:33:31 a 16:33:59: **salida 1**, falla ese chequeo; con la correcta, 16:34:03 a 16:34:28: **salida 0, 64 de 64**. El sentido del orden (la más nueva arriba) queda para que lo confirme Marcos. (2) **F29 #1 y #3 con el fixture real de Zernio:** los avisos de Instagram de `verify-entre-canales.mjs` se arman ahora desde `lib/fixtures/zernio-webhook-message-received.json` (una entrega real del log de Zernio, 08/10/2026, anonimizada, con las igualdades del original). Cambiado del fixture, y nada más: `id` (único por entrega: idempotencia y limpieza), `account.id` (el canal fantasma), `message.sender.id` y `conversation.participantId` (el remitente nuevo, iguales entre sí), `message.sender.username` y `conversation.participantUsername` (el usuario que coincide con Q, iguales entre sí) y `message.platformMessageId` (único). 16:32:38 a 16:33:07: **salida 0, 45 de 45**; sin espacio de 83 a 91 (8). Las corridas de `verify-ficha` de esta prueba dejaron 3 cada una (de 91 a 97).
- **F29 #3, el bloque «¿Es la misma persona?» en pantalla (forma 2, elegida por Marcos con cambios).** El bloque se arma en el navegador (`components/inbox/sugerencia-union.tsx`, una acción de servidor en un `useEffect`), así que no llega en el HTML; la forma 1 (traerla desde el servidor con `?conversacion=`) la descartó Marcos porque el operador abre las conversaciones desde la lista y el verificador probaría otro camino. **`sugerenciasDe` lee con el cliente del usuario**, no con la clave de servicio: `contexto.supabase` (`lib/actions/contactos.ts:159-163`), de `resolveWorkspace` (`lib/workspace.ts:36`), que es `createClient` de `lib/supabase/server.ts` con la clave anónima y las cookies (líneas 6 a 12); los resúmenes también (`:50-53`). **La parte del Member queda cubierta por la prueba con token de `verify-entre-canales.mjs`** («el Member, sin esos leads, no la lee», 16:32). `sugerencias_union` no tiene triggers (0 en el catálogo): escribir o borrar la fila no toca `audit_log`. **Con el OK de Marcos, una fila en el espacio real, con la clave de servicio, a las 16:43:15** (HTTP 201): `effc7822`, espacio `e8f4f678`, contacto `f2747f9b` (@poderosascomunidad), otro `546574a4` (@alomercadeo), usuario, pendiente; antes, 0 filas para el par. **Captura de Marcos** de la conversación de @poderosascomunidad: el panel muestra «¿Es la misma persona?», «"Marcos Pitti music" tiene el mismo usuario (@marcospittimusic) en otro canal. Coincide solo el usuario, así que no se unen solas.», «Ver y unir» y «No es la misma». Nadie apretó «No es la misma» ni «Unir contactos» (los dos contactos son la misma persona, y descartarla dejaría el par marcado para siempre). **Borrada con la clave de servicio a las 16:44:43** (HTTP 200, 1 fila; antes de borrarla seguía pendiente), **releído: 0 filas para el par**; `audit_log` 507 antes y después del borrado (475 de las 16:02 más 32 sin espacio de los verificadores: el espacio real no cambió).
- **La prueba real de F29 #1 y #3 con @theconsultour, propuesta por Marcos, no se hizo.** Condición: un contacto con ese usuario en el canal de @alomercadeo y ninguno en el de @poderosascomunidad. Buscado solo ese usuario, sin contenido, a las 17:49:02: **0 en los dos canales.** Queda lo aprobado con el aviso firmado de Zernio. No se buscó por nombre (decisión de Marcos: aunque existiera sin usuario, la sugerencia no saldría igual).
- **Límite de F29 #1 y #3, contado sin contenido a las 17:54:37: la búsqueda por usuario no reconoce los contactos sin usuario guardado: 510 de 655 en @alomercadeo** (0 de 2 en @poderosascomunidad). Vienen de la importación vieja, que no leía `participantUsername` (nota de F25 del 22/09/2026), y el relleno de F27 lo completa recién cuando el lead vuelve a escribir. Anotado en §15 como candidato antes de S7.
- **Para el arranque de la próxima revisión, pedido de Marcos (20/10/2026), candidato antes de S7, sin construir:** la lista de Contactos muestra solo 100 (`app/(dashboard)/dashboard/contacts/page.tsx:8`, `TOPE = 100`, y `:44`, `.limit(TOPE)`), y el buscador filtra solo esos 100, por nombre y correo, en el navegador (`contacts-view.tsx:105-110`). Marcos prefiere verla por páginas o con un filtro por letras. Anotado en §15.
- **Revertir, corregido por Marcos el 20/10/2026: de arriba hacia abajo.** Se puede revertir el de más arriba solo, o ese y los que le siguen hacia abajo, nunca uno del medio: el 3 y el 4 se apoyan en la versión intermedia de `lib/auditoria.ts` y de la ficha que trae `a11f402`, y `9ad442e` cambia la 00038 de `a11f402`. **Si falla el 2, se revierten todos o se arregla encima.** Antes decía «si uno falla, se revierte solo el commit de ese ítem», y no era cierto.
- **El no concluyente de `verify-entre-canales.mjs` en rojo:** «el Member no la lee», en el paso de la sugerencia por usuario. Esa ausencia vale solo si antes el Owner leyó la sugerencia con su token; en rojo la sugerencia no existía (ni la tabla ni la búsqueda están en producción), así que el control del Owner falló. Deja de serlo con la 00039 aplicada y el receptor nuevo desplegado: el aviso firmado crea la sugerencia, el Owner la lee, y recién ahí la ausencia del Member es concluyente.

**Corte del tramo: la espera de Railway, de 12:40:03 a 12:55:32** (15 min 29 s), que no se cuenta. **Segundo corte por la misma espera: de 13:10:41 a 13:36:57** (26 min 16 s), que no se cuenta. **El tramo se retomó a las 13:36:57** por el pedido de abajo. Acordado con Marcos: no quedaba nada que hacer salvo esperar. **El tramo se retomó a las 12:55:32** por la decisión de abajo.

- **DECISIÓN DE MARCOS (20/10/2026): un saliente del negocio a un lead eliminado, dentro de los 30 días, también lo restaura** (desde la app de Instagram, el echo de `message.sent`, o desde el teléfono, `fromMe` de Evolution), con «contacto restaurado» de «Sistema» y la vía `mensaje_saliente` en el detalle. **Motivo:** si el negocio le escribe, el lead está activo; sin restaurarlo, la conversación queda oculta y la purga borra justo esos mensajes. No es un criterio nuevo. Construida de 12:55:32 a 13:10:19, encima de `fe22949`, sin F29: F29 se guardó aparte (respaldo y `git stash`) y se volvió a poner encima. La 00038, sin aplicar, acepta la vía nueva, solo del servidor; el receptor la pasa en los dos canales; el historial dice «el negocio le volvió a escribir». **Tests vistos en rojo con el código de `fe22949` (6 de 46) y en verde después.** `verify-borrado.mjs` suma un saliente firmado de WhatsApp y un echo firmado de Instagram en el espacio fantasma. **Commit local `9ad442e`, sin subir**, con build 0, `typecheck` 0 y 805 de 805.
- **Pedido de Marcos (20/10/2026, 13:36): «Eliminar marca la fecha, no borra», también para Owner y Admin, aplicado en la base.** «contacts: borrar solo manager» y «conversations: borrar solo manager» (00019, vigentes según `pg_policies`) le dejaban a un Owner o un Admin borrar de verdad con su token: sin `deleted_at`, sin los 30 días y sin historial. No es un criterio nuevo. **La 00038 (sin aplicar) saca las dos políticas y no pone otras**: con la seguridad por filas activa y sin política de DELETE, la API no borra; borra solo la clave de servicio (la purga). **`fusionar_contactos` no se afecta, verificado en el catálogo de producción (solo lectura):** es `security definer` con dueño `postgres`, que es el dueño de `contacts`, `conversations`, `messages` y `contact_notes`, sin seguridad por filas forzada (`relforcerowsecurity` en false); lo confirman con sesiones reales las pruebas de fusión después de aplicar la 00038. **Ningún camino de la app borra contactos ni conversaciones con el cliente del usuario**: el único `DELETE` de esas tablas es el de la purga (`lib/purga.ts`, clave de servicio). Test del texto de la 00038 visto en rojo y en verde. **`verify-borrado.mjs` suma el paso**: el Admin, con su token, DELETE directo de una conversación y un contacto de su espacio, releídos con la clave de servicio; contraparte: el mismo Admin elimina por `eliminar_contacto`. **Visto en rojo contra producción, 13:37:51 a 13:38:17, salida 1: hoy el DELETE directo del Admin borra (HTTP 200, las filas ya no están)**; la contraparte da 404 (la función no existe). Pasa sin probar nada: «no quedó nada en el historial» (pasa con y sin el arreglo). **Commit local `d97cec1`, sin subir**, encima de `9ad442e`, con build 0, `typecheck` 0 y 806 de 806. F29 se guardó aparte (respaldo y stash) y volvió encima. **El `git stash pop` aplicó sin choques y descartó el stash solo**, antes de la comprobación (debió ser `git stash apply`); la comprobación se hizo contra el respaldo hecho inmediatamente antes del stash, con el mismo contenido: contra `HEAD`, lo que cambia el árbol es exactamente lo que F29 cambiaba sobre `9ad442e`; contra el respaldo, exactamente lo que cambia `d97cec1`, en los 17 archivos. **Vista fallar con una referencia equivocada** (`9ad442e` en lugar de `d97cec1`): marca `ALL_MIGRATIONS.sql`, el único archivo de F29 que `d97cec1` también toca. Con todo junto: build 0, `typecheck` 0, **816 de 816** (806 más los 10 de F29). Terminado a las 13:40:17.

**Tercer corte por la misma espera: de 13:40:17 a 13:52:26** (12 min 9 s), que no se cuenta. Lo trabajado entre el segundo y el tercer corte va de 13:36:57 a 13:40:17, sin hueco. **El tramo se retomó a las 13:52:26** con la revisión de errores de todo lo construido (los cinco commits locales y F29), pedida por Marcos mientras Railway sigue pausado.
- **La revisión de errores de todo lo construido y sus arreglos, de 13:52:26 a 14:09:21** (pedida por Marcos con Railway pausado). Tres revisores en paralelo (migraciones; receptores y purga; pantallas y rutas), sin escribir nada, y los hallazgos verificados contra el código antes de mostrarlos. **Ninguno de severidad alta**; la seguridad por filas aguantó los ataques revisados. Marcos aprobó arreglar el grupo A, y respondió las tres preguntas de diseño.
  - **Arreglado en F30, commit local `33c123d`, sin subir** (encima de `d97cec1`; 815 de 815, build 0): la sincronización de historial de WhatsApp (`messages.set`) restauraba leads eliminados, y ya no; dos restauraciones simultáneas del mismo lead daban 500 (P0002), y ahora la segunda es «ya restaurado»; la purga lee por páginas (el tope de 1000 filas por pedido es inferencia, no se verificó el valor del proyecto) y repite la condición al borrar; la 00038 exige `deleted_at` vacío en las altas de contactos y conversaciones (un Member podía dar de alta un contacto ya «eliminado») y redefine el trigger de notas para que la fecha de edición la ponga siempre él; «Editar datos» compara contra lo que había al abrir (no pisa el cambio de un compañero), muestra la propuesta de unión con los dos lados si el teléfono ya es de otro contacto (antes mandaba a un botón que no existía; la pieza `PropuestaDeUnion` sale de `telefono-sin-resolver.tsx`) y recarga si algo falló a mitad; el historial vacío de un Member dice la verdad; «Eliminados» no se traga los errores (y la pantalla de error de Contactos). Tests nuevos vistos en rojo (9) y en verde; las pantallas no tienen tests de componente: lo de «Editar datos» lo cubre `verify-ficha.mjs` en la ruta (el 409 con el otro contacto, el aviso de correo).
  - **Decisiones de Marcos del 20/10/2026 (respuestas a la revisión), no son criterios nuevos:** (1) un lead eliminado que escribe por OTRO canal se restaura si coincide por teléfono o correo exactos, y entra como nuevo solo si ya se purgó; (2) la búsqueda de F29 mira también `whatsapp_phone` y el correo secundario; (3) «Editar datos» avisa si el correo ya lo tiene otro contacto (se guarda igual). La (3) va en `33c123d`; la (1) y la (2), en F29.
  - **Arreglado en F29, sin commitear** (832 de 832, build 0): la búsqueda y la sugerencia ya no tiran (si fallaban después de crear el contacto, el reintento lo trataba como existente); la sincronización de historial no busca entre canales; un par se sugiere una sola vez en cualquier orden (índice único sobre el par sin orden en la 00039); la búsqueda reescrita con las decisiones (1) y (2); en la bandeja, el texto de la sugerencia según el lado, la lista se vuelve a pedir después de unir, y si el contacto del panel es el absorbido la bandeja vuelve sin conversación elegida. Tests vistos en rojo (7) y en verde. `verify-entre-canales.mjs` suma `whatsapp_phone`, el eliminado restaurado y vinculado por otro canal, el correo secundario y el par al revés.
  - **F29 traída de vuelta con `git stash apply`** (no `pop`), comparada contra el stash real: contra `HEAD` (`33c123d`), exactamente las líneas de F29 del stash; contra el stash, exactamente las de `33c123d`; con la referencia equivocada falla en los tres archivos que tocan las dos partes. Suite 825 de 825 con todo junto antes de descartar el stash.
  - **Anotado, sin arreglar (grupo B, aprobado así):** (a) las secuencias le escriben a un lead eliminado y el eco lo restauraría: hoy no pasa (el cron de secuencias no corre en producción y hay 0 inscripciones); pendiente para cuando se activen, con dueño en la Fase 2. (b) Los no leídos quedan en 2 en conversaciones existentes: viene del fork (`44a6fba`), no de hoy. (c) El PATCH de edición guarda aunque el historial falle: mismo diseño que F41 y la propuesta abierta de §15 sobre `registrarAuditoria`. (d) Las bandejas abiertas no se enteran de que una conversación se eliminó hasta recargar: inferencia sobre Realtime. (e) La purga borra los archivos antes que las filas: si un lead se restaura justo en ese instante, se salvan sus filas pero no sus archivos; ventana chica, anotada.
- **F29 vuelta a poner encima de `9ad442e`:** chocaron 4 archivos (`late/route.ts`, `lib/auditoria.ts`, `lib/evolution-guardado.ts`, `lib/inbox-sync.ts`), resueltos combinando las dos partes. **Comprobado mecánicamente, no a ojo:** contra `HEAD` las líneas cambiadas de esos cuatro son exactamente las de F29 del stash (su diferencia contra `fe22949`), y contra el stash, exactamente las de `9ad442e`. Con las dos juntas: build 0, `typecheck` 0, **815 de 815** (801 de `fe22949`, más 4 de la decisión, más 10 de F29). Recién ahí se descartó el stash.


---

## Siguiente paso

**`docs/purga-y-reconexion-instagram.md` está cerrado**, desde el 22 de septiembre de 2026, con el despliegue verificado. Railway despliega `bloque-1-foundation` con despliegue automático al subir, verificado ese día en la interfaz. El último despliegue verificado es `d3eb410`, el 23 de septiembre de 2026, con la tarjeta ACTIVE en "Deployment successful" (captura de Marcos).

### Dos desincronizaciones entre producción y el repositorio, el 22 de septiembre de 2026

**La primera no se notó durante días.** El último push había sido el 17. Desde el 21 había 19 commits sin subir, entre ellos `63834ac`, que suma `message.sent` a la lista de eventos del webhook. El 22, la rotación del secreto hizo que producción re-registrara el webhook con su lista vieja y le borrara ese evento. Detalle en el paso 3.2 de `docs/purga-y-reconexion-instagram.md`.

**La segunda, al subirlos.** Estos son los hechos, en orden; las horas son de Costa Rica.

1. **21/09 18:09.** `63834ac` suma el tercer evento a `WEBHOOK_EVENTS`, pero el tipo `WebhookEvent` (`lib/zernio-webhook.ts:53`, escrito a mano, que venía del fork) queda con dos. Eso es un error de tipos en `app/api/v1/channels/sync/route.ts:147` y en `app/api/v1/channels/test-key/route.ts:82`.
2. **Por qué no lo vieron los 211 tests:** Vitest no chequea tipos. Verificado de hecho, no por documentación: con ese error presente, `npm test` daba 211 de 211 y `npm run build` fallaba. Desde el 21 nadie había corrido un build.
3. **22/09 16:05.** Se suben los 21 commits (`69cfbc0..5f697e8`). **El build de Railway falló**, en "Build › Build image", con el error de `sync/route.ts:147`. El de `test-key/route.ts:82` no lo reportó porque el build corta en el primer error; apareció después, corriendo `tsc` sobre `5f697e8`. **No fue un error en ejecución: `5f697e8` nunca corrió en producción.**
4. **Mientras tanto, producción siguió sirviendo `69cfbc0`**, el despliegue del 17/09 18:22. Lo confirmó Marcos en la interfaz de Railway, donde la tarjeta ACTIVE seguía en ese commit. `app.alomercadeo.com` respondió en **una sola** comprobación, hecha entre el fallo y el arreglo: `/login` dio HTTP 200 en medio segundo. **No hubo monitoreo continuo**, así que "respondió todo el rato" no está medido.
5. **16:19.** `98aa3aa` es el arreglo: el tipo pasa a derivarse de la lista. Lo escribió Claude durante el despliegue, con la aprobación de Marcos, y lo verificó con `npm run build`, que falló antes del cambio y pasó después. Railway lo desplegó bien, y a las 16:24 ya estaba activo. Producción pasó de `69cfbc0` directamente a `98aa3aa`, así que sirvió la versión vieja desde el 17 hasta unos minutos después de las 16:19. La hora exacta del cambio está en Railway y no se anotó.

**Lo que se construyó para que no vuelva a pasar**, con la regla en el `CLAUDE.md`, sección "Apertura y cierre de sesión":

- **`scripts/compuerta-cierre.test.ts`** se pone en rojo si el commit sin subir más viejo tiene más de un día, y si `tsc` encuentra un error de tipos. **Los dos se vieron fallar antes de pasar:**
  - el de commits, en un clon descartable con un commit sin subir fechado el 20/09;
  - el de tipos, contra un error real que ya existía y que ningún build mira: una directiva `@ts-expect-error` sobrante en `scripts/redaccion.test.ts`. Además, `tsc` sobre `5f697e8` reproduce los dos errores de este incidente.

  En un clon sin rama remota, el de commits queda **salteado** a la vista, no en verde.
- **`node scripts/commits-sin-subir.mjs`** informa al abrir sesión cuántos commits hay sin subir y de cuándo es el más viejo.
- **`npm run typecheck`.**
- **Y el test débil del filtro de dirección**, `app/api/webhooks/late/route.test.ts`, ahora exige `reason: "outgoing"`. Se comprobó que con solo `skipped: true` seguía en verde aunque el descarte viniera de otro camino, y que reforzado se pone en rojo en ese caso. Es el único control que tiene `e65d37f`, porque ningún mensaje real llega a ese filtro.

Después, el Bloque 3: modelo de contacto extendido (F25), identidad de canal y reconciliación de teléfonos (F26), y guardado de mensajes entrantes (F27), que es donde vive el riesgo real de la fase.

### El Bloque 3 se corre en tres sesiones, contra dos días, y se mide

**Línea de base fijada el 22 de septiembre de 2026, antes de arrancar el bloque.** No se toca mientras se mide.

**Corregida el 23 de septiembre de 2026, con la medición sin arrancar: de ocho funcionalidades a nueve, con F41.** La estimación original ya contaba con la asignación de setter y vendedor: la tabla de bloques de §2 del plano en `ebc9702` pone el Bloque 3 en los días "3-4" y nombra "setter/vendedor" entre lo que construye. La línea de base del 22/09 se fijó sobre un plano que había perdido F11 en la conciliación de `584226f`, así que medía contra un alcance más chico que el que se había estimado. F41 no es una funcionalidad que se le suma al bloque: es la que le faltaba a la línea de base. La estimación sigue en 2 días y el pronóstico se mantiene. Ver `docs/auditoria-conciliacion.md`, #45 a #50.

**El alcance son las nueve funcionalidades del Bloque 3 en el plano**, y ninguna más: F25, F26, F27, F28, F29, F30, F31, F39 y F41. F26 incluye el criterio agregado el 22 de septiembre sobre la identidad del canal, que entró **antes** de fijar esta línea de base.

**Línea de base ajustada antes de medir, el 07/10/2026:** F27 suma un criterio (guardar lo que el negocio escribe fuera del sistema) y su control positivo. Motivo: el receptor descarta los echos (hoy el receptor los descarta en app/api/webhooks/late/route.ts:167, que ignora todo evento que no sea message.received, incluido message.sent; y en la :190 descarta además los message.received con dirección outgoing, para no procesar en bucle los propios envíos) y, cuando la bandeja lea de la base, lo escrito desde la app de Instagram o desde el teléfono dejaría de verse. Las 9 funcionalidades y las 3 sesiones no cambian. Antecedente: F41, el 23/09/2026. **Además del control positivo de Instagram, el criterio lleva uno de WhatsApp**, con un aviso de prueba firmado de Evolution, agregado el mismo día por decisión de Marcos: son tres líneas de criterio nuevas en F27, y ninguna en las otras ocho funcionalidades del bloque.

**La estimación son 2 días hábiles para el bloque entero**, los "días 3 a 4" de la tabla de bloques del plano. Circuló también una cifra de 1,5 días, pero no era una duración: era una lectura mal copiada del gráfico de avance, y se corrigió donde aparecía.

| Sesión | Funcionalidades | Por qué juntas | Días reales | Anotado el |
|---|---|---|---|---|
| 1 | F31, F25, F26 | El modelo de contacto y la identidad de canal. **F31 primero:** F26 escribe en la auditoría, y la tabla no existe hasta F31 | Tramo 1: 07/10/2026 17:37 a 07/10/2026 18:35. Tramo 2, retrabajo de F31: 08/10/2026 13:16 a 08/10/2026 13:26. Hora de Costa Rica. Suma: 68 min (1 h 8 min) | 07/10/2026 y 08/10/2026 |
| 2 | F27, F28, F39 | El camino de entrada. F28 y F39 cuelgan de F27 | Tramo 1, F27: 08/10/2026 14:20 a 08/10/2026 17:48, con un corte de 16:15 a 16:32 por el cierre forzado de la sesión, que no se cuenta. Hora de Costa Rica. Suma del tramo 1: 191 min (3 h 11 min). Tramo 2, pendientes cortos de F27, F25 y F39: 08/10/2026 18:25 a 08/10/2026 19:48, con un corte de 18:43 a 19:13 por el cierre de la app, que no se cuenta. Suma del tramo 2: 53 min. Tramo 3, pendiente corto de F27 y el resto de F39: 09/10/2026 12:09 a 09/10/2026 16:35, sin cortes. Suma del tramo 3: 266 min (4 h 26 min). Suma de la sesión hasta acá: 510 min (8 h 30 min). Tramo 4, parte A de F28: 09/10/2026 17:45 a 09/10/2026 18:49, sin cortes. Suma del tramo 4: 63 min. Suma de la sesión hasta acá: 573 min (9 h 33 min). La parte B de F28 va en otra sesión. Tramo 5, parte B de F28: 19/10/2026 12:48 a 19/10/2026 16:39, sin cortes. Suma del tramo 5: 230 min (3 h 50 min). Suma de la sesión hasta acá: 803 min (13 h 23 min). F28 queda en 3 de 6: los criterios 1, 3 y 4 son de la puesta en marcha del número | 08/10/2026 |
| 3 | F29, F30, F41 | El lado de CRM, que no toca la ingesta. F41 va con F30 porque la asignación se ve y se edita en la ficha | Tramo 1, F41: 19/10/2026 17:01 a 19/10/2026 18:14, con un corte de 17:15 a 17:20 por la apertura (ítem 0), que no se cuenta. Hora de Costa Rica. Suma del tramo 1: 67 min (1 h 7 min; corregido el 19/10/2026: decía 68, redondeado, y los tramos truncan los segundos). F41 completa, 7 de 7 | 19/10/2026 |
| **Bloque** | | | **Planificado: 2 días** | |

**Por qué tres sesiones y no dos.** La partición en dos que estaba escrita acá nombraba F25 a F29 y dejaba afuera F30, F31 y F39. Nunca fue una partición completa: se escribió antes de que F39 existiera y sin contar F30 ni F31. Y **sesiones y días no son lo mismo**: las sesiones son unidades de trabajo, los dos días son la estimación. Se miden tres sesiones contra dos días planificados, y si tarda cuatro, ese es el resultado. Meter cinco funcionalidades en una sesión para que entren en dos no mejora la estimación: produce una sesión que se desborda y no enseña nada.

**Pronóstico, escrito antes de arrancar, para que la primera corrida ponga a prueba dos cosas, la estimación y el pronóstico.** Un pronóstico escrito después no vale nada.

- **El bloque se pasa de los 2 días. La sesión 2 sola se lleva más de uno.**
- **Por qué la sesión 2, y por qué F27.** Es donde vive el riesgo de la fase: dos caminos de entrada que se tienen que deduplicar entre sí (el webhook y la importación del historial), dos proveedores con formas de aviso distintas (Evolution manda un objeto para un mensaje y una lista para una sincronización), y una importación que hoy tiene un techo de 200 y que F27 tiene que reescribir para recorrer hasta el final. F28 y F39 no pueden empezar hasta que F27 guarde mensajes.
- **Lo que haría fallar el pronóstico, dicho de antemano:** que la sesión 1 se lleve más que la 2. Sería señal de que F31 y el criterio nuevo de F26 pesaban más de lo que parecían.

**El dato en que se apoya el pronóstico, y su límite.** El Bloque 2 estaba planificado en "1 a 2" días. Tiene commits del 16, el 17 y el 21 de septiembre de 2026, y F24 sigue parcial. **No es una medición:** días con commits no son días trabajados, y en el medio hubo trabajo que no estaba en el plan. Apunta a que el plan es optimista, y no dice cuánto.

**Por qué se anota al terminar cada sesión y no al cerrar el bloque:** si se anota al final, lo que queda es un número agregado que no dice dónde se fue el tiempo, y la mitad del valor de medir es saber cuál de las tres partes se desbordó.

**Para qué sirve, concretamente:** la próxima decisión de alcance —qué entra en la Fase 2, si el Bloque 4 se parte, cuánto dura la fase— se va a tomar con este dato o con otra proyección. Hoy todas las estimaciones del plano descienden de la misma suposición inicial y ninguna se contrastó nunca contra un bloque terminado.

**Esta es también la razón por la que F32 no se adelantó al Bloque 3**, decidido el 22 de septiembre de 2026: sumarle una funcionalidad al bloque que se va a medir destruye la comparación, porque ya no serían los mismos dos días planificados. El razonamiento completo está en `docs/requerimientos-fase1.md` §4.7. **F41 no contradice esto:** F32 era del Bloque 4 en la estimación original, y F41 estaba en el Bloque 3 desde el principio.

Sin fecha: el Flujo 4 del plano, la conexión en vivo de WhatsApp. Espera el número dedicado **y el cierre del Bloque 4**, porque la compuerta son F27 y F32, y F32 se queda en el Bloque 4. Ver el Flujo 4, pasos 4 y 5.
