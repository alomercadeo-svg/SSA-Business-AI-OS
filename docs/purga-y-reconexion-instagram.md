# Purga de datos de prueba y reconexión de Instagram

Procedimiento reproducible para dejar el canal de Instagram conectado a la cuenta correcta del
negocio, con la base limpia y el secreto de firma rotado.

**Fecha:** 21 de septiembre de 2026. **Ejecutado por primera vez el 22 de septiembre de 2026.
Veredicto: entra y sale.** La rotación le había borrado `message.sent` a la suscripción del webhook.
Se desplegó el arreglo y se repitieron los pasos 3.2 y 4 ese mismo día, con el mismo veredicto. El registro de esa ejecución
está en el paso 5 y en `docs/estado-fase1.md`. Las correcciones que salieron de ella ya están
aplicadas en cada paso.

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

> ## El paso 0 es irreversible del lado de Zernio, y qué significa eso exactamente
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
> **Decidido el 21 de septiembre de 2026: no se exporta nada.** Y el motivo se escribe acá para que
> no se reabra.
>
> **Desconectar de Zernio no toca la cuenta de Instagram.** Las 33 conversaciones siguen donde
> siempre estuvieron, que es Instagram. Zernio es el almacén **frente a nuestra base**, no frente a
> Instagram: es un espejo de algo cuyo original no se toca. Y si alguna vez se quisiera
> `@theconsultour` dentro de un sistema, reconectarla reproduce el historial desde Meta, que es
> justamente el mecanismo descrito en el paso 2.1.
>
> **Corrección de una frase que estaba acá y era falsa.** Decía que el paso 0 y el paso 1 juntos "no
> dejan de dónde recuperar". No es cierto: queda Instagram, que es el original. Escrita así, esa
> frase empujaba a exportar conversaciones de 33 personas reales para protegerse de una pérdida que
> no ocurre, y sin ningún uso nombrado para esos datos. Un respaldo que nadie pidió, de datos
> personales, tomado por precaución mal calculada, es peor que no tenerlo.

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
`docs/requerimientos-fase1.md` §14.

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

**Tres tiempos, en este orden, y ninguno se saltea:**

1. **Lectura con la cuenta viva, antes de desconectar.** Tiene que listar la cuenta vieja:

   ```bash
   node scripts/verify-id-mensaje-zernio.mjs --cuentas
   ```

   Es el control positivo de la lectura siguiente. Un cero sin un uno antes no distingue "se
   desconectó" de "la clave es otra" o "la lectura está rota".
2. **Desconectar**, desde el panel de Zernio o con la llamada de desconexión.
3. **Lectura con la cuenta muerta, y antes de apretar sincronizar:**

   ```bash
   # Confirmar que quedó desconectada ANTES de purgar. Si sigue conectada, parar:
   # purgar con la cuenta viva deja la ventana abierta.
   node scripts/verify-id-mensaje-zernio.mjs --cuentas
   ```

**Por qué antes de sincronizar.** El script lee la clave de Zernio de Vault a través del canal local
de Instagram activo. Sincronizar desactiva ese canal, y a partir de ahí el script corta con "No hay
ningún canal de Instagram activo" sin llegar nunca a la frase esperada. Por la misma razón, la
salida esperada incluye "Canales locales de Instagram activos: 1": no es un error, es el canal que
todavía no se sincronizó.

La tercera lectura tiene que decir **"No hay ninguna cuenta de Instagram conectada"**.

> **En la primera ejecución el primer tiempo no se hizo**, porque este orden todavía no estaba
> escrito: la cuenta se desconectó a las 12:15 y la única lectura fue a las 12:50. El control
> positivo se corrió al paso 2, donde la misma clave vio la cuenta nueva. Así quedó probado que el
> cero era real, pero recién una hora y media después. Lista las cuentas de Zernio y los
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

> ## NO VOLVER A CORRER ESTA CONSULTA. Ya se ejecutó el 22 de septiembre de 2026.
>
> **El identificador de canal que figura abajo, `8f30b551-1162-40ec-a538-9651560c11b3`, hoy es
> `@alomercadeo`, la cuenta real del negocio.** Correr la 1.1 de nuevo borra los 200 contactos
> reales, con sus conversaciones, y la transacción no lo impide: la verificación de adentro espera
> ceros, así que un borrado completo le parece un éxito.
>
> **Por qué el id no cambió, aunque la cuenta sí.** Zernio le dio a `@alomercadeo` el mismo
> identificador de cuenta que tenía `@theconsultour`. Nuestro código empareja canales por ese
> identificador, así que la sincronización no creó una fila nueva: le cambió el nombre a la vieja.
> Ver el paso 2.
>
> **Si alguna vez hay que purgar otra vez,** se arma la consulta desde cero con el paso 1.0, mirando
> qué cuenta hay detrás de cada id **en ese momento**. Nunca se copia el id de este documento.

```sql
-- Paso 1.1: la purga. Reemplazar el id por el del canal de Instagram del paso 1.0.
-- EJECUTADA el 22/09/2026. Ese id hoy es @alomercadeo: ver la advertencia de arriba.
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
- **La fila del canal.** Borrarla no sirve de nada. Si en el paso 2 Zernio le da a la cuenta nueva
  un identificador nuevo, la sincronización crea otra fila y desactiva esta. Si le da el mismo, que
  es lo que pasó en la primera ejecución, la sincronización reusa esta fila y le cambia el nombre.
  Acá decía que la fila "se reusa en el paso 2" como si fuera seguro. Resultó cierto, pero por un
  motivo que no se conocía: ver el paso 2.
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

5. **Comprobación obligatoria, no algo que se mira de paso:**

   ```bash
   node scripts/verify-id-mensaje-zernio.mjs --cuentas
   ```

   **Tiene que devolver exactamente 1 cuenta de Instagram, la del negocio.** Es el control positivo
   del paso 0: el cero de ahí solo significa "se desconectó" si este uno aparece con la misma clave.
   **Si devuelve 0 con la cuenta visible en el panel de Zernio, parar:** el cero del paso 0 no valía
   nada, y el problema es la clave o la lectura, no la conexión.

> **Lo que pasó en la primera ejecución, y el documento no lo preveía: el canal no es una fila nueva.**
>
> El 22 de septiembre de 2026, Zernio le dio a `@alomercadeo` **el mismo identificador de cuenta** que
> había tenido `@theconsultour`: `6aab34cb8d284ffb210b9700`. La sincronización empareja canales por
> ese identificador, así que encontró la fila vieja (`8f30b551…`) y le cambió el nombre. No hay una
> fila de `@theconsultour` desactivada: hay una sola fila, que antes era una cuenta y ahora es otra.
>
> Dos consecuencias para este procedimiento:
>
> - **La consulta 1.1 no se puede volver a correr.** Su id de canal hoy es la cuenta real. Ver la
>   advertencia del paso 1.
> - **La frase del paso 0 "esa cuenta ya no va a existir" es falsa en el sentido que importa.** La
>   cuenta de Instagram se fue, pero su identificador en Zernio volvió con otra cuenta adentro.
>
> Y una que excede a este procedimiento: `late_account_id` no identifica una cuenta de Instagram. Está
> desarrollado en F26 del plano.

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

> **Hueco conocido, encontrado en la primera ejecución: nuestra importación tiene un techo de 200.**
>
> `lib/inbox-sync.ts:15-16`: `MAX_PAGES_PER_CHANNEL = 4` y `PAGE_SIZE = 50`. Cada sincronización lee
> como máximo 200 conversaciones, **siempre empezando por las más recientes**. Las que ya conoce las
> saltea, pero igual ocupan lugar en esas 4 páginas, así que una sincronización repetida vuelve a
> leer las mismas 200 y no llega nunca más abajo.
>
> Medido el 22 de septiembre de 2026: Zernio reprodujo 500 conversaciones y nuestra base quedó en
> 200. **Lo resuelve F27**, cuya importación tiene que recorrer hasta el final de la paginación y
> no hasta un número fijo de páginas. Hasta entonces se deja así, a propósito: el negocio no trabaja
> todavía desde nuestra bandeja, así que las conversaciones que faltan no le faltan a nadie, y
> cambiar el código a mitad del procedimiento metía un despliegue entre los pasos 2 y 3.
>
> **La consecuencia para la condición de parada de abajo es la que importa:** medida sobre nuestra
> tabla, se cumple sola. El conteo se clava en 200, las tres lecturas salen iguales y la condición da
> por terminado algo que nunca pudo pasar de ahí. Por eso el conteo se toma **del lado de Zernio**,
> no del nuestro. Ver §14 del plano, "Un instrumento comparado solo contra sí mismo".

### La condición de parada, y por qué "hasta que deje de subir" no sirve

**Un conteo estable no significa que terminó.** Significa que no entró nada entre esta lectura y la
anterior, y eso tiene dos causas que se ven idénticas: la reproducción **terminó**, o la
reproducción **está pausada** —un límite de tasa de Meta, un lote lento, un reintento en espera—.
Una sola lectura plana no las distingue, y es la misma falla que este proyecto viene persiguiendo:
una ausencia leída como una confirmación.

**La condición endurecida tiene dos partes y hacen falta las dos, no una u otra:**

1. **Tres lecturas consecutivas con el mismo número**, con **quince minutos** entre lecturas.
2. **Y** que hayan pasado al menos **dos horas desde la conexión**.

La primera sola se cumple durante cualquier pausa larga. La segunda sola se cumple aunque la
reproducción siga trabajando. Juntas, hay que estar tanto parado como haber esperado.

**De dónde salen estos números, dicho con todas las letras: no están medidos.** El proveedor
documenta el **alcance** de la reproducción —hasta 500 conversaciones por cuenta, y los 500 mensajes
más recientes de cada una— pero **no dice cuánto tarda, no publica ningún límite de tasa para este
proceso, y no expone ninguna señal de progreso ni de finalización**. No hay endpoint que conteste
"¿terminó?". Así que estos márgenes son holgados a propósito, elegidos para que equivocarse cueste
espera y no datos, y **no hay que citarlos como si fueran un dato del proveedor**. La primera
ejecución real de este procedimiento es la oportunidad de reemplazarlos por números medidos: anotar
en el paso 5 cuánto tardó de verdad.

**Cómo se toma cada lectura, corregido después de la primera ejecución.** El conteo de nuestra tabla
**no sirve** para esta condición: tiene un techo de 200 (ver el hueco conocido de arriba) y se
queda quieto aunque la reproducción siga. Hasta que F27 saque ese techo, la lectura se toma **del lado
de Zernio**: cantidad de conversaciones paginando `GET /v1/inbox/conversations` hasta el final, más
`dmHistoryBackfillStatus` y `dmHistoryBackfillAt` de `GET /v1/accounts`. **Todavía no hay un script
del repo que haga esa lectura**: en la primera ejecución se hizo con un script descartable.

Y si alguna vez se vuelve a medir sobre nuestra tabla, **cada lectura va precedida de una
sincronización**. Lo único que importa conversaciones viejas es la sincronización (el botón de
Canales, el de Bandeja, o la vuelta del OAuth), y la reproducción no manda webhooks. Una lectura sin
sincronizar antes no puede subir, así que tres lecturas iguales salen por construcción.

```sql
-- Solo con una sincronización inmediatamente antes, y sabiendo que el techo es 200.
select count(*) as conversaciones, now() as leido_a_las from conversations;
```

Repetir el barrido entre lecturas es seguro: el backfill es solo de inserción y saltea las
conversaciones que ya conoce.

### Lo que esta condición sigue sin cubrir, y hay que nombrarlo

**Si la reproducción se cortó de verdad a la mitad, ninguna espera lo va a revelar.** El conteo va a
estar estable, las tres lecturas van a coincidir, las dos horas van a pasar, y la condición va a dar
por terminado un trabajo que se murió con la mitad de las conversaciones traídas. Estable por el
motivo equivocado.

**No hay señal automática para eso**, porque la única forma de detectarlo sería comparar contra un
total esperado que el proveedor no publica. Endurecer más la espera no ayuda: el problema no es el
tiempo, es que la magnitud que se mide no distingue completo de incompleto.

**La señal es humana y es la única que hay:** que falten conversaciones que el negocio sabe que
existen. Por eso está en la tabla de lectura del paso 4 como comprobación a ojo, y no como consulta.
Alguien que conoce las conversaciones del negocio tiene que abrir la bandeja y buscar tres o cuatro
que espere encontrar. Es menos elegante que una consulta y es lo que hay.

**Dos consecuencias que conviene tener presentes:**

- **La reproducción no emite webhooks.** Así que no sirve mirar el log de entregas para saber si
  terminó, y tampoco va a mover la marca de último evento entrante de F39.
- **Si la cuenta tiene el acceso a mensajes de "herramientas conectadas" de Instagram apagado, no se
  reproduce nada.** Si después de varias sincronizaciones no aparece ninguna conversación vieja, ese
  es el primer lugar donde mirar, antes de sospechar del código. **Dónde está el ajuste**, en la app
  de Instagram, verificado el 22 de septiembre de 2026: Configuración → Mensajes y respuestas a
  historias → Solicitudes de mensajes → Herramientas conectadas → **Permitir acceso a mensajes**. En
  la versión web, según la documentación de Zernio: Settings → Website permissions → Connected tools.
  Los nombres de los menús cambian entre versiones, así que lo que hay que buscar es la frase
  "Permitir acceso a mensajes" bajo "Herramientas conectadas". Una ruta anterior, que decía
  "Controles de mensajes", circuló fuera de este repo y es incorrecta.

### Primera ejecución, 22 de septiembre de 2026: 2.1 no se cumplió, dejó de aplicar

**La condición de parada no se cumplió. Se abandonó porque dejó de aplicar**, y la diferencia se
escribe porque "condición cumplida" sería falso y dejaría a quien lea esto creyendo que el
instrumento funcionó. No funcionó: estaba midiendo su propio techo.

2.1 existía para no avanzar con un historial importado a medias. Resultó que nuestra base está
clavada en 200 por nuestro propio código (`lib/inbox-sync.ts:15-16`, ver el hueco conocido de
arriba), así que esperar no podía mejorar nada. Ninguna cantidad de lecturas ni de horas cambia un
techo.

**Por qué era seguro avanzar sin saber si la reproducción había terminado.** Zernio informa
`dmHistoryBackfillStatus: "partial"`, un valor que su documentación no define. Cuatro cosas hacen
que no importe qué significa:

1. Nuestra base ya tiene las 200 más recientes, y no puede tener más.
2. Zernio llegó a 500, que es su máximo documentado, así que no puede sumar conversaciones.
3. Los mensajes de cada conversación la bandeja los lee en vivo de Zernio: no guardamos nada que
   pueda quedar a medias.
4. La reproducción no emite webhooks, según la documentación de Zernio, así que no se cruza con la
   rotación del paso 3.

**Lo medido, y no más que esto** (hora de Costa Rica, conexión a las 13:38):

| Cuándo | Qué | Fuente |
|---|---|---|
| 13:40, a los 2 minutos | 200 o más conversaciones reproducidas: nuestra importación ya trajo 200 | `conversations`, por fecha de creación |
| 13:42, a los 4 minutos | Zernio estampa el estado de la reproducción, `partial` | `dmHistoryBackfillAt` en `GET /v1/accounts` |
| 13:46, a los 8 minutos | 500 conversaciones del lado de Zernio, de la del 3 de agosto a la de hoy | Paginando `GET /v1/inbox/conversations` |

**No dice "terminó en 8 minutos".** Dice que a los 8 minutos el proveedor había llegado a su tope,
con un estado que no sabemos leer.

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

**El veredicto son tres cosas juntas, no una:**

1. `COINCIDENCIA sí`. Si dice que no, el secreto nuevo quedó en la base y no llegó a Zernio: toda
   entrega va a fallar la verificación de firma. Repetir el re-registro.
2. **Y el secreto termina en algo distinto de lo que terminaba antes de rotar.** Hay que anotar los
   últimos cuatro caracteres **antes** del paso 3.1. `COINCIDENCIA sí` con el mismo final significa
   que la rotación no ocurrió, y se ve igual de verde que el éxito.
3. **Y los eventos son los de `WEBHOOK_EVENTS` en `lib/zernio-webhook.ts`**, hoy tres:
   `message.received`, `comment.received` y `message.sent`. **El script no compara esto**: dice "el
   registro está bien" aunque falte un evento. Hay que mirarlo a ojo hasta que el script lo compare.

> **Qué pasó en la primera ejecución con el punto 3.** El secreto rotó bien, de `…694b` a `…85b1`,
> pero la suscripción **perdió `message.sent`**. Producción corría código anterior al commit
> `63834ac`, que es el que suma ese evento a `WEBHOOK_EVENTS`: la rama local tenía 19 commits sin
> subir. `message.sent` se había suscrito a mano el 21, y el re-registro de la rotación lo reescribió
> con la lista vieja. Es la trampa que ese mismo commit describe, y se disparó porque el arreglo nunca
> llegó a desplegarse.
>
> **El atajo que no hay que tomar:** volver a correr `scripts/suscribir-message-sent.mjs` sin
> desplegar. Producción tampoco tiene `e65d37f`, el arreglo del filtro de salientes del receptor, así
> que con `message.sent` suscrito cada mensaje que el negocio escriba desde el celular entraría como
> entrante. El arreglo es desplegar, sincronizar, y repetir este paso y el 4.

> **Acá es donde el procedimiento puede mentir.** Si el re-registro falló, la pantalla igual dice
> que todo salió bien. El paso 3.2 mira la configuración en Zernio, que es el dato real, pero
> **tampoco alcanza**: confirma que el webhook figura registrado y que los secretos coinciden, no
> que las entregas lleguen y verifiquen. Un secreto que coincide y un webhook apuntando a una URL
> que no responde se ven igual desde ahí. Eso lo prueba solamente el paso 4.

---

## 4. Verificación de punta a punta, con un mensaje real

**Esto no es "revisar que se vea bien".** Es el control positivo de los pasos 2 y 3, y sin él el
procedimiento no se puede dar por hecho.

1. Desde un teléfono, con **otra** cuenta de Instagram **propia**, mandar un DM a la cuenta del
   negocio. **Nunca se usa el hilo de un cliente real.** Leer por la API no marca nada como leído,
   pero responder sí: una respuesta de prueba en el hilo de un cliente lo deja marcado como atendido
   en el celular del negocio. Si en algún momento parece que hay que responderle a alguien que no sea
   la cuenta de prueba, se para y se pregunta.
2. Esperar hasta 60 segundos.
3. Comprobar las tres cosas, en este orden:

- **a. ¿Zernio entregó el evento y nuestro receptor lo aceptó?** Hay que ver, en el log de entregas
  (`GET /v1/webhooks/logs`), una entrada `message.received` **posterior a la rotación**, con
  `status: success` y `statusCode: 200`.

  > **Hueco encontrado en la primera ejecución: ningún script del repo muestra eso.** Acá decía que
  > `node scripts/verify-id-mensaje-zernio.mjs` "busca status success y el código HTTP". No es así:
  > el modo principal lee el log de entregas pero compara identificadores de mensaje, y no imprime ni
  > el estado ni el código de ninguna entrega. Además termina en "NO CONCLUYENTE" global cuando el log
  > trae mensajes de una cuenta que ya no está conectada: es esperado, pero asusta. En la primera
  > ejecución el estado y el código se leyeron del log con un script descartable, imprimiendo solo
  > evento, hora, estado y código. Hace falta un modo del script que haga eso.

- **b.** El mensaje aparece en la bandeja de la aplicación.
- **c.** El contacto figura con el nombre de usuario correcto. **Puede no ser un contacto nuevo:** si
  la cuenta de prueba ya había escrito alguna vez a la cuenta del negocio, la reproducción del paso
  2.1 ya la trajo, y el mensaje de prueba cae en esa conversación. Pasó en la primera ejecución.

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

**Y una comprobación que no es una consulta, porque no puede serlo.** Después de que 2.1 se haya
cerrado, alguien que conozca las conversaciones del negocio abre Instagram en el celular y compara
contra nuestra bandeja, **en dos tramos, y hacen falta los dos**:

1. **Las primeras diez a quince conversaciones del celular**, una por una contra la bandeja.
2. **Y algunas de la cola, buscadas por nombre:** de principios de septiembre, cerca de nuestro
   corte, y de fines de julio o principios de agosto, cerca del corte del proveedor. Las fechas de
   los dos cortes están en la tabla de abajo.

**Por qué el primer tramo solo no sirve.** Da bien por construcción. Los dos topes que hay en el
camino —el del proveedor y el nuestro, ver 2.1— se quedan con las conversaciones **más recientes** y
cortan por abajo. Comparar la cabeza de la lista confirma justamente la parte que ningún tope toca.
Un corte, si lo hay, está en la cola, y ahí es donde hay que mirar.

**Hoy el segundo tramo falla, y ese fallo es esperado.** Medido el 22 de septiembre de 2026, por
fecha de última actividad de cada conversación:

| Tramo | Dónde está | Por qué |
|---|---|---|
| Del 3 de septiembre al día de hoy | En nuestra bandeja | Son las 200 más recientes. La número 200 es del 3 de septiembre |
| Del 3 de agosto al 3 de septiembre | En Zernio, **no** en nuestra bandeja | Nuestra importación lee como máximo 4 páginas de 50 (`lib/inbox-sync.ts:15-16`) |
| Antes del 3 de agosto | En ningún lado del sistema, solo en Instagram | El proveedor reproduce hasta 500 conversaciones, y la número 500 es del 3 de agosto |

**Y hay un techo más, arriba de estos, que apareció en la comparación misma:** la pantalla de la
bandeja muestra solo **50** de las 200, la más vieja del 16 de septiembre
(`app/(dashboard)/dashboard/inbox/page.tsx:12`, un `.limit(50)` fijo, sin carga al bajar). La
comparación del primer tramo se hace contra la pantalla, así que lo que se puede comparar ahí es del
16 de septiembre en adelante. Para buscar una del 3 al 16 de septiembre, que sí está en la base, la
pantalla no sirve. Desarrollado en F35 del plano.

**Ese fallo no es motivo para no cerrar el procedimiento:** el tramo del medio es el hueco conocido
que resuelve F27, y el de abajo es el límite documentado del proveedor. Lo que sí sería motivo es que
falte alguna del primer tramo, o que el corte caiga en otra fecha que la que explican los topes.
Por eso conviene mirar justo a los dos lados de cada corte: una conversación del 4 o 5 de septiembre
tiene que estar, y una de fines de agosto no.

Esta comparación es la única señal de que la reproducción se cortó a la mitad. El conteo no la da:
una reproducción muerta y una terminada dejan el número igual de quieto.

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

- Anotar en `docs/estado-fase1.md` la fecha de ejecución y el resultado.
- **Anotar cuánto tardó de verdad la reproducción del historial**, y con cuántas conversaciones
  terminó. Los números de la condición de parada de 2.1 son márgenes elegidos sin dato, y esta es la
  única oportunidad de reemplazarlos por uno medido. Con eso anotado, la próxima ejecución —o la de
  quien clone este proyecto— deja de esperar dos horas por las dudas.

### Registro de la primera ejecución, 22 de septiembre de 2026

Todas las horas son de Costa Rica.

| Paso | Qué pasó |
|---|---|
| 0 | `@theconsultour` desconectada a las 12:15. La lectura de las 12:50 dio 0 cuentas. El control positivo se corrió al paso 2 |
| 1 | Purga en dos tiempos, antes de las 13:38: una corrida en seco terminada en `rollback`, que devolvió los ceros, y después la real. Verificada con una consulta de solo lectura: contactos, conversaciones, mensajes y canales de contacto en 0, canales en 2, y el registro de webhooks en 9, sin perder filas |
| 2 | `@alomercadeo` conectada a las 13:38. La comprobación de cuentas dio 1: el cero del paso 0 era real. **Zernio reusó el identificador de cuenta**, y la fila del canal se renombró en vez de reemplazarse |
| 2.1 | **No se cumplió: dejó de aplicar.** Ver la sección de 2.1 |
| 3 | Secreto rotado de `…694b` a `…85b1`, con coincidencia. **La suscripción perdió `message.sent`.** Ver 3.2 |
| 4 | Entrada: `message.received` a las 14:27:04, `success`, HTTP 200, primer intento, posterior a la rotación. Mensaje visible en la bandeja y contacto con el usuario correcto, confirmados por Marcos. Salida: Zernio aceptó el envío desde la bandeja a las 14:28:14, y Marcos confirmó que llegó al celular. **Veredicto: entra y sale** |

**La reproducción del historial, medida y no más que esto.**

- **Tiempos:** 200 o más conversaciones a los 2 minutos de conectar. El estado estampado como `partial` a los 4. 500 del lado de Zernio a los 8, que es el tope documentado del proveedor, con la conversación más vieja del 3 de agosto. **No dice "terminó en 8 minutos".**
- **Relectura a las 15:04:** una hora y 22 minutos después, el estado seguía en `partial`, con la misma marca de hora de las 13:42. **Inferencia, no medición:** es un estado final, probablemente "terminó recortada por el tope". Zernio no documenta ese valor.
- **Qué cambia para la próxima ejecución:** la espera de dos horas sobraba. Lo que decide si hay que seguir esperando es el conteo del lado de Zernio contra su tope de 500, y no nuestra tabla.

**El pendiente de `message.sent`, cerrado el mismo día.**

1. **Primer despliegue: falló el build.** Los 21 commits se subieron a las 16:05 y Railway falló al construir `5f697e8`. El tipo `WebhookEvent` (`lib/zernio-webhook.ts`) seguía con dos eventos, cuando `63834ac` ya había sumado el tercero a la lista. `npm test` estaba en verde porque Vitest no chequea tipos, y desde el 21 nadie había corrido un build. Producción siguió en `69cfbc0`, sin cortes.
2. **Arreglo y segundo despliegue.** El tipo pasó a derivarse de la lista (`98aa3aa`), con `npm run build` fallando antes del cambio y pasando después. Railway lo desplegó bien.
3. **Registro, antes y después.** Antes de sincronizar, a las 16:24, `--registro` mostraba dos eventos: el despliegue solo no toca la suscripción. Marcos sincronizó, y a las 16:25 mostraba **tres eventos**, con `message.sent`, el secreto todavía en `…85b1` y coincidencia sí.
4. **Canario y repetición del paso 4, con la cuenta de prueba:**

| Hora | Qué | Entrega | Base |
|---|---|---|---|
| 16:27:18 | Saliente desde la bandeja | `message.sent` 16:27:20, HTTP 200, `{"ok":true,"skipped":true}` | Sin cambios: 200 contactos, `unread_count` 0, eventos sin sumar |
| 16:29:51 | Entrante desde el celular | `message.received` 16:29:54, HTTP 200, `{"ok":true,"queued":true}` | `last_message_at` a las 16:29:54 y un evento más en el registro: el receptor procesó |
| 16:34:43 | Respuesta desde la bandeja a ese mensaje | `message.sent` 16:34:43, HTTP 200, `skipped` | Marcos confirmó que llegó al celular |

**Veredicto de la repetición: entra y sale, con `message.sent` suscrito y entregando.**

**Lo que esta verificación no prueba, dicho con todas las letras:**

- **`e65d37f`, el arreglo del filtro de dirección, no tiene canario en vivo.** Un `message.sent` nunca llega a ese filtro: el receptor descarta antes todo evento que no sea `message.received` (`app/api/webhooks/late/route.ts:166-168`). Ese filtro solo actúa ante un `message.received` con dirección `outgoing`, y en 30 días de log no apareció ninguno. Lo cubre el test `route.test.ts:387-390`, que comprueba `skipped: true` pero no exige `reason: "outgoing"`.
- **La lectura de `unread_count` del entrante es no concluyente.** Por el código tenía que quedar en 2, y a las 16:31 estaba en 0. La conversación tiene `updated_at` a las 16:30:23, sin cambio en `last_message_at`. Lo único del código que hace eso es la bandeja marcando como leída la conversación al seleccionarla (`app/(dashboard)/dashboard/inbox/inbox-view.tsx:109-119`). Inferencia: alguien la abrió en ese momento, y la interfaz alteró el estado que se estaba midiendo. El veredicto del entrante se apoya en la entrega y en `last_message_at`, no en este contador.
- **Además, se corrigió una premisa del orden de despliegue.** Se temía que, al volver a suscribir `message.sent` con el filtro roto, los salientes se guardaran como entrantes. No podía pasar: por el mismo filtro por tipo, `message.sent` se descarta antes de llegar al filtro de dirección, en el código viejo y en el nuevo. Y el receptor tampoco guarda mensajes hasta F27.

**Techos encontrados, ninguno de los cuales avisa:** Instagram, todas; Zernio, 500 desde el 3 de agosto; nuestra base, 200 desde el 3 de septiembre (`lib/inbox-sync.ts:15-16`, lo resuelve F27); la lista de contactos, 100 desde el 13 (`app/(dashboard)/dashboard/contacts/page.tsx:13`); la bandeja, 50 desde el 16 (`app/(dashboard)/dashboard/inbox/page.tsx:12`). Los dos últimos están desarrollados en F35 del plano.
- El estado del registro del webhook va a ser visible en pantalla cuando se construya F24, con lo
  que este procedimiento va a dejar de depender de correr scripts a mano para saber si quedó bien.
