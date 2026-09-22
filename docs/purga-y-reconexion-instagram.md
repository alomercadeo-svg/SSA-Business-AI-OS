# Purga de datos de prueba y reconexión de Instagram

Procedimiento reproducible para dejar el canal de Instagram conectado a la cuenta correcta del
negocio, con la base limpia y el secreto de firma rotado.

**Fecha:** 21 de septiembre de 2026. **Todavía no ejecutado.**

**Qué deja:** la cuenta vieja desconectada, el workspace sin los datos de prueba, el canal de Instagram conectado a la cuenta del
negocio, el secreto de firma del webhook rotado, y el re-registro **verificado con un mensaje real
que entra de punta a punta**.

**Por qué los cinco pasos van juntos y no sueltos.** Cada uno de los cuatro primeros deja el sistema
en un estado intermedio que el siguiente resuelve, y el último es el único que comprueba que la
cadena entera quedó bien. Ejecutados por separado, en días distintos, cada uno se ve exitoso y el
conjunto puede quedar roto sin que nada lo muestre. El detalle está en la sección de orden.

---

## Orden de los pasos, y por qué no es negociable

| Paso | Qué hace | Por qué va acá |
|---|---|---|
| **0** | **Desconectar `@theconsultour` en Zernio** | **Cierra la ventana del paso 1. Ver abajo: conectar no desconecta** |
| 1 | Purgar los datos de prueba | Después de desconectar, para que no entre nada mientras se purga |
| 2 | Reconectar Instagram con la cuenta del negocio | Antes de rotar: reconectar re-registra el webhook, y conviene que ese re-registro ocurra con el secreto viejo, que todavía es válido |
| 3 | Rotar el secreto de firma | Después de reconectar, nunca antes. Ver abajo |
| 4 | Verificar con un mensaje real, de ida y de vuelta | Es el control positivo de los pasos 2 y 3 |

### Por qué hay un paso 0 que antes no estaba

**Conectar una cuenta no desconecta la anterior.** Sin el paso 0, entre la purga y la reconexión hay
una ventana abierta: cualquier DM que le llegue a `@theconsultour` en esos minutos vuelve a crear
contacto y conversación, y el procedimiento termina con la purga a medias **sin ninguna señal de que
eso pasó**.

**Lo que está verificado, del lado nuestro:** `channels` tiene `unique (workspace_id,
late_account_id)`, así que dos cuentas de Instagram distintas conviven como dos canales, los dos con
`is_active = true`. Y el sync **no desactiva nada al conectar**: `debeDesactivarseCanal`
(`lib/channel-rules.ts`) desactiva un canal de Zernio **solo cuando su cuenta ya no existe en
Zernio**. O sea que nuestro código espeja a Zernio y no decide nada por su cuenta. La decisión está
del lado del proveedor.

**Lo que es inferencia fuerte y no medición, del lado de Zernio:** la API es multi-cuenta.
`GET /v1/accounts` toma `platform` como **filtro**, cuenta las cuentas contra el límite del plan,
existe `PATCH` para mover una cuenta de perfil, y existe una desconexión explícita. Nada en la
documentación dice que conectar reemplace. **Pero no se midió**, y la única forma de medirlo sería
conectar una segunda cuenta, que es justamente la acción que este procedimiento ordena.

**Por qué el paso 0 va igual, sin esperar a medirlo.** La asimetría decide: si conectar reemplaza, el
paso 0 sobra y cuesta un clic. Si conviven, el paso 0 es lo único que separa una purga completa de
una purga a medias que nadie va a notar. Un paso de más contra una falla silenciosa no es una
decisión difícil.

### La llamada de desconexión existe

`DELETE /v1/accounts/{accountId}`, en el SDK `zernio.accounts.deleteAccount`. La documentación dice
*"Disconnects and removes a connected social account"*.

> ## ⚠ El paso 0 es irreversible y hay que decidirlo antes, no durante
>
> Desconectar **remueve la cuenta** en Zernio. Las 33 conversaciones de `@theconsultour`, con
> historial real desde junio de 2024, hoy son recuperables porque Zernio es el almacén y la bandeja
> las lee de ahí. Después del paso 0 **dejan de ser alcanzables por la API**: los endpoints de
> conversaciones y mensajes piden `accountId`, y esa cuenta ya no va a existir.
>
> La documentación **no dice** qué pasa con los datos de una cuenta desconectada. Hay un indicio de
> que sobreviven internamente —las analíticas de bandeja muestran las cuentas que ya no existen como
> "(disconnected)" para que la fila siga visible— pero eso es analítica agregada, no el hilo de
> mensajes, y no alcanza para prometer nada.
>
> **Si hay algo en esas 33 conversaciones que valga la pena conservar, hay que exportarlo antes del
> paso 0.** El paso 1 borra la copia local y el paso 0 corta el acceso a la del proveedor: juntos no
> dejan de dónde recuperar. Esto no es una objeción al procedimiento, es la decisión que el
> procedimiento obliga a tomar de forma explícita en vez de descubrirla después.

### Por qué rotar va después de reconectar y no antes

**Rotar el secreto obliga a re-registrar el webhook en Zernio**, porque el mismo valor se usa para
dos cosas: registrar el webhook y verificar la firma de cada entrega. Si el valor cambia de un lado
y no del otro, todas las entregas empiezan a fallar la verificación.

Entre que el secreto nuevo queda guardado y el re-registro se aplica, hay una ventana en la que **el
webhook viejo ya no vale y el nuevo todavía no está registrado**. Todo lo que llegue en esa ventana
se rechaza con 401. Zernio reintenta, así que no necesariamente se pierde, pero si la ventana se
alarga, se pierde.

Rotar **antes** de reconectar abre esa ventana y después le suma la reconexión encima, que es otro
re-registro. Rotar **después** hace que la ventana sea un solo evento, corto, y que el paso 4 la
cierre verificando.

### Por qué el paso 4 no es opcional, y no es "revisar que se vea bien"

`ensureWebhookRegistered` corre dentro de un `try/catch` que solo escribe en la consola, en sus dos
llamadores: `app/api/v1/channels/sync/route.ts:141` y `app/api/v1/channels/test-key/route.ts:74`.
Los dos comentarios dicen "best-effort: a failure must not block".

O sea que **el re-registro falla en silencio**. La pantalla informa que el canal se sincronizó bien,
la aplicación sigue creyendo que el webhook está registrado, y la bandeja deja de recibir sin
ningún síntoma. Es el tercer caso de la regla de vigilancia por ausencia de
`docs/requerimientos-bloques-2-3-4.md` §14.

La consecuencia directa para este procedimiento: **"rotado" y "rotado y roto" se ven exactamente
igual desde la pantalla**. Sin un mensaje que entre de verdad y aparezca en la bandeja, no hay forma
de distinguirlos. Por eso el paso 4 es parte del procedimiento y no una comprobación opcional del
final.

Y la ida y la vuelta son dos comprobaciones distintas, no una repetida:

- **El mensaje de entrada** prueba que el webhook quedó registrado y que su firma verifica con el
  secreto nuevo.
- **El mensaje de salida** prueba que la clave de API sigue sirviendo para escribir. Es el control
  positivo del de entrada: si el de entrada no llega y el de salida tampoco sale, el problema es la
  clave o la cuenta, no el webhook, y el diagnóstico es distinto.

---

## 0. Desconectar `@theconsultour` en Zernio

Se hace desde el panel de Zernio, o con la llamada de desconexión. Después:

```bash
# Confirmar que quedó desconectada ANTES de purgar. Si sigue conectada, parar:
# purgar con la cuenta viva deja la ventana abierta.
node scripts/verify-id-mensaje-zernio.mjs --cuentas
```

Tiene que decir **"No hay ninguna cuenta de Instagram conectada"**. Lista las cuentas de Zernio y los
canales locales activos por separado, y sale con error si hay más de una: dos cuentas conectadas
significan dos canales recibiendo, porque el receptor busca el canal por `late_account_id` y encuentra
los dos.

Después del paso 0, el botón de sincronizar de la pantalla de canales desactiva el canal local, que
es el comportamiento correcto de `debeDesactivarseCanal` y sirve de comprobación adicional de que
Zernio ya no lista la cuenta.

> **Nota sobre el orden interno de este paso.** Desactivar el canal local **no** reemplaza a
> desconectar en Zernio. Un canal local inactivo no impide que Zernio entregue: el receptor busca el
> canal por `late_account_id` **filtrando por `is_active = true`**, así que la entrega llega, no
> encuentra canal activo y responde 404. El mensaje no se guarda, pero tampoco se pierde: sigue en
> Zernio. Lo que cierra la ventana de verdad es que la cuenta deje de estar conectada del lado del
> proveedor.

---

## 1. Purga de los datos de prueba

**Estado medido el 21 de septiembre de 2026**, con la clave de servicio contra la base de
producción:

| Tabla | Filas |
|---|---|
| `workspaces` | 1 |
| `channels` | 2 (instagram `@theconsultour`, whatsapp sin vincular) |
| `contacts` | 33 |
| `contact_channels` | 33 |
| `conversations` | 33 |
| `analytics_events` | 33 |
| `messages` | **0** |
| `comment_logs` | 0 |
| `sequence_enrollments` | 0 |
| `webhook_events` | 8 |

`contact_notes` y `audit_log` **todavía no existen**: son del Bloque 3.

### Qué borra qué, porque la cascada no hace lo que parece

Verificado en `supabase/migrations/00001_initial_schema.sql`:

- `contacts` cascadea a `contact_channels`, `contact_tags`, `contact_custom_fields`,
  `conversations` y `sequence_enrollments`.
- `conversations` cascadea a `messages`.
- `analytics_events.contact_id` es `on delete set null`: **las filas sobreviven**, con el contacto
  en nulo.
- `contact_channels` cascadea desde `contacts` **y** desde `channels`.

**La trampa, y está escrita acá para que nadie la descubra ejecutando.** Borrar el canal parece el
camino corto, y deja 33 contactos huérfanos: `conversations` y `contact_channels` se van con el
canal, pero `contacts` no cuelga de `channels`, cuelga de `workspaces`. Quedarían 33 contactos sin
ningún canal asociado, invisibles en la bandeja e imposibles de deduplicar después.

**Se borra por contactos, no por canal.**

### Las consultas

Se ejecutan en el editor SQL de Supabase, dentro de una transacción. **No van como migración:** no
son un cambio de esquema y no tienen que volver a correr nunca. Esto es la excepción explícita a la
regla del `CLAUDE.md` sobre no pegar SQL en el editor, y es una excepción por tipo de operación, no
por comodidad.

```sql
-- Paso 1.0: confirmar contra qué se está por ejecutar. Leer el resultado ANTES de seguir.
select c.id, c.platform, c.username, c.late_account_id, count(cc.id) as contactos
from channels c
left join contact_channels cc on cc.channel_id = c.id
group by c.id;
```

```sql
-- Paso 1.1: la purga. Reemplazar el id por el del canal de Instagram del paso 1.0.
begin;

-- Los contactos que llegaron por ese canal. La cascada se lleva conversaciones,
-- mensajes, contact_channels, tags y campos personalizados.
delete from contacts
where id in (
  select contact_id from contact_channels
  where channel_id = '8f30b551-1162-40ec-a538-9651560c11b3'
);

-- Los eventos de analítica sobreviven con contact_id en nulo. Son datos de prueba
-- de las mismas 33 conversaciones, así que se van también.
delete from analytics_events
where contact_id is null
  and workspace_id = (select id from workspaces limit 1);

-- Verificación dentro de la misma transacción, antes de confirmar.
select
  (select count(*) from contacts) as contactos,
  (select count(*) from conversations) as conversaciones,
  (select count(*) from messages) as mensajes,
  (select count(*) from contact_channels) as canales_de_contacto;

-- Si los cuatro dan 0, confirmar. Si no, `rollback` y revisar.
commit;
```

### Lo que NO se borra, y por qué

- **`webhook_events`.** Son 8 filas del ledger de idempotencia. Borrarlas hace que un reintento de
  Zernio de cualquiera de esos eventos vuelva a procesarse como si fuera nuevo. Como no hay nada que
  procesar —`messages` está vacío y los contactos se borraron— el efecto sería recrear contactos
  fantasma. Se quedan.
- **La fila del canal.** Se reusa en el paso 2. Borrarla obligaría a recrear el canal y perdería el
  `id` al que apuntan los secretos por canal de Vault.
- **El canal de WhatsApp.** No tiene datos y no participa de esto.

---

## 2. Reconexión de Instagram con la cuenta del negocio

> ## El candado de "no conectar hasta que exista F27" es de WhatsApp, no de Instagram
>
> **Verificado el 21 de septiembre de 2026. Reconectar Instagram antes de F27 no pierde ningún mensaje.**
>
> Está escrito acá porque la regla del candado es correcta, es dura, y está escrita para el otro
> canal en `docs/despliegue-evolution.md` con mucho énfasis. Aplicarla a Instagram por analogía
> postergaría la reconexión durante todo el Bloque 3 sin ninguna razón.
>
> **Por qué en WhatsApp el candado existe.** El receptor autentica el aviso, responde 200 y
> **descarta el contenido**, porque guardarlo es F27. Evolution da la entrega por buena y no
> reintenta. El mensaje no queda en ningún lado: se perdió, con acuse de éxito.
>
> **Por qué en Instagram no.** El receptor también descarta, pero **Zernio es el almacén**. La
> bandeja no muestra lo que guardamos: lee el historial del proveedor en cada apertura, con
> `traerMensajesDeConversacion` desde `app/api/v1/messages/route.ts`. Lo que el receptor descarta ya
> está guardado del otro lado.
>
> **Las tres cosas que se midieron, y el control positivo que las hace atribuibles:**
>
> 1. **Nada se guarda localmente.** La tabla `messages` tiene **0 filas** después de 9 entregas de
>    webhook, incluida la prueba de hoy. Ni `route.ts` ni `lib/inbox-sync.ts` insertan ahí.
> 2. **El control positivo, que es lo que impide leer ese 0 como "no llegó nada":** en la misma
>    prueba, `webhook_events` pasó de 8 a 9 filas. O sea que el aviso **sí llegó y sí se procesó**;
>    la tabla de mensajes está vacía porque nadie la escribe, no porque no haya pasado nada.
> 3. **El proveedor conserva el historial.** Muestreadas 6 conversaciones: mensajes desde el
>    **27 de junio de 2024**, con `hasMore=true`, ninguna vacía.
>
> **La consecuencia para el orden del procedimiento:** el paso 2 se puede ejecutar hoy. No hay que
> esperar a F27, y esperar no protegería nada.
>
> **Una salvedad que no cambia la conclusión pero conviene saber:** si la cuenta del negocio es una
> cuenta de Instagram **distinta** de `@theconsultour`, el historial que aparezca va a ser el de esa
> otra cuenta. Las 33 conversaciones actuales son de `@theconsultour` y no se "migran" a otra cuenta:
> no se pierden porque siguen en Zernio bajo su cuenta, pero no van a estar en la bandeja de la
> cuenta nueva. Eso es esperado y es justamente para lo que sirve el paso 1.

**El problema que resuelve:** la conexión OAuth de Meta usa la sesión del navegador. Si la sesión
activa es la de una cuenta personal, se conecta esa y no la del negocio, sin preguntar y sin avisar
cuál eligió.

1. Abrir una **ventana de incógnito**. No alcanza con cerrar sesión en la pestaña normal: las
   cookies de Meta sobreviven en otras pestañas y el selector de cuenta puede elegir sola.
2. Entrar a Instagram con la cuenta del negocio.
3. En la misma ventana, abrir la aplicación y conectar el canal de Instagram.
4. **Confirmar el nombre de usuario que quedó conectado antes de seguir.** Si no es el del negocio,
   desconectar y volver al punto 1.

Al conectar, el código llama a `ensureWebhookRegistered`, que registra el webhook con el secreto
**actual**, el viejo, que todavía es válido. Eso es lo correcto en este punto del orden.

### 2.1 Sincronizar de nuevo, porque el historial llega tarde

**Una sola sincronización no alcanza, y el motivo no es obvio.** La documentación de Zernio dice que
al conectar una cuenta de Instagram o Facebook, el proveedor **reproduce en segundo plano el
historial de mensajes que la cuenta ya tiene en Meta**, hasta 500 conversaciones. Y avisa, con todas
las letras, que esa reproducción *"puede terminar después de un listado que ya tomaste"*, y que quien
espeje ese endpoint en su propio almacén debería *"repetir el barrido en vez de confiar en una sola
pasada al momento de conectar"*.

**Nuestro código hace exactamente la sola pasada.** `backfillInboxConversations` corre dentro del
mismo request que la conexión. Si la reproducción todavía no terminó, importa lo que haya en ese
instante y no vuelve nunca.

**Qué hacer:** después de conectar, **tocar el botón de sincronizar unas cuantas veces, espaciadas**,
hasta que la cantidad de conversaciones deje de subir. Diez minutos, media hora y una hora es una
cadencia razonable para 500 conversaciones.

```sql
-- Repetir entre sincronizaciones. Cuando el número se estabiliza, terminó.
select count(*) from conversations;
```

Repetir el barrido es seguro: el backfill es solo de inserción y saltea las conversaciones que ya
conoce.

**Dos consecuencias que conviene tener presentes:**

- **La reproducción no emite webhooks.** Así que no sirve mirar el log de entregas para saber si
  terminó, y tampoco va a mover la marca de último evento entrante de F39.
- **Si la cuenta tiene el acceso a mensajes de "herramientas conectadas" de Instagram apagado, no se
  reproduce nada.** Si después de varias sincronizaciones no aparece ninguna conversación vieja, ese
  es el primer lugar donde mirar, antes de sospechar del código.

---

## 3. Rotación del secreto de firma

**Por qué se rota.** El 21 de septiembre de 2026 el secreto quedó expuesto en pantalla:
`GET /v1/webhooks/settings` lo devuelve en texto plano junto con el resto de la configuración. La
exposición es del mismo tipo que la del token de la instancia de Evolution, que sí se rotó.

**Lo urgente ya se hizo y era otra cosa: redactar en origen.** Los scripts filtran su propia salida
(`scripts/redaccion.mjs`), con un test que falla si un script que consulta ese endpoint no instala
el filtro. Sin eso, rotar solo cambiaba qué cadena quedaba expuesta la próxima vez.

**El procedimiento.** El secreto vive en `workspaces.webhook_secret` y lo lee
`getOrCreateWorkspaceWebhookSecret`. Rotar es ponerlo en nulo y forzar un re-registro, que genera
uno nuevo y lo registra en Zernio en la misma pasada.

```sql
-- Paso 3.1: borrar el secreto actual para que se regenere.
update workspaces set webhook_secret = null
where id = (select id from workspaces limit 1);
```

Después, forzar el re-registro desde la aplicación: botón de sincronizar del canal, o volver a
guardar la clave de API en la pantalla de integraciones. Cualquiera de los dos llama a
`ensureWebhookRegistered`.

```bash
# Paso 3.2: confirmar que el secreto nuevo llegó a Zernio.
# Compara el guardado contra el de Zernio sin imprimir ninguno de los dos:
# solo longitud y últimos cuatro caracteres.
node scripts/verify-id-mensaje-zernio.mjs --registro
```

Tiene que decir `COINCIDENCIA sí`. Si dice que no, el secreto nuevo quedó en la base y no llegó a
Zernio: toda entrega va a fallar la verificación de firma. Repetir el re-registro.

> **Acá es donde el procedimiento puede mentir.** Si el re-registro falló, la pantalla igual dice
> que todo salió bien. El paso 3.2 mira la configuración en Zernio, que es el dato real, pero
> **tampoco alcanza**: confirma que el webhook figura registrado y que los secretos coinciden, no
> que las entregas lleguen y verifiquen. Un secreto que coincide y un webhook apuntando a una URL
> que no responde se ven igual desde ahí. Eso lo prueba solamente el paso 4.

---

## 4. Verificación de punta a punta, con un mensaje real

**Esto no es "revisar que se vea bien".** Es el control positivo de los pasos 2 y 3, y sin él el
procedimiento no se puede dar por hecho.

1. Desde un teléfono, con **otra** cuenta de Instagram, mandar un DM a la cuenta del negocio.
2. Esperar hasta 60 segundos.
3. Comprobar las tres cosas, en este orden:

```bash
# a. ¿Zernio entregó el evento y nuestro receptor lo aceptó?
#    Busca status success y el código HTTP de la respuesta.
node scripts/verify-id-mensaje-zernio.mjs
```

- **b.** El mensaje aparece en la bandeja de la aplicación.
- **c.** El contacto se creó, con el nombre de usuario correcto.

4. **La vuelta:** responder ese mismo mensaje **desde la bandeja de la aplicación**, y confirmar que
   llega al teléfono.

### Cómo se lee el resultado

| Qué pasó | Qué significa |
|---|---|
| Entra y sale | Listo. El procedimiento está completo |
| No entra, pero sale | El webhook no quedó registrado o la firma no verifica. La clave de API está bien. Repetir el paso 3 |
| No entra y no sale | La clave o la cuenta conectada. **No** es el webhook. Volver al paso 2 |
| Entra con 401 en el log de entregas | El secreto de Zernio y el de la base no coinciden. Repetir el paso 3 completo |
| Entra, pero además aparecen contactos que se habían purgado | **La ventana del paso 0 quedó abierta.** Alguien escribió a la cuenta vieja y sigue conectada, o el paso 0 no se ejecutó. Verificar `GET /v1/accounts` y volver al paso 0 |
| Entra y sale, pero faltan conversaciones viejas | No es un fallo del webhook. Es la reproducción del historial, que todavía no terminó o no está habilitada. Ver 2.1 |

**Ninguno de estos fallos se ve en la pantalla de canales**, que va a seguir mostrando el canal como
conectado en todos los casos. Por eso el veredicto sale de estas comprobaciones y no de mirar la
interfaz.

**Y uno que sí conviene comprobar aparte, porque su síntoma es "todo bien":**

```sql
-- ¿Quedó más de un canal de Instagram activo?
-- Si devuelve más de una fila, conviven dos cuentas y el paso 0 no cerró nada.
select id, username, late_account_id, is_active
from channels where platform = 'instagram' and is_active = true;
```

---

## 5. Después

- Anotar en `Claude outputs/estado-fase1.md` la fecha de ejecución y el resultado.
- El estado del registro del webhook va a ser visible en pantalla cuando se construya F24, con lo
  que este procedimiento va a dejar de depender de correr scripts a mano para saber si quedó bien.
