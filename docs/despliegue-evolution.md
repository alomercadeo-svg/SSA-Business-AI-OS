# Despliegue de Evolution API en Railway

Procedimiento reproducible para dejar corriendo el servicio de WhatsApp (F21).

**Fecha:** 16 de septiembre de 2026. **Ejecutado y verificado el 17 de septiembre de 2026.**
**Versión desplegada:** Evolution API 2.3.7.

**Qué deja andando:** dos servicios en Railway, Evolution y su PostgreSQL, con una instancia creada
y el aviso de mensajes apuntando a nuestro receptor. **Sin ningún número vinculado.**

**Estado al 17 de septiembre de 2026:** desplegado y verificado de punta a punta. Instancia
`alomercadeo-ventas`, en estado `close`, sin `ownerJid`, sin `number` y sin `profileName`. El
webhook apunta a `https://app.alomercadeo.com/api/webhooks/evolution` con los siete eventos, leído
de vuelta desde Evolution. `verify-evolution-deploy.mjs` y `verify-evolution-webhook.mjs` pasan.

> ## ⚠ El número no se vincula todavía
>
> No es una preferencia de orden: es una regla dura, y el motivo está en
> `docs/requerimientos-bloques-2-3-4.md` §4.7.
>
> El receptor de webhooks autentica el aviso, controla que no esté repetido, responde 200 y
> **descarta el contenido**, porque guardarlo es F27 y todavía no existe. Si el número se vincula
> antes, cada mensaje real de un lead se pierde de la peor forma posible: en silencio y con acuse
> de éxito. El receptor responde que todo salió bien, Evolution da la entrega por buena y no
> reintenta, no hay error y no se dispara ninguna alerta. El único síntoma serían conversaciones
> que nunca existieron, descubiertas semanas después.
>
> El canal se prueba entero con avisos firmados de prueba. No hace falta un número real para eso, y
> el checklist de conexión (Flujo 4 del plano) tiene el paso de confirmar que F27 está construido
> **antes** del escaneo del QR.

---

## 0. Las decisiones que gobiernan este despliegue

Todas salen de `docs/investigacion-evolution-api.md`, que las verificó contra el código fuente de
Evolution 2.3.7 citando archivo y línea.

| Decisión | Motivo |
|---|---|
| Imagen fijada en `evoapicloud/evolution-api:v2.3.7` | Ver abajo |
| Dos servicios, no tres: sin Redis | El caché es de rendimiento, no de estado. La sesión de WhatsApp va al PostgreSQL, no a Redis |
| `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` | Con el valor por defecto, Evolution mete el token de la instancia en el cuerpo de cada webhook |
| `WEBHOOK_GLOBAL_ENABLED=false` | El webhook global se construye sin headers, así que con él no hay nada que autenticar |
| Credenciales en Supabase Vault | Nunca en variables de entorno de la app |

### Por qué la imagen va fijada, con los números

El tag `latest` **no apunta hoy a ninguna versión estable etiquetada**. Comprobado contra la API de
Docker Hub el 16 de septiembre de 2026:

| Tag | Última actualización | Digest |
|---|---|---|
| `v2.3.7` | 5 de diciembre de 2025 | `sha256:1bd8afc4…` |
| `latest` | 6 de mayo de 2026 | `sha256:96662553…` |

Son builds distintos, y el de `latest` no corresponde a ninguna release publicada. La plantilla
oficial de Railway usa `latest`, así que desplegar con ella entrega algo distinto de lo que uno
cree estar desplegando.

**Cuidado con la `v`:** el tag de Docker es `v2.3.7`, con `v`. El tag de git del mismo repositorio
es `2.3.7`, sin `v`. Los dos existen y no son intercambiables.

### Lo que hay que re-verificar en cada actualización de versión

El mecanismo con el que autenticamos los webhooks, el header `jwt_key`, **está verificado en el
código pero no está documentado**: no aparece en la documentación oficial ni en el `CHANGELOG.md`.
No documentado es no soportado, así que puede desaparecer en la 2.4.0 sin figurar en el changelog,
porque nunca figuró que existía.

Y la forma en que nos enteraríamos sería la peor: los webhooks dejarían de traer el header
`Authorization`, el receptor seguiría fallando cerrado con 401, y Evolution descartaría cada evento
sin reintentar. Mensajes de leads perdidos en silencio.

**Antes de subir de versión, es obligatorio:** leer
`src/api/integrations/event/webhook/webhook.controller.ts` de la versión nueva y confirmar que
`jwt_key` sigue existiendo y firmando igual. Es una lectura de un archivo, no una auditoría.
`lib/evolution-webhook.ts` cita las líneas exactas contra las que comparar.

La alerta ante rechazos cumple doble función: detecta una rotación mal hecha, y detecta esto.

---

## 1. PostgreSQL de Evolution

En el proyecto de Railway que ya tiene la app Next.js:

1. **+ New → Database → Add PostgreSQL**
2. Nombre sugerido: `evolution-db`
3. No se le toca nada más. Sin dominio público.

**Dos bases de datos que no son intercambiables.** Supabase guarda los datos del negocio.
Este PostgreSQL guarda el estado interno de Evolution, **incluida la sesión de WhatsApp**. Ninguna
consulta de la aplicación toca este segundo. Perderlo significa volver a escanear el QR.

**Cómo verificar:** el servicio aparece en verde y expone la variable `DATABASE_URL` en su pestaña
de Variables.

---

## 2. Servicio de Evolution

1. **+ New → Docker Image**
2. Imagen: `evoapicloud/evolution-api:v2.3.7` — **exactamente eso, nunca `latest`**
3. Nombre sugerido: `evolution`

---

## 3. Variables de entorno

Todas verificadas contra el `.env.example` de la versión 2.3.7. La columna "por qué" solo está
en las que se apartan del valor por defecto: las demás se escriben igual para que el despliegue no
dependa de cuál sea el default de la versión que venga.

### Servidor

| Variable | Valor | Por qué |
|---|---|---|
| `SERVER_TYPE` | `http` | |
| `SERVER_PORT` | `8080` | El puerto que expone la imagen |
| `SERVER_URL` | La URL pública del paso 4 | Evolution la usa para armarse links a sí mismo. Se completa después de generar el dominio |
| `TELEMETRY_ENABLED` | `false` | Por defecto viene en `true` y manda telemetría afuera. Es un servicio que maneja conversaciones de clientes |
| `LOG_LEVEL` | `ERROR,WARN,INFO` | Ver abajo: no es solo verbosidad, es lo que mantiene el token de la instancia fuera de los logs |
| `LOG_BAILEYS` | `error` | |
| `DEL_INSTANCE` | `false` | Que una instancia desconectada no se borre sola |
| `SERVER_DISABLE_MANAGER` | `true` | Ver abajo |

> **`SERVER_DISABLE_MANAGER=true`, que no está en el `.env.example` de Evolution.**
>
> Verificado en `env.config.ts:464` (`process.env?.SERVER_DISABLE_MANAGER === 'true'`) y en
> `index.router.ts:163` (`if (!serverConfig.DISABLE_MANAGER) router.use('/manager', ...)`). La
> variable existe y funciona, pero no está documentada en el archivo de ejemplo, así que es fácil no
> enterarse de que hay algo que apagar.
>
> Por defecto Evolution sirve una **interfaz web de administración en `/manager`**, sobre nuestro
> dominio público, protegida solo por la clave global. No la usamos: el canal se administra desde
> nuestro propio dashboard. Una superficie de ataque que no se usa se apaga.
>
> **Comprobado el 17 de septiembre de 2026:** `GET /manager` devuelve 404, o sea que la ruta no se
> registró.

> #### `WEBHOOKS` en `LOG_LEVEL` es una trampa, y no es un nivel de verbosidad
>
> Esto se investigó a fondo cuando quedó claro que el `apikey` de la instancia viaja en el cuerpo de
> cada aviso: si Evolution loguea ese cuerpo, la credencial queda en los logs de Railway, o sea en
> nuestra propia infraestructura.
>
> **Verificado en el código de la 2.3.7, y la respuesta es que hoy NO la loguea**, porque hay dos
> compuertas y las dos están cerradas con nuestro valor:
>
> 1. La llamada está envuelta en `if (enabledLog)`, donde `enabledLog` es
>    `LOG.LEVEL.includes('WEBHOOKS')`.
> 2. Adentro usa `this.logger.log(logData)`, y `log()` exige `'LOG'` en la misma lista
>    (`logger.config.ts`: cada método mapea a su propio nombre de nivel).
>
> Y `logData` es `{ local, url, ...webhookData }`, así que el spread **incluye el `apikey`**.
>
> **La trampa:** `WEBHOOKS` no es "más verboso", es una categoría aparte. Alguien que esté
> depurando por qué no llegan las entregas lo va a querer agregar, y es justo lo que parece
> inofensivo. Agregarlo —junto con `LOG`— empieza a escribir el token de la instancia en los logs
> de Railway. Si hace falta para depurar, se agrega, se depura y **se saca**, y después se rota el
> token con `--borrar-instancia` porque quedó en un log que no controlamos del todo.
>
> **La rama de error: verificada, y está limpia.** Es la que importaba, porque `logger.error` **no**
> está detrás de `enabledLog` y `ERROR` sí está en nuestra lista, así que esas líneas se imprimen
> siempre. Y es la rama que tiene garantizado dispararse: todo el diseño del 503 y de las alertas
> parte de que las entregas fallan.
>
> Leídas las cinco llamadas a `logger.error` del archivo (dos en `emit()`, tres en
> `retryWebhookRequest()` y `generateJwtToken()`), ninguna recibe `webhookData`. Los campos que
> loguean son `message`, `hostName`, `syscall`, `code`, `statusCode`, `errno`, `stack`, `name`,
> `url` y `server_url`. **No hay credencial ahí.** El único campo no acotado es `stack`, y un stack
> de axios no arrastra el cuerpo de la petición.

### Base de datos

| Variable | Valor | Por qué |
|---|---|---|
| `DATABASE_PROVIDER` | `postgresql` | |
| `DATABASE_CONNECTION_URI` | `${{evolution-db.DATABASE_URL}}?schema=evolution_api` | Referencia de Railway al servicio del paso 1. **El `?schema=evolution_api` es obligatorio**: sin él Prisma no encuentra su esquema |
| `DATABASE_CONNECTION_CLIENT_NAME` | `evolution_exchange` | |

> #### `DATABASE_SAVE_DATA_HISTORIC=true` es una decisión, no una variable más
>
> Con esto en `true`, las conversaciones con los clientes existen **en dos bases**: Supabase, que
> decidimos que es la fuente de verdad, y este PostgreSQL de Railway.
>
> **Se deja en `true` por ahora, por dos motivos concretos:**
>
> 1. Habilita `POST /chat/findMessages/{instance}`, que consulta el PostgreSQL propio de Evolution
>    y es la vía limpia para una importación inicial de historial. Sin el guardado, ese endpoint no
>    tiene nada que devolver.
> 2. Mientras F27 no exista, es la **única red de contención**. Si el receptor falla, el mensaje
>    al menos quedó del lado de Evolution y se puede recuperar.
>
> **Punto de revisión, y está anotado como deuda en el plano:** cuando F27 esté construido y
> probado, esa copia deja de ser red de contención y pasa a ser redundancia. Ahí hay que decidir si
> se apaga el guardado o si se le define una retención a esta base. Son conversaciones con clientes
> creciendo en un lugar donde nadie definió por cuánto tiempo, y eso no puede quedar resuelto por
> omisión.

| Variable | Valor |
|---|---|
| `DATABASE_SAVE_DATA_INSTANCE` | `true` |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | `true` |
| `DATABASE_SAVE_MESSAGE_UPDATE` | `true` |
| `DATABASE_SAVE_DATA_CONTACTS` | `true` |
| `DATABASE_SAVE_DATA_CHATS` | `true` |
| `DATABASE_SAVE_DATA_HISTORIC` | `true` |

### Caché: dos servicios, no tres

| Variable | Valor | Por qué |
|---|---|---|
| `CACHE_REDIS_ENABLED` | `false` | Por defecto viene en `true` |
| `CACHE_LOCAL_ENABLED` | `true` | Por defecto viene en `false` |

Verificado en `src/cache/cacheengine.ts`: si Redis está deshabilitado y el caché local habilitado,
Evolution usa memoria del proceso y no revienta. Lo único que se degrada es la metadata de grupos,
que no usamos, y la deduplicación de acuses de lectura entre reinicios, que solo produce
escrituras redundantes en la base de Evolution y no toca nuestros datos.

**Lo que NO depende de Redis, y por eso se puede prescindir de él:** la sesión de WhatsApp.
`CACHE_REDIS_SAVE_INSTANCES` viene en `false` por defecto, así que la sesión va al PostgreSQL.

Si alguna vez hace falta correr más de una réplica de Evolution, Redis vuelve a la conversación.

### Webhook

| Variable | Valor | Por qué |
|---|---|---|
| `WEBHOOK_GLOBAL_ENABLED` | `false` | El webhook global se construye **sin headers**, así que no puede mandar el `jwt_key` y no habría nada que verificar. El webhook se configura por instancia |

> #### Las `WEBHOOK_EVENTS_*` del entorno NO gobiernan nada en esta configuración
>
> Una versión anterior de este documento las listaba acá como si importaran. **Es falso**, y una
> variable que parece gobernar algo y no lo gobierna es peor que no documentarla: el día que falte
> un evento, alguien va a mirar esta tabla, verla en `true`, y buscar el problema en otra parte.
>
> Verificado en `webhook.controller.ts` de la 2.3.7, método `emit()`:
>
> ```ts
> // línea 105: el camino POR INSTANCIA
> if (local && instance?.enabled) {
>   if (Array.isArray(webhookLocal) && webhookLocal.includes(we)) { ... }
> }
>
> // línea 152: el camino GLOBAL, el ÚNICO que lee el entorno
> if (webhookConfig.GLOBAL?.ENABLED) {
>   if (webhookConfig.EVENTS[we]) { ... }
> }
> ```
>
> La emisión por instancia se gobierna **solo** por el array `events` guardado en la fila `Webhook`
> de esa instancia. `webhookConfig.EVENTS`, que es de donde salen las `WEBHOOK_EVENTS_*`, se
> consulta únicamente en la rama global, y nosotros la dejamos apagada a propósito.
>
> **Los eventos que nos llegan son los que pasa `scripts/setup-evolution-channel.mjs` en el array
> `events` del paso 7, y nada más.** Van en MAYÚSCULAS con guion bajo, porque `emit()` transforma
> `messages.upsert` en `MESSAGES_UPSERT` antes de comparar. Los nombres canónicos están en
> `EventController.events`:
>
> | Evento | Para qué |
> |---|---|
> | `MESSAGES_UPSERT` | mensajes en vivo |
> | `MESSAGES_SET` | historial, llega como array |
> | `QRCODE_UPDATED` | pantalla de canales |
> | `CONNECTION_UPDATE` | estado de sesión |
> | `CONTACTS_UPSERT` | una de las tres vías de reconciliación de teléfonos (F26) |
> | `STATUS_INSTANCE`, `LOGOUT_INSTANCE` | desconexión definitiva (F32, Bloque 4) |
>
> Y un detalle de la misma lectura: la línea 126 exige `regex.test(instance.url)` con
> `/^(https?:\/\/)/`, así que la URL del webhook **tiene que incluir el esquema**. Sin `https://`
> no se emite y no hay ningún error.

### Autenticación

| Variable | Valor | Por qué |
|---|---|---|
| `AUTHENTICATION_API_KEY` | Se genera en el paso 5 | La clave global del servidor |
| `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` | `false` | Ver abajo. **El motivo que este documento le atribuía era falso** |

> #### Corrección del 17 de septiembre de 2026: esa variable no hace lo que decíamos
>
> Este documento afirmaba que con `true` Evolution mete el token de la instancia en el cuerpo de
> cada webhook, y que por eso lo poníamos en `false`. **Es falso, y se descubrió mirando.**
>
> **Verificado empíricamente** contra nuestro propio despliegue, con la variable en `false`:
> `GET /instance/fetchInstances` devuelve igual el campo `token` con el valor real.
>
> **Verificado en el código de la 2.3.7:** `emit()` arma el cuerpo con `apikey: apiKey` **sin
> ninguna condición**. No está atado a esta variable ni a ninguna otra. El token viaja en el cuerpo
> de cada aviso, se ponga lo que se ponga acá.
>
> **La variable se lee y no se consume en ese camino.** Era una inferencia hasta que se cerró su
> control positivo: **confirmado en Railway el 17/09/2026 que `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES`
> existe y dice `false`, escrita así.** Eso descarta la otra explicación posible, que era que la
> variable nunca se hubiera aplicado. Se lee (`env.config.ts`:
> `EXPOSE_IN_FETCH_INSTANCES: process.env?.AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES === 'true'`) y
> no se consume en el camino de `fetchInstances` en esta versión.
>
> Sin esa confirmación en Railway, el resultado empírico no distinguía "la variable no hace lo que
> dice" de "la variable nunca llegó al contenedor". Es el mismo patrón que el control positivo del
> despliegue.
>
> **Se deja en `false` igual**, porque cuesta cero y porque una versión futura puede empezar a
> consumirla. Pero **no se cuenta como defensa**. Lo que de verdad protege ese token son dos cosas
> que ya están en el código y que hay que preservar:
>
> * `route.ts` declara `apikey?: string` en la forma del payload explícitamente "para dejar
>   constancia de que VIENE, no para usarlo", y nunca lo usa como autenticación.
> * Ningún log del receptor escribe el cuerpo crudo.
>
> El error de fondo fue escribir un motivo plausible sin comprobarlo. Una variable con una
> justificación falsa al lado es peor que una sin justificación: se cuenta como protección en los
> repasos de seguridad y nadie vuelve a mirarla.

### QR

| Variable | Valor | Por qué |
|---|---|---|
| `QRCODE_LIMIT` | `30` | Después de 30 códigos sin escanear, Evolution emite `state: 'refused'`, que significa "empezar de nuevo" |

---

## 4. Dominio público

En el servicio de Evolution: **Settings → Networking → Public Networking → Generate Domain**,
puerto `8080`.

Después, volver a Variables y completar `SERVER_URL` con esa URL, con `https://` y sin barra final.

**Por qué el dominio es público y no basta la red privada.** Railway permite que los servicios se
hablen por `*.railway.internal`, pero eso no sirve como capa de defensa acá, y conviene dejarlo
escrito para que nadie lo cuente como tal más adelante: **nuestro receptor es una ruta de la app
Next.js, y esa app tiene dominio público porque es el dashboard**. Que Evolution entre por la
puerta privada no cierra la pública. Para que esa capa fuera real habría que sacar el receptor a un
servicio propio sin dominio, y eso es un cambio de arquitectura que hoy no está costeado.

Guardar la URL en el `.env` local como `EVOLUTION_API_URL`, que es de donde la leen los scripts.
No es un secreto: es una dirección.

**Cómo verificar:**

```bash
curl -s https://TU-EVOLUTION.up.railway.app/ | head -c 400
```

Tiene que responder con el JSON de bienvenida de Evolution, con su versión.

---

## 5. La clave global, derecho a Vault

**Ningún secreto pasa por la terminal ni por la conversación.** Un secreto impreso queda en el
scrollback, en el historial del shell y en la transcripción de la sesión. Con la API key de Zernio
ya nos pasó y hubo que rotarla.

```bash
node scripts/set-evolution-secret.mjs evolution_api_key
```

Genera 32 bytes al azar, los guarda en Vault, los deja en el portapapeles y **solo imprime el
largo**. Pegalo en Railway como `AUTHENTICATION_API_KEY` sin leerlo.

**Cómo verificar:**

```bash
node scripts/verify-evolution-secrets.mjs
```

Imprime `presente` y la cantidad de caracteres, nunca el valor.

Y contra el servidor, que es la verificación que de verdad cierra el círculo:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://TU-EVOLUTION.up.railway.app/instance/fetchInstances
# 401 sin la clave: el servidor está protegido
```

---

## 6. Verificación del despliegue

```bash
node scripts/verify-evolution-deploy.mjs
```

Tres comprobaciones, que se pueden hacer antes de crear la instancia:

1. **La versión desplegada es la fijada en el repo.** Verificado en `index.router.ts:199-204`:
   `GET /` responde `{ status, message, version, clientName, manager, ... }`, donde `version` sale
   del `package.json` de Evolution. Para la imagen fijada reporta `2.3.7`.
2. **El servidor rechaza sin clave.** `GET /instance/fetchInstances` sin header devuelve 401.
3. **El servidor acepta con clave.** El mismo endpoint con el header `apikey` devuelve 200.

**La tercera es el control positivo de la segunda**, y no es un formalismo: sin ella, un 401 podría
venir de un servidor que no arrancó y no de uno bien protegido. Si la tercera falla, el script dice
**"no concluyente"** sobre la segunda, con esas palabras, en vez de darla por verde.

### El disparador de versión, y por qué está acá y no en este documento

La sección 0 dice que hay que releer `webhook.controller.ts` antes de subir de versión. **Eso solo
no es un control**: depende de que alguien lea este documento antes de cambiar un tag en la interfaz
de Railway, que es exactamente lo que no va a pasar.

Por eso la versión esperada vive en el repo, en `lib/evolution-version.mjs`, con el procedimiento
completo en el comentario de al lado y las líneas exactas contra las que comparar. Y está enganchada
en dos lugares, que atrapan cosas distintas:

| Dónde | Qué atrapa | Necesita red |
|---|---|---|
| `npm test` (`lib/evolution-version.test.ts`) | Que alguien cambie el tag de la imagen y se olvide de la versión esperada | No |
| `npm run verify:security` (este script) | Que lo desplegado no sea lo que el repo dice | Sí |

Cuando la comprobación 1 falla, el mensaje no dice solo "no coincide": dice qué hay que leer y por
qué, y recuerda que el mecanismo no está documentado y puede desaparecer sin aviso.

**Mientras `EVOLUTION_API_URL` no esté en el `.env`, el script se saltea**, pero lo hace en voz
alta:

```
  SALTEADO  verificación del despliegue de Evolution
            falta EVOLUTION_API_URL en .env
            (esperado hasta que se complete el Paso 3 del Bloque 2;
             a partir de ahí, que esto aparezca es un problema)
```

Un check que se saltea en silencio cuando falta configuración es la forma en que los checks se
mueren: pasa en verde durante meses y nadie nota que dejó de comprobar nada.

---

## 7. Instancia y webhook

```bash
node scripts/setup-evolution-channel.mjs <nombre-de-la-instancia>
```

El script hace seis cosas, y **el orden es el control, no un detalle**:

1. Resuelve el workspace y lee la clave global de Vault.
2. Crea la fila en `channels` con `provider = 'evolution'`, su `instance_name`, `late_account_id`
   en nulo y **`is_active = false`**.
3. Crea la instancia con `qrcode: false`, `syncFullHistory: true` y `groupsIgnore: true`.
4. Guarda el token que devuelve Evolution en Vault, **con el id del canal adentro**
   (`evolution_instance_token:<channel_id>`). Ver abajo por qué.
5. Resuelve el secreto del webhook —**lo reusa si ya existe**— y configura el webhook **por
   instancia**, con `POST /webhook/set/{instance}` y el header `jwt_key`. Después **lo lee de vuelta**
   con `GET /webhook/find/{instance}` y compara URL, `enabled` y la lista de eventos.
6. Pone `is_active = true`.

### Por qué la fila va antes que la instancia

La fila no depende de Evolution: el `instance_name` lo elegimos nosotros. Así, **lo que falle antes
del paso 3 deja una fila inactiva**, que se borra o que un reintento con el mismo nombre vuelve a
encontrar por el índice único de la 00022. Al revés dejaría una instancia creada con un token que no
se puede recuperar.

Y arranca en `is_active = false` para que no exista, ni por un instante, un canal activo sin
instancia detrás: el receptor filtra por `is_active`, así que un canal activo a medio construir es
una ventana en la que los avisos se rechazan.

**El único paso irreversible es el 3**, y la ventana que importa es entre el 3 y el 4: si el token no
llega a Vault, no se recupera. La salida de recuperación del script apunta a `--borrar-instancia`.

### El secreto del webhook se reusa, no se regenera

Es el punto más fácil de romper sin darse cuenta. El secreto es **por workspace**. Si un segundo
canal generara uno nuevo, el webhook del primero quedaría firmando con un secreto que ya no está en
Vault y **todos sus mensajes entrantes empezarían a dar 401**, que Evolution no reintenta. Regenerar
es siempre explícito, con `set-evolution-secret.mjs --rotar`.

### La lectura de vuelta del paso 5 no es una formalidad

El cuerpo va anidado bajo `webhook` (verificado en `event.dto.ts` de la 2.3.7). Si la forma fuera la
equivocada, Evolution podría contestar 200 sin guardar nada y el script cantaría éxito sobre un
webhook que no existe. Además, **`events: []` no significa "ninguno", significa los 31**:
`event.controller.ts` hace `if (0 === events.length) events = EventController.events`. La lectura de
vuelta es lo que detecta las dos cosas.

`byEvents` va en `false`: en `true`, Evolution le agrega el nombre del evento al final de la URL, y
nuestro receptor es una ruta sola.

### Rotar el token de una instancia

Evolution lo entrega en el `create` y no lo vuelve a dar, así que la única rotación posible es borrar
y recrear:

```bash
node scripts/setup-evolution-channel.mjs <instancia> --borrar-instancia
node scripts/setup-evolution-channel.mjs <instancia>
node scripts/verify-evolution-webhook.mjs
```

El borrado lee la clave global de Vault y **no la imprime**. Una versión anterior de este documento
sugería un `curl -H "apikey: <la clave>"`, que deja el secreto en el scrollback y en el historial del
shell: es la clase de atajo que convierte un procedimiento de emergencia en una filtración.

### Por qué un secreto es por workspace y el otro por canal

La asimetría no es obvia y la tentación de unificarlos es real.

**El secreto del webhook es por workspace** porque prueba una sola cosa: que el evento vino de
nuestro despliegue de Evolution. Hay un solo despliegue, así que dos instancias firmando con el
mismo secreto es correcto.

**El token de la instancia es por canal** porque Evolution lo genera por instancia y autoriza
operar *esa* instancia. Con el nombrado `ws:<workspace_id>:<nombre>` de la migración 00018,
guardarlo como secreto de workspace haría que la segunda instancia pisara el token de la primera.
El día que el negocio quiera dos números, ventas y soporte, el de soporte se queda con el token de
ventas y nadie se entera hasta que un envío sale por el número equivocado.

---

## 8. Verificación de punta a punta

```bash
node scripts/verify-evolution-webhook.mjs
```

**El control positivo va primero, y no es un formalismo.** Una batería de "esto se rechaza" no
distingue entre *se rechazó porque está bien protegido* y *se rechazó porque nada llegó a
ejecutarse*. Si el evento firmado válido no llega, el veredicto de todo lo demás es **"no
concluyente"**, dicho con esas palabras, nunca verde.

Qué comprueba, en orden:

1. Un evento firmado con el secreto real llega al receptor y devuelve **200**.
2. Un evento repetido se acusa sin reprocesar.
3. Un token vencido devuelve 401.
4. Un token firmado con otro secreto devuelve 401.
5. Los rechazos dejaron la condición abierta en `webhook_alerts`, con su contador.
6. Un evento válido posterior la cerró.
7. La alerta de sistema **no es legible por RLS**, con su control positivo.

### Por qué el evento repetido está segundo y no cuarto

Porque un evento repetido es un evento **válido**, y en `route.ts` el orden del receptor es:
verificar el token → `resolverAlertas()` → recién ahí el control de duplicados. Cualquier entrega
válida cierra `webhook_auth_failed`, incluida una que después se descarta por repetida.

Con esa comprobación después de los rechazos, cerraba la condición que ellos acababan de abrir, la 5
la buscaba y no la encontraba, y **la 6 pasaba en falso**: afirmaba "el evento válido la cerró"
mirando que no quedara ninguna abierta, cosa trivialmente cierta cuando nunca hubo una. Un
verificador que altera el estado que está midiendo puede fabricar la condición que dice comprobar.
La regla general quedó escrita en `CLAUDE.md`, separada de la del control positivo, porque es otra
familia: un control positivo no la habría detectado.

Por eso ahora la 6 está atada a la 5: si la 5 no encontró nada abierto, la 6 dice **"no
concluyente"** en vez de verde.

### La séptima cambió con la 00023, y el documento decía lo contrario

Este documento pedía probar que "un Owner **puede leer** la condición de instancia desconocida, y un
Member no". Era cierto con la 00022, que tenía `is_any_workspace_owner()` y una policy para las filas
sin workspace. **La 00023 borró las dos.** Hoy esas filas no tienen ninguna vía de lectura por RLS y
se leen del lado del servidor con el cliente de servicio detrás de una guarda de rol.

Así que el verificador prueba lo que hoy tiene que ser cierto: que **ninguna persona la lee por
RLS**. El control positivo es que el mismo token sí lee una alerta de su propio workspace — sin eso,
cero filas no distingue "la policy lo niega" de "la consulta estaba mal escrita".

**Lo que esa comprobación NO prueba, y el script lo dice con todas las letras en su salida:** que una
**persona** pueda ver la alerta de sistema en la pantalla. Eso depende de dos guardas de rol escritas
a mano en el servidor —`page.tsx` pasa `esOwner={role === "owner"}`, y `webhook-alerts-actions.ts`
corta con `role !== "owner"`— y **ninguna de las dos tiene test hoy**. No se cuenta como probado.
Cerrar ese hueco sin `jsdom` ni `@testing-library` es posible extrayendo la decisión de rol a una
función pura; queda anotado como pendiente.

---

## 9. Rotación del secreto del webhook

**Un 401 cancela los reintentos de Evolution y descarta el evento.** No hay cola de reproceso. Una
rotación mal hecha no da errores: pierde mensajes, en silencio, durante toda la ventana.

El orden es lo único que lo evita:

```bash
# 1. Guarda el actual como "anterior" y genera uno nuevo.
#    Desde acá el receptor acepta los dos.
node scripts/set-evolution-secret.mjs evolution_webhook_secret --rotar

# 2. Reconfigurar el webhook en Evolution con el secreto nuevo.
node scripts/setup-evolution-channel.mjs <instancia> --solo-webhook

# 3. Confirmar que Evolution ya firma con el nuevo.
node scripts/verify-evolution-webhook.mjs
```

**El paso 3 no es opcional.** Mientras Evolution siga firmando con el viejo, el receptor lo avisa
con un warning que dice exactamente eso:

```
[evolution] la instancia "..." firmó con el secreto ANTERIOR.
Si la rotación ya terminó, Evolution no tomó el nuevo: no borres el anterior todavía.
```

**Recién con eso confirmado**, borrar el anterior:

```bash
node scripts/verify-evolution-secrets.mjs
# evolution_webhook_secret_previous debería seguir presente acá
```

Y borrarlo desde la pantalla de integraciones, o con `delete_secret`. Mientras
`evolution_webhook_secret_previous` exista, el verificador lo marca con un aviso: una rotación a
medio terminar no puede quedar invisible.

---

## 10. Migración al dominio propio: cinco lugares

**Estado al 17 de septiembre de 2026:** `app.alomercadeo.com` funciona, con certificado. El problema
había sido el registro TXT, que el hosting cargó sin el guion bajo inicial del nombre; ya está
renombrado.

Este checklist queda porque **dos de los cinco puntos se cierran recién al conectar el canal**, y
porque el día que el dominio cambie otra vez hay que moverlo todo junto. Cambiar uno solo no arregla
nada.

| # | Qué | Estado | Cómo se verifica con tráfico real |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_APP_URL` | Hecho | Es la que alimenta a las otras. Ver la nota del build más abajo |
| 2 | URLs de Supabase Auth (Site URL y Redirect URLs) | Hecho | Cerrar sesión y volver a entrar desde el dominio nuevo |
| 3 | Webhook de Zernio | Hecho y verificado | **Un DM real que entre a la bandeja.** No alcanza con "no vi errores" |
| 4 | Webhook de Evolution | **Hecho y verificado el 17/09/2026** | `node scripts/verify-evolution-webhook.mjs` |
| 5 | `redirect_url` del OAuth de Zernio | Pendiente de verificar | Reconectar el canal de Instagram desde cero |

### Riesgo aceptado: la entrega de mensajes ahora depende del DNS del hosting

Al registrar el webhook en `app.alomercadeo.com`, la entrega de **cada mensaje entrante de WhatsApp**
pasa a depender de que ese nombre resuelva. Y el proveedor de hosting que administra esa zona tardó
dos intentos en cargar bien un registro TXT: lo cargó sin el guion bajo inicial del nombre.

**No se cambia nada.** El dominio propio es la decisión correcta —no depender de un subdominio de
Railway que puede cambiar— y re-registrar el webhook es un procedimiento escrito, de un comando. Lo
que no puede pasar es que nadie lo haya mirado y aparezca como sorpresa.

Qué pasa si el DNS falla: Evolution no puede entregar, la entrega falla con error de red (no con un
código de la lista que cancela reintentos), así que **reintenta hasta 10 veces con retroceso
exponencial**, unos 20 minutos. Dentro de esa ventana, arreglar el DNS recupera todo. Pasada la
ventana, los mensajes se pierden.

Cómo se detecta: **no hay forma de detectarlo hoy**, y F32 no lo arregla. Conviene dejar escrito por
qué, porque es la conclusión intuitiva y es falsa.

### Por qué F32 no cubre esto, aunque lo parezca

F32 es el chequeo del estado de la **sesión de WhatsApp**. Si se cae el DNS de
`app.alomercadeo.com`, la sesión sigue conectada y sana: Evolution recibe los mensajes, intenta
entregarlos en una URL que no resuelve, reintenta veinte minutos y los descarta. **F32 mostraría
verde todo el tiempo, con razón**, porque lo que mira está bien. Lo que está roto es el tramo entre
Evolution y nosotros, que F32 no mira.

### Lo que sí lo cubre: una comprobación de silencio (funcionalidad nueva, sin construir)

Un interruptor de hombre muerto: algo que note que hace N horas que **no entra ningún evento** por el
canal, y avise. Es el único control que sirve cuando el problema es que no llega nada, porque
cualquier control que se dispare con lo que llega es ciego por definición ante la ausencia.

**Por qué vale la pena, y no es paranoia:** hay al menos **tres causas distintas que producen
exactamente el mismo síntoma**, y dos de las tres son hoy completamente invisibles.

| Causa | ¿Se detecta hoy? |
|---|---|
| DNS caído o mal apuntado | No. El aviso nunca llega al receptor, así que `webhook_alerts` no registra nada |
| Sesión de WhatsApp expirada | Sí, con F32, cuando exista |
| Webhook registrado en la URL vieja después de un cambio de dominio | No. Mismo caso que el punto 3 de esta sección: todo "funciona" y no hay un solo error en ningún log |

Y el síntoma común es que **la bandeja queda callada, que es indistinguible de que nadie haya
escrito**. Para un negocio cuyos leads llegan por pauta, un día flojo y un canal roto se ven igual.

**Forma mínima, para dimensionarla:** una columna con la marca de tiempo del último evento entrante
por canal, que el receptor actualiza, más un trabajo periódico que compara contra un umbral y abre
una condición en `webhook_alerts`, que ya existe y ya tiene su banner. La cola de trabajos
(`scheduled_jobs`) también existe. No es infraestructura nueva.

**Dónde la ubicaría: en el Bloque 3, junto con F27, y no en el Bloque 4.** El motivo es que la alarma
solo es interpretable cuando hay tráfico esperable, y ese momento es exactamente cuando se vincula el
número, que es lo que habilita F27. Antes de eso el silencio es el estado correcto y la alarma
sonaría para siempre. Después de eso, cada día que pase sin la comprobación es un día con el número
en vivo y dos de las tres causas invisibles. Dejarla para el Bloque 4 abre esa ventana a propósito.

**Todavía no está numerada como F ni agregada al plano**: la ubicación está propuesta, no decidida.

### El punto 3 falla en silencio, y peor de lo que parece

Verificado: `ensureWebhookRegistered` está envuelto en try/catch en sus dos llamadores
(`app/api/v1/channels/sync/route.ts` y `app/api/v1/channels/test-key/route.ts`), y los dos solo
hacen `console.error`.

Pero **el modo de falla que importa no es una excepción atrapada: es que nadie lo dispare.** El
registro corre únicamente cuando alguien aprieta "Sincronizar" en la pantalla de canales o vuelve a
guardar la API key. Si se cambia el dominio y no se hace ninguna de las dos cosas, Zernio sigue
entregando en la URL vieja, todo "funciona", y los DM dejan de llegar sin un solo error en ningún
log.

Por eso su verificación no puede ser "no vi errores": tiene que ser un DM real que aparezca en la
bandeja.

### El punto 5 es fácil de olvidar porque solo importa un rato

`app/api/v1/channels/connect/route.ts` arma `${appUrl}/dashboard/channels/callback` y se lo pasa a
Zernio como `redirect_url`. Solo se usa durante un flujo de conexión, así que un valor viejo no da
ningún síntoma hasta que alguien intenta reconectar un canal, y ahí el flujo muere a mitad de
camino.

### `NEXT_PUBLIC_APP_URL` se inlinea en build

Tiene el prefijo `NEXT_PUBLIC_`, así que Next la resuelve **en tiempo de compilación**. Cambiarla en
Railway exige un **redeploy**, no alcanza con reiniciar el servicio.

---

## 11. Deudas anotadas del Bloque 2

Dos, las dos con la solución escrita para que retomarlas no cueste redescubrirlas.

### Las dos guardas de rol de las alertas no tienen test

Desde la 00023, quién ve una alerta de sistema (`workspace_id` nulo) no lo decide la RLS: lo deciden
dos comprobaciones escritas a mano en el servidor.

| Archivo | La guarda |
|---|---|
| `app/(dashboard)/dashboard/channels/page.tsx` | `esOwner={role === "owner"}` |
| `app/(dashboard)/dashboard/channels/webhook-alerts-actions.ts` | `if (esDeSistema && role !== "owner") return;` |

Ninguna de las dos tiene cobertura. `verify-evolution-webhook.mjs` prueba la mitad negativa —que
nadie las lee por RLS— y **dice en su propia salida que la mitad positiva no está probada**, para que
nadie cuente ese "7 de 7" como completo.

**La solución, sin dependencias nuevas:** el proyecto tiene `vitest` pero no `jsdom` ni
`@testing-library`, así que probar el componente exigiría sumar dos dependencias para verificar una
comparación de string. En vez de eso, extraer la decisión a una función pura —del estilo
`puedeVerAlertasDeSistema(role)`— usarla en los dos lugares y testearla sola. Cubre lo que importa,
que es que la condición no se invierta ni se afloje, y no arrastra un entorno de DOM.

### La comprobación de silencio no existe

Ver el riesgo aceptado del DNS en la sección 10. Es funcionalidad nueva, no parte de F32, y la
ubicación propuesta es el Bloque 3 junto con F27. Sin ella, dos de las tres causas de "la bandeja
está callada" son invisibles.

---

## 12. Problemas frecuentes

| Síntoma | Causa probable | Qué mirar |
|---|---|---|
| La bandeja no recibe nada y no hay ningún error | El canal quedó `is_active = false` | Pasaba antes de la 00022: el botón "Sincronizar" desactivaba el canal de Evolution. Corregido en `lib/channel-rules.ts` con test |
| Alerta "están llegando mensajes de una conexión que no reconocemos" | Se renombró la instancia en Evolution y `channels.instance_name` quedó apuntando al nombre viejo | Comparar `GET /instance/fetchInstances` con la columna |
| Alerta "WhatsApp está rechazando los mensajes que llegan" | Rotación a medio hacer, o el secreto de Evolution no es el de Vault | `node scripts/verify-evolution-secrets.mjs` y el log del receptor, que dice el motivo exacto |
| El receptor devuelve 401 con "el token está vencido" | Desfasaje de reloj en el servidor de Evolution | El verificador ya tolera 60 segundos; más que eso es un problema del host |
| Evolution arranca y muere | `DATABASE_CONNECTION_URI` sin `?schema=evolution_api` | Los logs del servicio en Railway |
| Después de un redeploy hay que escanear el QR de nuevo | Se perdió el volumen del PostgreSQL | La sesión vive ahí, no en Evolution |
