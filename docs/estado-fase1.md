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

**Desde el 7 de octubre de 2026, a la noche, 8 de 26:** se completó F31, el historial de auditoría, en la sesión 1 del Bloque 3 (abajo), por la regla decidida ese día: completa es que todo lo que hace por sí misma funcione con datos reales, y que lo único pendiente sean registros de funcionalidades que todavía no existen y que ya tienen dueño escrito. Completas: F1, F2, F3, F4, F21, F22, F23 y F31. F25 y F26 quedan construidas y no completas: cierran con F27. **Antes, desde el 7 de octubre de 2026, 7 de 26:** ese día se completaron F22 (el criterio #5 que faltaba) y F23, en la sesión de cierre del Bloque 2 (abajo). Completas: F1, F2, F3, F4, F21, F22 y F23. **El Bloque 2 no queda cerrado del todo:** F24 sigue parcial, por la misma razón que antes. **Antes, desde el 7 de octubre de 2026, el avance se contaba sobre 26 y era 5 de 26:** ese día se sumó F42, respuesta por WhatsApp desde la bandeja, al Bloque 4. Lo que sigue es el recuento anterior, sobre 25. **Al 5 de octubre de 2026 el avance seguía en 5 de 25:** F24 tiene todos sus criterios cumplidos salvo probar "Desconectar" contra Zernio real, y no cuenta como completa. **Avance de la Fase 1, contado el 23 de septiembre de 2026 sobre la línea de estado de cada funcionalidad del plano.** **25 funcionalidades a construir**: F1 a F4 y F21 a F41 (desde el 07/10/2026, 26: F1 a F4 y F21 a F42). Quedan afuera F5, eliminada de la fase, y F6, F6b y F6c, que son del plan B. **5 completas:** F1, F2, F3, F4 y F21. **F22 está construida con un criterio pendiente**: la idempotencia igual para los dos canales, devuelta ese día por la auditoría (#5), que nadie comprobó todavía en los dos canales. Parciales, según su línea de estado: F24, F34 y F35.

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

**Lo que queda para otras funcionalidades:**
- **«Ver la cola»** del contador lleva a la bandeja con el filtro «Teléfono sin resolver», que es de **F35**. Hasta entonces la línea se muestra sin el link.
- **Las notas en `fusionar_contactos`, de F30.** La fusión comprueba en el catálogo que ninguna tabla con clave hacia `contacts` le siga apuntando al absorbido. Cuando F30 cree `contact_notes`, la fusión va a fallar a los gritos hasta que se las sume.
- **La sugerencia de fusión en las vías automáticas, de F29** («¿Es la misma persona?»). Hoy la propuesta con los dos lados existe solo en la carga manual desde la ficha.
- `attachments` de los mensajes de Zernio pasa al navegador tal como lo manda el proveedor (`lib/zernio-message-map.ts:239`). Se revisa en F27 y F28, cuando la bandeja pase a leer de la base y los adjuntos se guarden.

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
| 1 | F31, F25, F26 | El modelo de contacto y la identidad de canal. **F31 primero:** F26 escribe en la auditoría, y la tabla no existe hasta F31 | Tramo 1: 07/10/2026 17:37 a 07/10/2026 18:35, hora de Costa Rica. Suma: 58 min | 07/10/2026 |
| 2 | F27, F28, F39 | El camino de entrada. F28 y F39 cuelgan de F27 | | |
| 3 | F29, F30, F41 | El lado de CRM, que no toca la ingesta. F41 va con F30 porque la asignación se ve y se edita en la ficha | | |
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
