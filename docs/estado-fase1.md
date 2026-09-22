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

**Migraciones aplicadas en el Bloque 1:** 00017 a 00021, todas idempotentes, sobre las 16 del fork. El Bloque 2 sumó la 00022 y la 00023. **El conteo vigente vive en `docs/requerimientos-fase1.md` §14c y un test lo comprueba; no lo repitas acá.**

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

**El plano es `docs/requerimientos-fase1.md` y es el único.** F1 a F39, una sola numeración. Hasta el 21 de septiembre de 2026 convivió con `docs/requerimientos-bloques-2-3-4.md`, que numeraba distinto; se conciliaron en uno y el segundo se borró. Hay un test, `docs/docs-unicos.test.ts`, que falla si aparece otro.

Las siete cosas de la lista vieja, dónde quedaron: el adaptador de Evolution en F22, el guardado de mensajes entrantes en F27, las seis reglas de seguridad en F33, el estado de sesión en F32, la autenticación del webhook en F22, el despliegue de Railway en F21, y el modelo de ventana y plantillas en §4.12b marcado como condicional al plan B.

---

## Siguiente paso

**`docs/purga-y-reconexion-instagram.md` está cerrado**, desde el 22 de septiembre de 2026, con el despliegue verificado. Railway despliega `bloque-1-foundation` con despliegue automático al subir, verificado ese día en la interfaz. Producción sirve `98aa3aa`.

**Pendiente al cierre de esa sesión:** un test que falle si hay commits sin subir hace más de un día, con su línea en el `CLAUDE.md`, y un chequeo de tipos antes de subir. Son dos fallas del mismo día: 19 commits sin subir le borraron un evento a la suscripción en producción, y un error de tipos pasó dos días en la rama con la suite en verde.

Después, el Bloque 3: modelo de contacto extendido (F25), identidad de canal y reconciliación de teléfonos (F26), y guardado de mensajes entrantes (F27), que es donde vive el riesgo real de la fase.

### El Bloque 3 se corre en tres sesiones, contra dos días, y se mide

**Línea de base fijada el 22 de septiembre de 2026, antes de arrancar el bloque.** No se toca mientras se mide.

**El alcance son las ocho funcionalidades del Bloque 3 en el plano**, y ninguna más: F25, F26, F27, F28, F29, F30, F31 y F39. F26 incluye el criterio agregado ese mismo día sobre la identidad del canal, que entró **antes** de fijar esta línea de base.

**La estimación son 2 días hábiles para el bloque entero**, los "días 3 a 4" de la tabla de bloques del plano. Circuló también una cifra de 1,5 días, pero no era una duración: era una lectura mal copiada del gráfico de avance, y se corrigió donde aparecía.

| Sesión | Funcionalidades | Por qué juntas | Días reales | Anotado el |
|---|---|---|---|---|
| 1 | F31, F25, F26 | El modelo de contacto y la identidad de canal. **F31 primero:** F26 escribe en la auditoría, y la tabla no existe hasta F31 | | |
| 2 | F27, F28, F39 | El camino de entrada. F28 y F39 cuelgan de F27 | | |
| 3 | F29, F30 | El lado de CRM, que no toca la ingesta | | |
| **Bloque** | | | **Planificado: 2 días** | |

**Por qué tres sesiones y no dos.** La partición en dos que estaba escrita acá nombraba F25 a F29 y dejaba afuera F30, F31 y F39. Nunca fue una partición completa: se escribió antes de que F39 existiera y sin contar F30 ni F31. Y **sesiones y días no son lo mismo**: las sesiones son unidades de trabajo, los dos días son la estimación. Se miden tres sesiones contra dos días planificados, y si tarda cuatro, ese es el resultado. Meter cinco funcionalidades en una sesión para que entren en dos no mejora la estimación: produce una sesión que se desborda y no enseña nada.

**Pronóstico, escrito antes de arrancar, para que la primera corrida ponga a prueba dos cosas, la estimación y el pronóstico.** Un pronóstico escrito después no vale nada.

- **El bloque se pasa de los 2 días. La sesión 2 sola se lleva más de uno.**
- **Por qué la sesión 2, y por qué F27.** Es donde vive el riesgo de la fase: dos caminos de entrada que se tienen que deduplicar entre sí (el webhook y la importación del historial), dos proveedores con formas de aviso distintas (Evolution manda un objeto para un mensaje y una lista para una sincronización), y una importación que hoy tiene un techo de 200 y que F27 tiene que reescribir para recorrer hasta el final. F28 y F39 no pueden empezar hasta que F27 guarde mensajes.
- **Lo que haría fallar el pronóstico, dicho de antemano:** que la sesión 1 se lleve más que la 2. Sería señal de que F31 y el criterio nuevo de F26 pesaban más de lo que parecían.

**El dato en que se apoya el pronóstico, y su límite.** El Bloque 2 estaba planificado en "1 a 2" días. Tiene commits del 16, el 17 y el 21 de septiembre de 2026, y F24 sigue parcial. **No es una medición:** días con commits no son días trabajados, y en el medio hubo trabajo que no estaba en el plan. Apunta a que el plan es optimista, y no dice cuánto.

**Por qué se anota al terminar cada sesión y no al cerrar el bloque:** si se anota al final, lo que queda es un número agregado que no dice dónde se fue el tiempo, y la mitad del valor de medir es saber cuál de las tres partes se desbordó.

**Para qué sirve, concretamente:** la próxima decisión de alcance —qué entra en la Fase 2, si el Bloque 4 se parte, cuánto dura la fase— se va a tomar con este dato o con otra proyección. Hoy todas las estimaciones del plano descienden de la misma suposición inicial y ninguna se contrastó nunca contra un bloque terminado.

**Esta es también la razón por la que F32 no se adelantó al Bloque 3**, decidido el 22 de septiembre de 2026: sumarle una funcionalidad al bloque que se va a medir destruye la comparación, porque ya no serían los mismos dos días planificados. El razonamiento completo está en `docs/requerimientos-fase1.md` §4.7.

Sin fecha: el Flujo 4 del plano, la conexión en vivo de WhatsApp. Espera el número dedicado **y el cierre del Bloque 4**, porque la compuerta son F27 y F32, y F32 se queda en el Bloque 4. Ver el Flujo 4, pasos 4 y 5.
