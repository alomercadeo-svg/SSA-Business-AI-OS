# Despliegue de Evolution API en Railway

Procedimiento reproducible para dejar corriendo el servicio de WhatsApp (F21).

**Fecha:** 16 de septiembre de 2026.
**Versión desplegada:** Evolution API 2.3.7.

**Qué deja andando:** dos servicios en Railway, Evolution y su PostgreSQL, con una instancia creada
y el aviso de mensajes apuntando a nuestro receptor. **Sin ningún número vinculado.**

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
| `LOG_LEVEL` | `ERROR,WARN,INFO` | El default incluye `DEBUG` y `VERBOSE`, que llenan el log de Railway y pueden imprimir cuerpos de mensajes |
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
| `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` | `false` | **El default es `true`.** Con `true`, Evolution incluye el token de la instancia en el cuerpo de **cada webhook**. Ese token autoriza mandar mensajes, leer conversaciones y borrar la instancia: cualquier log que registre el cuerpo completo guarda una credencial en texto plano |

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

El script hace cuatro cosas, en este orden:

1. Crea la instancia con `syncFullHistory: true` y `groupsIgnore: true`.
2. Guarda el token que devuelve Evolution en Vault, **con el nombre del canal adentro**
   (`evolution_instance_token:<channel_id>`). Ver abajo por qué.
3. Genera el secreto del webhook, lo guarda en Vault y configura el webhook **por instancia**, con
   `POST /webhook/set/{instance}` y el header `jwt_key`.
4. Crea la fila en `channels` con `provider = 'evolution'`, su `instance_name` y
   `late_account_id` en nulo.

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
2. Un token vencido devuelve 401.
3. Un token firmado con otro secreto devuelve 401.
4. Un evento repetido se acusa sin reprocesar.
5. El rechazo dejó la condición abierta en `webhook_alerts`, con su contador.
6. Un evento válido posterior la cerró.
7. Un Owner **puede leer** la condición de instancia desconocida, y un Member no.

La séptima merece su párrafo. Esa condición tiene `workspace_id` en nulo por definición, porque un
aviso para una instancia que no existe no es atribuible a ningún workspace. Con una sola política
de lectura, la fila se registraría con su contador perfecto y **no la podría leer nadie**: ni el
Owner, ni el indicador de la pantalla de canales. La alerta existiría y no alertaría. Por eso hay
una segunda política y por eso el control positivo está en la lista.

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
| 4 | Webhook de Evolution | Pendiente: se registra en el paso 7 | `node scripts/verify-evolution-webhook.mjs` |
| 5 | `redirect_url` del OAuth de Zernio | Pendiente de verificar | Reconectar el canal de Instagram desde cero |

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

## 11. Problemas frecuentes

| Síntoma | Causa probable | Qué mirar |
|---|---|---|
| La bandeja no recibe nada y no hay ningún error | El canal quedó `is_active = false` | Pasaba antes de la 00022: el botón "Sincronizar" desactivaba el canal de Evolution. Corregido en `lib/channel-rules.ts` con test |
| Alerta "están llegando mensajes de una conexión que no reconocemos" | Se renombró la instancia en Evolution y `channels.instance_name` quedó apuntando al nombre viejo | Comparar `GET /instance/fetchInstances` con la columna |
| Alerta "WhatsApp está rechazando los mensajes que llegan" | Rotación a medio hacer, o el secreto de Evolution no es el de Vault | `node scripts/verify-evolution-secrets.mjs` y el log del receptor, que dice el motivo exacto |
| El receptor devuelve 401 con "el token está vencido" | Desfasaje de reloj en el servidor de Evolution | El verificador ya tolera 60 segundos; más que eso es un problema del host |
| Evolution arranca y muere | `DATABASE_CONNECTION_URI` sin `?schema=evolution_api` | Los logs del servicio en Railway |
| Después de un redeploy hay que escanear el QR de nuevo | Se perdió el volumen del PostgreSQL | La sesión vive ahí, no en Evolution |
