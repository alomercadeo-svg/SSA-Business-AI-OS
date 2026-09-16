# Investigación: Evolution API

Insumo para escribir los requerimientos de los Bloques 2 a 4. Cinco preguntas, cada respuesta
con su grado de confianza y su fuente.

**Fecha de la investigación:** 16 de septiembre de 2026.

**Qué se leyó:** el código fuente de `EvolutionAPI/evolution-api`, rama `main`, cuyo
`package.json` declara la versión **2.3.7**. Se leyó por HTTP archivo por archivo, sin clonar el
repositorio. También la documentación oficial, que hoy vive en `docs.evolutionfoundation.com.br`
(`doc.evolution-api.com` redirige ahí con un 302). Para los puntos que no dependen de Evolution
se consultaron las fuentes correspondientes: documentación de Railway, código de `minio-js`, y la
API de Docker Hub.

**Cómo leer los grados de confianza:**

- **Verificado** — leído directo en el código fuente o en la documentación oficial, con archivo y
  línea, o URL.
- **Inferencia** — deducido de algo verificado, con un paso de razonamiento en el medio.
- **Suposición** — no lo pude verificar. Va en la sección de pendientes, no mezclado con lo demás.

---

## Veredicto de la Pregunta 1: la decisión de canal no se toca

**Evolution API no firma el cuerpo del webhook. No hay HMAC. No hay ningún mecanismo nativo
equivalente al de Zernio.** Verificado.

**Y aun así, alcanza.** Existe un header llamado `jwt_key` que hace que Evolution firme un JWT
HS256 nuevo en cada entrega, con el secreto compartido, y lo mande en `Authorization: Bearer`.
El secreto nunca viaja por el cable. El token caduca a los 10 minutos.

La amenaza real contra una bandeja de chat es la **inyección de mensajes falsos**: que alguien
que descubre la URL del webhook nos meta conversaciones inventadas, dispare secuencias, o
contamine los datos del CRM. Contra esa amenaza, un token firmado que no se puede fabricar sin el
secreto es una defensa completa. Sumado a la idempotencia por clave compuesta, que hace que un
reenvío del mismo mensaje no duplique nada, el riesgo queda cubierto.

Lo que el JWT **no** hace es atar la firma al cuerpo. Prueba quién manda, no qué manda. La
diferencia práctica con el HMAC de Zernio aparece solo si alguien puede interceptar y modificar
el tráfico entre Evolution y nuestra app, y actuar dentro de la ventana de 10 minutos del token.
Eso implica romper TLS entre dos servicios del mismo proyecto de Railway. Es un escenario de
atacante en la red, no el escenario que estamos defendiendo.

**Conclusión: se sigue con Evolution API.** La garantía no es idéntica a la de Zernio, pero es
suficiente para la amenaza que importa, y el diseño no necesita cambiar de arquitectura para
conseguirla.

### Una capa que no sirve, y por qué la descarto explícitamente

La red privada de Railway **no** es una capa de defensa acá, y conviene dejarlo escrito para que
nadie la cuente como tal más adelante. Railway permite que Evolution le hable a nuestra app por
`http://<servicio>.railway.internal:<puerto>`, sin salir a internet. Pero nuestro receptor de
webhooks es una **ruta de la app Next.js**, y esa app tiene dominio público porque es el
dashboard. Que Evolution entre por la puerta privada no cierra la puerta pública: la misma ruta
sigue siendo alcanzable desde internet por cualquiera que la conozca.

Para que esa capa fuera real habría que sacar el receptor a un servicio propio de Railway, sin
dominio público. Eso es un cambio de arquitectura que hoy no está costeado. Queda como opción
disponible si alguna vez el riesgo lo justifica, no como algo que ya tengamos.

### La consecuencia de diseño que hay que decidir sí o sí

`401` está en la lista por defecto de códigos que **cancelan los reintentos**. Si fallamos
cerrado con 401, como hacemos con Zernio, Evolution descarta el evento y no lo reintenta nunca.
Un mensaje de un lead perdido en silencio.

Eso no es motivo para dejar de fallar cerrado. Es motivo para que la rotación del secreto tenga
un procedimiento: aceptar el secreto viejo y el nuevo durante la ventana de rotación, y alertar
sobre cualquier 401. El detalle está en la Pregunta 1 completa.

---

## Pregunta 1 — Autenticación del webhook

### Lo que Evolution no hace

**No firma el cuerpo. Verificado.** El archivo
`src/api/integrations/event/webhook/webhook.controller.ts` es el único punto del código que
construye la petición HTTP saliente de un webhook. Los otros integradores de eventos
(RabbitMQ, SQS, Kafka, NATS, Pusher, WebSocket) no son HTTP. En ese archivo no se calcula ningún
hash del cuerpo.

**No hay configuración de secreto ni de firma. Verificado.** En `src/config/env.config.ts`, el
tipo `Webhook` es:

```ts
export type Webhook = {
  GLOBAL?: GlobalWebhook;
  EVENTS: EventsWebhook;
  REQUEST?: {
    TIMEOUT_MS?: number;
  };
  RETRY?: {
    MAX_ATTEMPTS?: number;
    INITIAL_DELAY_SECONDS?: number;
    USE_EXPONENTIAL_BACKOFF?: boolean;
    MAX_DELAY_SECONDS?: number;
    JITTER_FACTOR?: number;
    NON_RETRYABLE_STATUS_CODES?: number[];
  };
};
```

Ni secreto, ni firma, ni algoritmo. Las únicas variables con secretos en `.env.example` son las
de SQS, Pusher y S3.

**No hay lista blanca de IP para webhooks. Verificado.** `.env.example` tiene
`METRICS_ALLOWED_IPS` (para el endpoint de Prometheus) y `WEBSOCKET_ALLOWED_HOSTS` (para el
WebSocket). Nada equivalente para el webhook saliente, y no tendría sentido: la lista blanca la
tendríamos que aplicar nosotros, del lado que recibe.

**La documentación oficial tampoco menciona autenticación. Verificado.** La página
[Webhooks](https://docs.evolutionfoundation.com.br/en/evolution-api/configuration/webhooks)
describe `enabled`, `url`, `webhook_by_events` y `events`. No hay sección de seguridad ni mención
de headers de autenticación.

### Lo que sí hace: el header `jwt_key`

**Verificado**, en `webhook.controller.ts`. Es el mecanismo sobre el que se apoya toda la
respuesta, así que va citado textual.

Al emitir, líneas 78 a 86:

```ts
const webhookHeaders = { ...((instance?.headers as Record<string, string>) || {}) };

if (webhookHeaders && 'jwt_key' in webhookHeaders) {
  const jwtKey = webhookHeaders['jwt_key'];
  const jwtToken = this.generateJwtToken(jwtKey);
  webhookHeaders['Authorization'] = `Bearer ${jwtToken}`;

  delete webhookHeaders['jwt_key'];
}
```

La generación del token, líneas 287 a 305:

```ts
private generateJwtToken(authToken: string): string {
  try {
    const payload = {
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600, // 10 min expiration
      app: 'evolution',
      action: 'webhook',
    };

    const token = jwt.sign(payload, authToken, { algorithm: 'HS256' });
    return token;
  } catch (error) {
    this.logger.error({
      local: 'WebhookController.generateJwtToken',
      message: `JWT generation failed: ${error?.message}`,
    });
    throw error;
  }
}
```

Y el envío, líneas 127 a 131:

```ts
const httpService = axios.create({
  baseURL,
  headers: webhookHeaders as Record<string, string> | undefined,
  timeout: webhookConfig.REQUEST?.TIMEOUT_MS ?? 30000,
});
```

Qué significa cada pieza, en castellano:

- El valor de `jwt_key` es el secreto compartido. Se configura una vez, al registrar el webhook
  de la instancia, y **se borra del objeto de headers antes de enviar** (línea 85): nunca sale
  por el cable.
- En cada entrega se firma un token nuevo con HS256. La carga útil es fija
  (`app: 'evolution'`, `action: 'webhook'`) más `iat` y `exp`. Expira a los 600 segundos.
- Lo que verificamos nosotros es que el token esté firmado con nuestro secreto y no haya
  caducado. Sin el secreto no se puede fabricar un token válido.

**Cómo se configura. Verificado** en `src/api/integrations/event/webhook/webhook.schema.ts`: el
cuerpo de `POST /webhook/set/{instance}` es
`{ webhook: { enabled, url, headers, byEvents, base64, events } }`, donde `headers` es un objeto
libre. Se guarda en la columna `headers` (JSONB) de la tabla `Webhook`, una fila por instancia
(`instanceId` es único), verificado en `prisma/postgresql-schema.prisma`.

**Caveat operativo, verificado:** los headers personalizados **solo funcionan con el webhook por
instancia**, no con el webhook global. En `webhook.controller.ts`, líneas 172 a 175, el cliente
axios del webhook global se construye sin `headers`. O sea: hay que configurar el webhook con
`POST /webhook/set/{instance}`, y dejar `WEBHOOK_GLOBAL_ENABLED=false`.

### Cómo verificarlo del lado nuestro

Inferencia, apoyada en el código citado. La verificación tiene que fijar el algoritmo:

- Verificar con el mismo secreto y `algorithms: ['HS256']` explícito. Sin fijar el algoritmo, un
  atacante puede intentar confusión de algoritmo o `alg: none`. Esto no es una particularidad de
  Evolution: es cómo se verifica cualquier JWT.
- No confiar en nada del cuerpo para decidir si el webhook es legítimo.
- Rechazar con 401 cuando la firma falla o el token caducó, igual que con Zernio.
- La caducidad de 10 minutos limita el replay, pero no lo elimina. La defensa contra replay es la
  idempotencia por clave compuesta (Pregunta 2), que además hace falta por otras razones.

### Reintentos y el 401 que no se reintenta

**Verificado**, en `webhook.controller.ts`. Es la segunda afirmación sobre la que se apoya todo lo
demás, así que también va textual.

La lista, línea 218:

```ts
const nonRetryableStatusCodes = webhookConfig.RETRY?.NON_RETRYABLE_STATUS_CODES ?? [400, 401, 403, 404, 422];
```

El corte, líneas 238 a 247:

```ts
if (error?.response?.status && nonRetryableStatusCodes.includes(error.response.status)) {
  this.logger.error({
    local: `${origin}`,
    message: `Erro não recuperável (${error.response.status}): ${error?.message}. Cancelando retentativas.`,
    statusCode: error?.response?.status,
    url: baseURL,
    server_url: serverUrl,
  });
  throw error;
}
```

Y la variable que lo configura, en `.env.example` línea 302:

```
WEBHOOK_RETRY_NON_RETRYABLE_STATUS_CODES=400,401,403,404,422
```

En castellano: cuando devolvemos 401, Evolution registra el error, **corta los reintentos y
descarta el evento**. No hay cola de reproceso, no hay segunda oportunidad. El mensaje del lead
se perdió.

El resto de la política de reintentos, verificado en las mismas líneas 213 a 282: hasta 10
intentos, retraso inicial de 5 segundos, backoff exponencial `5 × 2^(n-1)` con tope de 300
segundos, y jitter de ±20 por ciento. Todo configurable por variables `WEBHOOK_RETRY_*`.

**Qué se hace con esto, y esto es decisión de diseño, no hallazgo:**

- Seguir fallando cerrado con 401. La alternativa, aceptar lo que no se puede verificar, es peor.
- Durante una rotación de secreto, aceptar el secreto viejo y el nuevo, y recién retirar el viejo
  cuando se confirmó que Evolution ya usa el nuevo. Si no, la ventana de rotación se traga
  mensajes.
- Alertar sobre cualquier 401 del endpoint. Con Zernio un 401 es ruido esperable de internet; acá
  es la señal de que estamos perdiendo mensajes.
- Devolver 200 rápido y procesar después. Con un timeout de 30 segundos por defecto
  (`WEBHOOK_REQUEST_TIMEOUT_MS=60000` en `.env.example`, 30000 como default en el código), y un
  bucle de reintentos que bloquea, conviene no hacer trabajo pesado dentro del request.

### Una fuga de credencial que hay que tapar

**Verificado.** Evolution incluye la API key de la instancia **en el cuerpo de cada webhook**. En
`webhook.controller.ts`, líneas 93 a 103, el objeto que se envía es:

```ts
const webhookData = {
  ...(extra ?? {}),
  event,
  instance: instanceName,
  data,
  destination: instance?.url || `${webhookConfig.GLOBAL.URL}/${transformedWe}`,
  date_time: dateTime,
  sender,
  server_url: serverUrl,
  apikey: apiKey,
};
```

Y en `src/api/services/channel.service.ts`, líneas 447 a 459, ese `apiKey` es el token de la
instancia, incluido solo si `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` está en `true`, que es el
valor por defecto de `.env.example`:

```ts
const expose = this.configService.get<Auth>('AUTHENTICATION').EXPOSE_IN_FETCH_INSTANCES;
const instanceApikey = this.token || 'Apikey not found';
```

Esa API key es la que autoriza a operar la instancia: mandar mensajes, leer conversaciones,
borrar la instancia. Que viaje en cada webhook significa que cualquier log que registre el cuerpo
completo guarda una credencial en texto plano. El CLAUDE.md ya prohíbe logs con tokens; esto es
un caso concreto.

**Qué hacer:** poner `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false`, y además nunca loguear el
cuerpo crudo. No usar ese campo como mecanismo de autenticación: es una credencial reutilizable
que no caduca, lo opuesto a lo que queremos.

---

## Pregunta 2 — Idempotencia y forma del mensaje entrante

### Estructura del payload

**Verificado** en `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, método
`prepareMessage()`, línea 4652, y en el handler `'messages.upsert'`, línea 1082.

El cuerpo completo que llega es el `webhookData` de la Pregunta 1. Lo que nos importa está en
`data`, y para un mensaje entrante tiene esta forma:

```json
{
  "event": "messages.upsert",
  "instance": "ssa-whatsapp",
  "data": {
    "key": {
      "remoteJid": "5491122334455@s.whatsapp.net",
      "fromMe": false,
      "id": "3A7F2C9E1B4D8A6F0E2C",
      "participant": null
    },
    "pushName": "Nombre del contacto",
    "status": "DELIVERY_ACK",
    "message": { "conversation": "el texto del mensaje" },
    "contextInfo": null,
    "messageType": "conversation",
    "messageTimestamp": 1789574400,
    "instanceId": "…",
    "source": "android"
  },
  "destination": "https://…",
  "date_time": "2026-09-16T13:00:00.000Z",
  "sender": "5491199887766@s.whatsapp.net",
  "server_url": "https://…",
  "apikey": "…"
}
```

Los campos de `data` salen literal de `prepareMessage()`: `key`, `pushName`, `status`, `message`,
`contextInfo`, `messageType`, `messageTimestamp`, `instanceId`, `source`.

Dos normalizaciones que hace Evolution y conviene conocer, verificadas en el mismo método:

- Un `extendedTextMessage` (texto con formato o con link) se convierte en `conversation`: el
  `messageType` pasa a `'conversation'` y el texto se copia a `message.conversation`. O sea que
  **todo el texto plano llega por el mismo camino**, sin importar cómo lo mandó WhatsApp.
- `documentWithCaptionMessage` se aplana a `documentMessage`.

`messageTimestamp` es Unix en **segundos**, no milisegundos. Verificado: el tipo en la base de
Evolution es `Int` y el código hace `Math.floor(...getTime() / 1000)` para filtrar.

### Identificador de idempotencia

**El identificador existe: `data.key.id`.** Pero la clave correcta es la terna
**`(key.remoteJid, key.id, key.fromMe)`**, no `key.id` solo. Inferencia, con dos apoyos
verificados:

1. El id lo genera el cliente que envía el mensaje, no un servidor central. Es único dentro de la
   conversación, no globalmente. Esto es cómo funciona WhatsApp, no una decisión de Evolution.
2. La propia tabla `Message` de Evolution **no tiene restricción de unicidad sobre el id**.
   Verificado en `prisma/postgresql-schema.prisma`: `key` es una columna `Json @db.JsonB` suelta,
   y el único índice es `@@index([instanceId])`. Evolution tampoco deduplica, y guarda con
   `skipDuplicates: true` en el camino del historial, que solo saltea filas idénticas.

O sea: los duplicados son esperables, no excepcionales. La restricción de unicidad la tenemos que
poner nosotros. Sobre la columna `platform_message_id` que ya está prevista, la recomendación es
guardar la terna concatenada, no el id pelado.

**De dónde vienen los duplicados, más allá de los reintentos.** Verificado:

- El historial (`messages.set`) y los mensajes en vivo (`messages.upsert`) pueden traer el mismo
  mensaje. Si Evolution se reinicia y vuelve a sincronizar, se solapan.
- El handler acepta `type` `'notify'` y `'append'`, verificado en la línea 1164.
- El bloque de deduplicación que sí existe en el código, líneas 1365 a 1382, **no protege la
  emisión del webhook**: es solo para no procesar dos veces los acuses de lectura, con una clave
  `${remoteJid}_${timestamp}_${fromMe}` y un TTL de 5 minutos. No confundirlo con idempotencia de
  mensajes.

### Reintentos: mismo identificador entre intentos

**Verificado.** En `webhook.controller.ts`, líneas 222 a 224, el bucle reenvía el mismo objeto:

```ts
while (attempts < maxRetryAttempts) {
  try {
    await httpService.post('', webhookData);
```

`webhookData` se construye una sola vez, antes del bucle, y no se toca entre intentos. El
`key.id` es idéntico en los 10 intentos. La idempotencia funciona.

### Adjuntos: tres modos, y ninguno es "una URL que anda"

**Verificado** en el handler de `messages.upsert`.

**Modo por defecto, sin configurar nada.** Llega el nodo crudo de Baileys: un
`message.imageMessage` con `url`, `mediaKey`, `fileSha256`, `mimetype`, `fileLength` y `caption`.
**Esa `url` apunta a `mmg.whatsapp.net` y el archivo está cifrado de punta a punta.** No se
descarga con un GET: hay que descifrarlo con la `mediaKey`. En la práctica, este modo deja el
texto y pierde las imágenes, que es exactamente lo que el CLAUDE.md marca como riesgo a decidir.

**Modo base64.** Con `webhookBase64: true` en la config del webhook de la instancia, Evolution
descarga y descifra el archivo y lo mete en `message.base64`, dentro del cuerpo del webhook.
Verificado en las líneas 1446 a 1470, que usan `downloadMediaMessage` de Baileys, con un
reintento si el primer intento vuelve vacío. Contra: el cuerpo del webhook crece con el tamaño
del archivo. Un video de 16 MB son unos 21 MB de base64 en un solo POST.

**Modo S3.** Con `S3_ENABLED=true`, Evolution sube el archivo a S3 o MinIO y agrega
`message.mediaUrl`. Verificado en las líneas 1398 a 1434.

**Esa `mediaUrl` vence a los 7 días.** Verificado, y contradice a la documentación. El código
llama a `getObjectUrl(fullName)` sin argumento de expiración, y en
`src/api/integrations/storage/s3/libs/minio.server.ts` línea 101 eso termina en
`minioClient.presignedGetObject(bucketName, objectName)`. En `minio-js`, `src/helpers.ts` línea
24:

```ts
export const PRESIGN_EXPIRY_DAYS_MAX = 24 * 60 * 60 * 7 // 7 days in seconds
```

que es el valor que se usa cuando no se pasa expiración. Son 604.800 segundos. La
[documentación de S3/MinIO de Evolution](https://docs.evolutionfoundation.com.br/en/evolution-api/integrations/s3minio)
la llama "la URL pública del archivo", lo cual es incorrecto: es una URL prefirmada y temporal.

**Recomendación:** bajar el archivo en el momento de ingerir y guardarlo en Supabase Storage. Es
la única forma de que el adjunto siga existiendo dentro de un año. Guardar solo el link, en
cualquiera de los tres modos, es guardar algo que vence. El mismo problema que ya teníamos con
las URL de medios de Meta.

### Tipos de mensaje que distingue

**Verificado.** `messageType` sale de `getContentType()` de Baileys y refleja la clave del objeto
`message`. Los que importan:

| Qué es | `messageType` | Dónde está el contenido |
| --- | --- | --- |
| Texto | `conversation` | `message.conversation` |
| Imagen | `imageMessage` | `message.imageMessage`, texto en `.caption` |
| Audio y nota de voz | `audioMessage` | `message.audioMessage`, `.ptt` distingue la nota de voz |
| Documento | `documentMessage` | `message.documentMessage`, nombre en `.fileName` |
| Video | `videoMessage` | `message.videoMessage` |
| Sticker | `stickerMessage` | `message.stickerMessage` |
| Ubicación | `locationMessage` | `message.locationMessage`, con `.degreesLatitude` y `.degreesLongitude` |
| Encuesta | `pollUpdateMessage` | `message.pollUpdateMessage`, Evolution descifra los votos |

La lista de tipos que Evolution trata como multimedia está en `src/api/types/wa.types.ts`:
`imageMessage`, `documentMessage`, `audioMessage`, `videoMessage`, `stickerMessage`, `ptvMessage`
(video nota).

**Respuesta a otro mensaje: verificado.** Viene en `contextInfo`. `contextInfo.stanzaId` es el
`key.id` del mensaje citado, y `contextInfo.quotedMessage` trae su contenido. `prepareMessage()`
le aplica al mensaje citado las mismas normalizaciones que al principal (líneas 4690 a 4702), así
que un texto citado también llega como `conversation`.

Para reconstruir el hilo en la bandeja alcanza con guardar `stanzaId` y resolverlo contra nuestra
propia tabla de mensajes. Conviene guardarlo aunque el mensaje citado todavía no exista de
nuestro lado: puede llegar después, o no haber llegado nunca si es anterior al backfill.

---

## Pregunta 3 — Historial y backfill

**El backfill es posible.** Pero con un límite que hay que entender antes de prometerlo.

### Cómo llega el historial

**Verificado.** Al crear la instancia se puede pasar `syncFullHistory: true`. Está en
`src/api/dto/instance.dto.ts` como opción de instancia, y se pasa directo a Baileys en
`whatsapp.baileys.service.ts` línea 670.

Cuando WhatsApp manda el historial, Evolution lo procesa en el handler
`'messaging-history.set'` (línea 927): arma los mensajes con el mismo `prepareMessage()` que los
mensajes en vivo, los emite por webhook como evento **`messages.set`**, y los guarda en su propio
Postgres si `DATABASE_SAVE_DATA_HISTORIC=true`.

Verificado, líneas 1049 a 1057:

```ts
this.sendDataWebhook(Events.MESSAGES_SET, [...messagesRaw], true, undefined, {
  isLatest,
  progress,
});

if (this.configService.get<Database>('DATABASE').SAVE_DATA.HISTORIC) {
  await this.prismaRepository.message.createMany({ data: messagesRaw, skipDuplicates: true });
}
```

Dos cosas importantes de esas líneas:

- El payload de `messages.set` es un **array de mensajes**, no un mensaje suelto. Un lote puede
  ser grande. Hay que manejarlo distinto de `messages.upsert`.
- El cuerpo trae además `isLatest` y `progress` en la raíz, gracias al parámetro `extra`. Sirven
  para saber cuándo terminó la sincronización y para mostrar avance en la pantalla de canales.

### Cómo hacer el backfill

**Verificado.** `POST /chat/findMessages/{instance}` permite paginar el historial ya guardado.
Está en `src/api/routes/chat.router.ts` línea 164.

**Y acá está la distinción que define el diseño: ese endpoint consulta el Postgres propio de
Evolution, no a WhatsApp.** Verificado en `src/api/services/channel.service.ts`, método
`fetchMessages()` línea 600: es una consulta Prisma sobre `this.prismaRepository.message`,
filtrada por `instanceId`, con soporte para filtrar por `key.id`, `key.remoteJid`, `key.fromMe`,
`messageType` y rango de `messageTimestamp`.

O sea que **solo devuelve lo que Evolution ya recibió y guardó**. No es una ventana a WhatsApp.

La secuencia del backfill es entonces:

1. Crear la instancia con `syncFullHistory: true`.
2. Escanear el QR y esperar a que llegue la sincronización. Se sigue el avance con los eventos
   `messages.set` y su campo `progress`.
3. Una vez que `isLatest` llega en `true`, paginar `POST /chat/findMessages/{instance}` y copiar
   todo a Supabase.
4. De ahí en adelante, la base local es la fuente de verdad y Evolution queda como transporte,
   tal como pide el CLAUDE.md.

El paso 3 y el paso 2 son redundantes entre sí a propósito: se puede ingerir por webhook y después
reconciliar por API, o ignorar el webhook de historial y hacer todo por API. La segunda opción es
más simple de operar, porque el backfill se puede reintentar sin depender de que un webhook haya
llegado.

### El límite

**Lo que llega es lo que WhatsApp decide mandar en la sincronización del dispositivo vinculado, no
"todo el historial".** Inferencia, con apoyo verificado.

Lo verificado: Evolution pide el historial vía Baileys y filtra por tipo de sincronización. En
`whatsapp.baileys.service.ts`, líneas 2038 a 2043:

```ts
private isSyncNotificationFromUsedSyncType(msg: proto.Message.IHistorySyncNotification) {
  return (
    (this.localSettings.syncFullHistory && msg?.syncType === 2) ||
    (!this.localSettings.syncFullHistory && msg?.syncType === 3)
  );
}
```

El tipo 2 es el historial completo y el 3 el reciente. Pero **cuánto abarca cada uno lo decide
WhatsApp**, no Evolution ni Baileys: depende de qué guardó el teléfono, de la versión de la app y
de la política del momento. No hay contrato.

**No hay endpoint para pedir más. Verificado.** Existe una llamada a
`this.client.fetchMessageHistory(50, received.key, received.messageTimestamp)` en la línea 1117,
pero se dispara solo si uno se manda a sí mismo un mensaje con el texto literal
`onDemandHistSync`. No hay ruta HTTP que la exponga: lo confirmé revisando
`src/api/routes/chat.router.ts` y `src/api/integrations/channel/whatsapp/baileys.router.ts`, que
es el router que expone métodos crudos de Baileys.

**Qué significa para el proyecto:** el historial arranca con lo que WhatsApp entregue, que puede
ser meses o puede ser poco. No se puede prometer un backfill completo hasta probarlo con el número
real. Está en pendientes.

---

## Pregunta 4 — Estado de la sesión y QR

### Los endpoints

**Verificado** en `src/api/routes/instance.router.ts` y `src/api/controllers/instance.controller.ts`.

| Para qué | Endpoint | Qué devuelve |
| --- | --- | --- |
| Estado de conexión | `GET /instance/connectionState/{instance}` | `{ instance: { instanceName, state } }` |
| QR nuevo o estado | `GET /instance/connect/{instance}` | QR con `base64`, `code` y `pairingCode` |
| Reiniciar | `POST /instance/restart/{instance}` | |
| Cerrar sesión | `DELETE /instance/logout/{instance}` | |
| Listar instancias | `GET /instance/fetchInstances` | incluye `connectionStatus` desde la base |

Los valores de `state` son los de Baileys: `close`, `connecting`, `open`, más `refused` que agrega
Evolution.

**Caveat del `connectionState`, verificado.** En `instance.controller.ts`, líneas 393 a 400:

```ts
public async connectionState({ instanceName }: InstanceDto) {
  return {
    instance: {
      instanceName: instanceName,
      state: this.waMonitor.waInstances[instanceName]?.connectionStatus?.state,
    },
  };
}
```

Lee de **memoria**, no de la base. Si la instancia no está cargada en el proceso, `state` viene
`undefined`, no `'close'`. La pantalla de canales tiene que tratar `undefined` como "no sé", no
como "desconectado". Para el estado persistido está `fetchInstances`, que sí lee
`connectionStatus` de la base.

**Caveat del `connect`, verificado**, líneas 309 a 331: si el estado es `open` devuelve el estado
en vez de un QR; si es `connecting` devuelve el QR que ya tenía en memoria; solo si es `close`
fuerza una reconexión y espera 2 segundos antes de devolver. O sea que el botón "reconectar" de
nuestra pantalla no siempre produce un QR nuevo, y la UI tiene que contemplarlo.

### Notificación por webhook

**Sí notifica, pero no alcanza sola.** Verificado en el método `connectionUpdate()`, línea 334.

Los eventos relevantes, verificados en `src/api/types/wa.types.ts`:

- **`qrcode.updated`** — cada vez que se genera un QR nuevo. El cuerpo trae
  `{ qrcode: { instance, pairingCode, code, base64 } }`. El QR rota solo: `qrTimeout` está en
  45.000 ms (línea 657).
- **`connection.update`** — cambios de estado, con `{ instance, state, statusReason }` y, al
  abrir, también `wuid`, `profileName` y `profilePictureUrl`.
- **`status.instance`** — desconexión definitiva, con `disconnectionAt` y
  `disconnectionReasonCode`.

**El caveat que define el diseño de la pantalla, verificado.** En las líneas 424 a 431:

```ts
if (connection === 'close') {
  const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
  const codesToNotReconnect = [DisconnectReason.loggedOut, DisconnectReason.forbidden, 402, 406];
  const shouldReconnect = !codesToNotReconnect.includes(statusCode);
  if (shouldReconnect) {
    await this.connectToWhatsapp(this.phoneNumber);
  } else {
```

Ante una caída transitoria, Evolution **reconecta solo y no emite `connection.update` con estado
`close`**. El webhook solo aparece en la rama `else`, o sea en la desconexión definitiva:
`loggedOut`, `forbidden`, 402 y 406.

En la práctica, una caída transitoria se ve desde afuera como un `connection.update` con
`connecting` y después uno con `open`, si la reconexión funciona. Si no funciona, se ve como
nada: silencio, y la bandeja deja de recibir sin aviso. Que es exactamente el problema que
queremos resolver.

**Conclusión para la pantalla de canales:** hace falta el webhook **y** un chequeo periódico. El
webhook da la reacción inmediata cuando la sesión muere de verdad; el chequeo periódico detecta
el silencio. Con solo uno de los dos, la pantalla miente.

**Un caso más, verificado**, líneas 335 a 362: si se generan `QRCODE_LIMIT` códigos sin que nadie
escanee (30 por defecto), Evolution se rinde, emite `qrcode.updated` con el mensaje
`"QR code limit reached, please login again"` y un `connection.update` con `state: 'refused'`.
Ese estado también hay que contemplarlo: significa "hay que empezar de nuevo", no "está
desconectado".

---

## Pregunta 5 — Redis

**No es obligatorio. Se pueden desplegar dos servicios en lugar de tres.**

**Verificado** en `src/cache/cacheengine.ts`, el archivo completo:

```ts
const cacheConf = configService.get<CacheConf>('CACHE');

if (cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI !== '') {
  logger.verbose(`RedisCache initialized for ${module}`);
  this.engine = new RedisCache(configService, module);
} else if (cacheConf?.LOCAL?.ENABLED) {
  logger.verbose(`LocalCache initialized for ${module}`);
  this.engine = new LocalCache(configService, module);
}
```

Hay tres configuraciones posibles: Redis, caché local en memoria, o ninguna. Si no hay ninguna,
`this.engine` queda `undefined`, y `CacheService` lo maneja: verificado en
`src/api/services/cache.service.ts`, donde cada método arranca con `if (!this.cache) return;` y
el constructor loguea `"cacheservice disabled"`. No revienta.

### Lo que no depende de Redis

**La sesión de WhatsApp. Verificado.** La variable `CACHE_REDIS_SAVE_INSTANCES` está en `false`
por defecto en `.env.example`, con el comentario: *"Enabling this variable will save the
connection information in Redis and not in the database."* O sea que por defecto la sesión va al
Postgres de Evolution. Redis no la toca.

Esto es importante y conviene dejarlo escrito: **el Postgres de Evolution sigue siendo
obligatorio**, y es el que guarda la sesión de WhatsApp. Es el mismo punto que ya está en el
CLAUDE.md sobre las dos bases que no son intercambiables.

**Los caches de Baileys. Verificado**, en `whatsapp.baileys.service.ts` líneas 249 y 250:

```ts
private readonly msgRetryCounterCache: CacheStore = new NodeCache();
private readonly userDevicesCache: CacheStore = new NodeCache({ stdTTL: 300000, useClones: false });
```

Son `NodeCache`, en memoria del proceso. No pasan por `CacheService` ni por Redis. El estado de
reintento de descifrado, que es lo que más duele perder, no depende de Redis en ninguna
configuración.

### Lo que sí se degrada

**Metadata de grupos.** Verificado en la línea 4305: si no hay ningún caché habilitado,
`getGroupMetadataCache()` cae a `this.findGroup({ groupJid }, 'inner')`, o sea una consulta por
cada mensaje de grupo. Irrelevante para nosotros: no usamos grupos, y de hecho conviene
`groupsIgnore: true`.

**Deduplicación de acuses de lectura.** Verificado, líneas 1365 a 1386: usa el caché con un TTL
de 5 minutos para no reprocesar los acuses. Sin caché persistente, esa memoria se pierde en cada
reinicio, y algunos acuses se reprocesan. Consecuencia real: escrituras redundantes en la base de
Evolution. No afecta a nuestros datos.

**Recomendación: dos servicios.** Evolution y su PostgreSQL, con:

```
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

El caché local cubre el caso de los grupos y la deduplicación de acuses dentro de una misma
ejecución, sin agregar un tercer servicio con su propio volumen, su propia factura y su propio
modo de fallar. Si en algún momento hace falta correr más de una réplica de Evolution, ahí Redis
vuelve a la conversación.

---

## Consecuencias para el diseño de los Bloques 2 a 4

Esto no es hallazgo, es lo que se convierte en requerimiento.

### El identificador de contacto puede no ser un teléfono: el problema del `@lid`

Esta merece sección propia porque ataca la deduplicación por teléfono normalizado, que es una
regla explícita del CLAUDE.md y el corazón del CRM. Si el mismo lead entra dos veces como dos
contactos distintos, todo lo demás pierde sentido: el seguimiento se duplica, las métricas
mienten, y el agente de IA le habla a la mitad de una conversación.

**Qué es.** WhatsApp está migrando a un esquema de direccionamiento donde el identificador del
contacto es un **LID**, un identificador opaco de la forma `<numero>@lid`, en vez del JID basado
en el teléfono, `<telefono>@s.whatsapp.net`. El LID **no contiene el teléfono** y no se puede
convertir sin consultar el mapeo.

**Qué hace Evolution, verificado**, en `whatsapp.baileys.service.ts` líneas 1477 a 1483:

```ts
if (messageRaw.key.remoteJid?.includes('@lid') && messageRaw.key.remoteJidAlt) {
  messageRaw.key.remoteJid = messageRaw.key.remoteJidAlt;
}
console.log(messageRaw);

this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);
```

La sustitución ocurre **antes** de emitir el webhook. Eso es una buena noticia: cuando Baileys
provee `remoteJidAlt`, nosotros recibimos el `remoteJid` ya reemplazado por el JID con teléfono, y
el caso ni se nota. Además `key.addressingMode` vale `'lid'` en esos casos, así que sabemos que el
mensaje llegó por esa vía aunque el `remoteJid` ya esté resuelto (verificado en la línea 1516).

**El caso que rompe: cuando no hay `remoteJidAlt`.** La condición de la línea 1477 exige las dos
cosas. Si `remoteJidAlt` viene vacío, el `remoteJid` se queda como `<algo>@lid` y **el payload no
contiene el teléfono por ningún lado**.

**Y no hay endpoint para resolverlo. Verificado.** Baileys expone
`signalRepository.lidMapping.getPNForLID()`, y Evolution la usa, pero **solo en el manejador de
llamadas**, línea 1892:

```ts
if (call.from.endsWith('@lid')) {
  call.from = await this.client.signalRepository.lidMapping.getPNForLID(call.from as string);
}
```

No la usa para mensajes, y no hay ruta HTTP que la exponga. El endpoint
`POST /chat/whatsappNumbers` resuelve la dirección contraria: se le dan números y devuelve si
existen en WhatsApp. No sirve para ir de LID a teléfono.

**Qué implica para el diseño. Tres reglas:**

1. **El teléfono deja de ser obligatorio para crear un contacto.** La identidad de canal es el
   JID, sea `@s.whatsapp.net` o `@lid`. El teléfono normalizado a E.164 es un atributo que puede
   estar o no estar. Si el modelo de datos exige teléfono para dar de alta un contacto de
   WhatsApp, esos leads se pierden o entran con basura.

2. **Un contacto sin teléfono resuelto se marca como tal, y no se deduplica por nombre.** El
   CLAUDE.md ya lo dice: nunca deduplicar solo por nombre. Un contacto con `@lid` sin teléfono
   entra como contacto nuevo, con una marca visible de "teléfono sin resolver". Es preferible un
   duplicado visible y reconciliable a una fusión incorrecta, que es destructiva y difícil de
   deshacer.

3. **La reconciliación es posterior y tiene tres fuentes.** Cuando el teléfono aparece, se fusiona
   con el contacto que ya exista con ese teléfono, dejando rastro en el `audit_log`:
   - Un mensaje posterior de la misma conversación que sí traiga `remoteJidAlt`. Por eso conviene
     guardar el JID crudo y el `addressingMode` de cada mensaje, no solo el teléfono derivado.
   - El evento `contacts.upsert`, que Evolution emite con el mismo criterio de sustitución.
   - El operador, cargándolo a mano desde la ficha del contacto. Esta última es la que garantiza
     que el caso nunca queda trabado, y es barata de construir.

**Grado de confianza sobre la frecuencia:** no sé con qué frecuencia llega un `@lid` sin
`remoteJidAlt` en la práctica. Depende de la versión de WhatsApp del contacto y del avance de la
migración de Meta. Es suposición y está en pendientes. Lo que sí está verificado es que el código
contempla el caso, lo cual indica que ocurre.

### Ingesta de mensajes

- Restricción de unicidad sobre la terna `(remoteJid, id, fromMe)`, no sobre `key.id` solo.
- `messageTimestamp` es Unix en segundos. Convertir al guardar.
- `messages.set` trae un array; `messages.upsert` un objeto. Dos formas distintas, el mismo
  destino.
- Guardar `contextInfo.stanzaId` para reconstruir hilos, aunque el mensaje citado todavía no
  exista de nuestro lado.
- Devolver 200 rápido y procesar después: el bucle de reintentos de Evolution bloquea.

### Adjuntos

- Bajar el archivo al ingerir y guardarlo en Supabase Storage. Cualquier URL que venga de
  Evolution vence: la de `mmg.whatsapp.net` está cifrada y la de S3 caduca a los 7 días.
- Decidir entre el modo base64 y el modo S3 según el tamaño esperado. El modo base64 no necesita
  un servicio más, pero infla el cuerpo del webhook.

### Seguridad del webhook

- Configurar el webhook **por instancia**, con `POST /webhook/set/{instance}` y el header
  `jwt_key`. Dejar `WEBHOOK_GLOBAL_ENABLED=false`: el webhook global no manda headers.
- Verificar el JWT fijando `algorithms: ['HS256']`. Rechazar con 401.
- Procedimiento de rotación de secreto que acepte el viejo y el nuevo durante la ventana.
- Alertar sobre cualquier 401: acá un 401 significa mensajes perdidos, no ruido de internet.
- `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false`, para que la API key de la instancia deje de
  viajar en el cuerpo de cada webhook. Y nunca loguear el cuerpo crudo.

### Pantalla de canales

- Webhook **y** chequeo periódico. Evolution reconecta solo sin avisar, y el silencio no dispara
  ningún evento.
- Tratar `state: undefined` de `connectionState` como "no sé", no como "desconectado".
- Contemplar `state: 'refused'`, que significa "se acabaron los QR, empezar de nuevo".
- El botón de reconectar no siempre devuelve un QR nuevo: depende del estado actual.

### Despliegue

- **Fijar la imagen en `evoapicloud/evolution-api:v2.3.7`.** La plantilla oficial usa `latest`, y
  hoy ese tag apunta a un build del 6 de mayo de 2026 cuyo digest
  (`sha256:96662553…`) **no coincide con ninguna release etiquetada**: ni `v2.3.7`
  (`sha256:1bd8afc4…`), ni `2.4.0-rc1` (`sha256:c54a09a7…`), ni `2.4.0-rc2`
  (`sha256:b4a18ed5…`). Verificado comparando digests en la API de Docker Hub el 16/09/2026.
  `v2.3.7` es la última estable, del 5 de diciembre de 2025. Es la misma regla que ya aplicamos a
  `@zernio/node`.
- Dos servicios, no tres: Evolution y su PostgreSQL, con `CACHE_LOCAL_ENABLED=true` y
  `CACHE_REDIS_ENABLED=false`.
- Crear la instancia con `syncFullHistory: true` y `groupsIgnore: true`.

---

## Lo que quedó sin responder

### `jwt_key` es funcionalidad no documentada, y eso tiene un riesgo concreto

El mecanismo está **verificado en el código** de la versión 2.3.7, y funciona. Pero no aparece en
la documentación oficial ni en el `CHANGELOG.md` del repositorio, que revisé buscando `jwt`.

**No documentado es no soportado.** Nadie se comprometió a mantenerlo. Puede desaparecer en la
2.4.0 sin que figure en el changelog, porque nunca figuró que existía. Y la forma en que nos
enteraríamos es la peor posible: los webhooks dejan de traer el header `Authorization`, nosotros
seguimos fallando cerrado con 401, y Evolution descarta cada evento sin reintentar. Mensajes de
leads perdidos en silencio hasta que alguien mire la bandeja y note que está vacía.

**Mitigación, y es obligatoria:**

- Fijar la imagen en `v2.3.7`. No usar `latest`.
- Re-verificar el mecanismo contra el código fuente **en cada actualización de versión**, antes de
  desplegarla. Es una lectura de un archivo, no una auditoría.
- La alerta sobre 401 del endpoint cumple doble función: detecta la rotación de secreto mal hecha
  y detecta esto.

Ya existe un pedido de header personalizado en el repositorio
([issue #2276](https://github.com/evolution-foundation/evolution-api/issues/2276)), lo cual
sugiere que el tema está vivo, pero no leí el hilo completo ni sé en qué quedó.

### Completitud real del historial

No sé cuánto historial entrega WhatsApp con `syncFullHistory: true` para este número en
particular. Depende de qué guardó el teléfono y de la política de Meta del momento. **Qué haría
falta:** conectar el número real en un entorno de prueba, activar la sincronización completa, y
medir cuántos mensajes y de qué antigüedad llegaron. Es la única forma. Hasta entonces, el alcance
del backfill no se puede prometer en los requerimientos.

### Frecuencia del `@lid` sin `remoteJidAlt`

El código contempla el caso, así que ocurre, pero no sé con qué frecuencia. **Qué haría falta:**
instrumentar el receptor desde el primer día para contar cuántos mensajes llegan con
`addressingMode === 'lid'` y cuántos de esos no traen teléfono resoluble. Es una métrica barata y
define cuánto esfuerzo merece la reconciliación manual.

### Comportamiento del reconnect silencioso bajo caídas largas

Está verificado que Evolution reconecta solo y que no emite `connection.update` con `close` en ese
camino. Lo que no sé es qué pasa en una caída larga: si reintenta indefinidamente, si hay un tope,
y si termina emitiendo algo. **Qué haría falta:** cortarle la red a Evolution en un entorno de
prueba durante media hora y registrar qué eventos llegan y qué devuelve `connectionState`. Esto
define cuál es el intervalo correcto del chequeo periódico, que hoy sería una elección arbitraria.

### Qué cambia en la 2.4.0

Hay dos release candidates publicadas (`2.4.0-rc1` del 6 de mayo de 2026 y `2.4.0-rc2` del 17 de
mayo de 2026) y ninguna estable. No revisé sus diferencias con la 2.3.7. **Qué haría falta:**
comparar el `webhook.controller.ts` de la rama de la 2.4.0 contra el de la 2.3.7 antes de
considerar la actualización, prestando atención a `jwt_key`, a la forma del payload de
`messages.upsert` y al manejo del `@lid`.

### Si `latest` vuelve a apuntar a una release estable

Hoy apunta a un build que no corresponde a ninguna versión etiquetada. No sé si es un descuido o
una práctica del proyecto. No cambia la recomendación, que es fijar la versión de todas formas,
pero explica por qué la plantilla oficial de Railway podría desplegar algo distinto de lo que uno
espera.

---

## Fuentes

**Código fuente**, leído por HTTP desde `raw.githubusercontent.com`, rama `main`, versión 2.3.7:

- `src/api/integrations/event/webhook/webhook.controller.ts`
- `src/api/integrations/event/webhook/webhook.schema.ts`
- `src/api/integrations/event/event.controller.ts`
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`
- `src/api/services/channel.service.ts`
- `src/api/services/cache.service.ts`
- `src/api/services/monitor.service.ts`
- `src/api/controllers/instance.controller.ts`
- `src/api/controllers/chat.controller.ts`
- `src/api/routes/instance.router.ts`, `src/api/routes/chat.router.ts`
- `src/api/integrations/channel/whatsapp/baileys.router.ts`
- `src/api/integrations/storage/s3/libs/minio.server.ts`
- `src/api/dto/instance.dto.ts`, `src/api/types/wa.types.ts`
- `src/cache/cacheengine.ts`
- `src/config/env.config.ts`
- `src/api/server.module.ts`
- `prisma/postgresql-schema.prisma`
- `.env.example`, `docker-compose.yaml`, `Dockerfile`, `CHANGELOG.md`, `package.json`

**Documentación oficial de Evolution API:**

- [Webhooks](https://docs.evolutionfoundation.com.br/en/evolution-api/configuration/webhooks)
- [Set Webhook](https://docs.evolutionfoundation.com.br/en/evolution-api/set-webhook)
- [Redis](https://docs.evolutionfoundation.com.br/en/evolution-api/requirements/redis)
- [S3/MinIO](https://docs.evolutionfoundation.com.br/en/evolution-api/integrations/s3minio)

**Otras fuentes:**

- [Railway — Private Networking](https://docs.railway.com/guides/private-networking)
- [Railway — Public Networking](https://docs.railway.com/guides/public-networking)
- `minio/minio-js`, `src/helpers.ts` y `src/internal/client.ts`
- API de Docker Hub, repositorio `evoapicloud/evolution-api`, consultada el 16/09/2026
- API de GitHub, releases de `EvolutionAPI/evolution-api`

**Advertencia sobre una fuente que no sirve:** buscando "Evolution API webhook" aparece
`docs.evolutionx.io`, de un producto llamado Evolution X que **no tiene relación** con Evolution
API. Esa documentación sí describe validación de firma HMAC, con headers `HTTP_EVOX_SIGNATURE` y
`HTTP_EVOX_TIME`. No aplica acá. Lo anoto porque es una confusión fácil de cometer y llevaría a
diseñar contra un mecanismo inexistente.
