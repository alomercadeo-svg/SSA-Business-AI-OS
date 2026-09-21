# Purga de datos de prueba y reconexión de Instagram

Procedimiento reproducible para dejar el canal de Instagram conectado a la cuenta correcta del
negocio, con la base limpia y el secreto de firma rotado.

**Fecha:** 21 de septiembre de 2026. **Todavía no ejecutado.**

**Qué deja:** el workspace sin los datos de prueba, el canal de Instagram conectado a la cuenta del
negocio, el secreto de firma del webhook rotado, y el re-registro **verificado con un mensaje real
que entra de punta a punta**.

**Por qué los cuatro pasos van juntos y no sueltos.** Cada uno de los tres primeros deja el sistema
en un estado intermedio que el siguiente resuelve, y el cuarto es el único que comprueba que la
cadena entera quedó bien. Ejecutados por separado, en días distintos, cada uno se ve exitoso y el
conjunto puede quedar roto sin que nada lo muestre. El detalle está en la sección 0.

---

## 0. El orden, y por qué no es negociable

| Paso | Qué hace | Por qué va acá |
|---|---|---|
| 1 | Purgar los datos de prueba | Antes de reconectar: si se reconecta primero, el backfill vuelve a traer conversaciones y se mezclan con las que había que borrar |
| 2 | Reconectar Instagram con la cuenta del negocio | Antes de rotar: reconectar re-registra el webhook, y conviene que ese re-registro ocurra con el secreto viejo, que todavía es válido |
| 3 | Rotar el secreto de firma | Después de reconectar, nunca antes. Ver abajo |
| 4 | Verificar con un mensaje real, de ida y de vuelta | Es el control positivo de los pasos 2 y 3 |

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

**Ninguno de los tres fallos se ve en la pantalla de canales**, que va a seguir mostrando el canal
como conectado en los cuatro casos. Por eso el veredicto sale de estas comprobaciones y no de mirar
la interfaz.

---

## 5. Después

- Anotar en `Claude outputs/estado-fase1.md` la fecha de ejecución y el resultado.
- El estado del registro del webhook va a ser visible en pantalla cuando se construya F24, con lo
  que este procedimiento va a dejar de depender de correr scripts a mano para saber si quedó bien.
