# Checklist de verificación de Instagram (F4)

Para ejecutar con una cuenta de Instagram real conectada por Zernio. Cada criterio tiene qué hacer,
qué mirar en la base después, y qué significa que pase.

Las consultas son de **lectura**. Se pueden correr en el SQL Editor de Supabase sin romper la regla
del proyecto, que prohíbe *aplicar migraciones* a mano, no consultar.

---

## Antes de empezar: el orden de conexión no es negociable

Desde la Sesión B del Bloque 1, **el webhook falla cerrado**: si el canal no tiene webhook secret
configurado, `/api/webhooks/late` responde 401 y descarta el evento. Antes lo procesaba sin
verificar nada, que era un endpoint abierto al motor de flujos.

La consecuencia operativa es esta, y hay que entenderla antes de tocar nada:

> **Si se mandan mensajes de prueba antes de que el secret esté registrado, esos mensajes se
> descartan con 401 y se pierden.** Zernio reintenta un rato y después abandona. No hay forma de
> recuperarlos: no quedan en ninguna cola local.

Por eso el orden es: **clave → secret → recién ahí, mensajes**.

### Paso 0.1 — Guardar la API key de Zernio

En `/dashboard/settings`, pegar la API key y usar "Test connection". Tiene que responder con la
cantidad de cuentas encontradas.

Verificar que quedó guardada **en Vault y no en una columna**:

```sql
-- Tiene que devolver una fila. El valor no se muestra: alcanza con que exista.
select name, created_at
from vault.secrets
where name = 'ws:' || (select id from workspaces limit 1) || ':zernio_api_key';
```

```sql
-- Tiene que devolver 0 filas: las columnas en texto plano ya no existen (00021).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'workspaces'
  and column_name in ('late_api_key_encrypted', 'ai_api_key');
```

### Paso 0.2 — Confirmar que el secret existe y coincide con el registrado en Zernio

Guardar la clave dispara el registro del webhook en Zernio, pero es **best-effort**: si falla, la
clave se guarda igual y el error solo queda en los logs del servidor. Hay que confirmarlo a mano.

```sql
-- Tiene que devolver `true`. Si devuelve false, no sigas: todo mensaje entrante va a dar 401.
select webhook_secret is not null and length(webhook_secret) = 64 as secret_ok
from workspaces
limit 1;
```

Después, en el panel de Zernio, abrir la configuración de webhooks de la cuenta y verificar las tres
cosas:

- [ ] Existe un webhook apuntando a `<NEXT_PUBLIC_APP_URL>/api/webhooks/late`
- [ ] Su secret es **exactamente** el mismo valor de `workspaces.webhook_secret`
- [ ] Tiene suscritos los eventos `message.received` **y** `comment.received`

Si el secret difiere, volver a guardar la API key desde `/dashboard/settings`: `ensureWebhookRegistered`
detecta la diferencia y lo actualiza. Si sigue distinto, el registro automático está fallando y hay
que mirar los logs del servidor antes de seguir.

### Paso 0.3 — Recién ahora, mensajes de prueba

Con 0.1 y 0.2 en verde, los eventos entrantes se van a verificar bien y no se pierde nada.

---

## Los 8 criterios de F4

### 1. Se puede conectar una cuenta de Instagram desde la UI con la API key de Zernio

En `/dashboard/channels`, "Connect" → Instagram, completar el flujo de Zernio y volver.

```sql
select id, platform, username, display_name, is_active, created_at
from channels
where platform = 'instagram';
```

**Pasa si:** hay una fila con `is_active = true` y el `username` de la cuenta real.

---

### 2. Los DMs entrantes llegan en tiempo real por webhook

Desde otra cuenta de Instagram, mandar un DM a la cuenta conectada.

```sql
select c.id, c.last_message_preview, c.last_message_at, c.unread_count,
       ct.display_name, ct.setter_id, ct.vendedor_id
from conversations c
join contacts ct on ct.id = c.contact_id
where c.platform = 'instagram'
order by c.last_message_at desc nulls last
limit 5;
```

**Pasa si:** aparece la conversación en segundos, con `last_message_preview` igual al texto enviado.

**Si no aparece**, mirar primero los logs del servidor buscando `[webhook] rechazado`. Ese mensaje
significa que el paso 0.2 no está bien y el evento se descartó con 401.

---

### 3. Los comentarios se reciben y se pueden responder

Comentar en una publicación de la cuenta con una palabra clave configurada en un flujo de
`comment_keyword`.

```sql
select platform_comment_id, author_username, comment_text,
       matched_trigger_id, dm_sent, reply_sent, error, created_at
from comment_logs
order by created_at desc
limit 5;
```

**Pasa si:** hay una fila con el texto del comentario. `matched_trigger_id` no nulo y `dm_sent` en
true si había un flujo que matcheara. `error` tiene que estar en null.

---

### 4. Las story replies llegan a la bandeja

Responder a una historia de la cuenta conectada desde otra cuenta.

```sql
select c.id, c.last_message_preview, c.last_message_at, ct.display_name
from conversations c
join contacts ct on ct.id = c.contact_id
where c.platform = 'instagram'
order by c.last_message_at desc nulls last
limit 3;
```

**Pasa si:** la story reply crea o actualiza una conversación igual que un DM. Zernio las entrega
como `message.received` con un attachment, y el handler no las trata aparte a propósito: el criterio
es justamente que no se caigan por el camino.

---

### 5. Los mensajes se vinculan al contacto correcto por username de Instagram

Con al menos dos DMs de la **misma** persona, y uno de otra.

```sql
select ct.id, ct.display_name, cc.platform_username, cc.platform_sender_id,
       count(conv.id) as conversaciones
from contacts ct
join contact_channels cc on cc.contact_id = ct.id
left join conversations conv on conv.contact_id = ct.id
group by ct.id, ct.display_name, cc.platform_username, cc.platform_sender_id
order by ct.created_at desc
limit 10;
```

**Pasa si:** hay **un solo** contacto por persona, con su `platform_username` de Instagram, y los
dos mensajes cayeron en la misma conversación. Dos contactos para la misma persona es una falla.

---

### 6. Se pueden enviar respuestas desde la bandeja

Desde `/dashboard/inbox`, abrir la conversación y responder.

**Pasa si:** el mensaje llega a Instagram y aparece en el hilo. Un error de ventana cerrada es un
resultado válido y distinto de una falla: la ventana de 24 horas la impone Meta, no el sistema.

---

### 7. El estado de la conexión es visible — **el documento dice `/settings/integrations`, que no existe todavía**

Esa pantalla es del **Bloque 2** (sección 4.8 del documento de requerimientos). Hoy el estado de
conexión se ve en `/dashboard/channels`, con el indicador de activo/inactivo por canal.

**Se verifica así:** en `/dashboard/channels` el canal de Instagram figura como activo, y el botón
de pausar/reanudar cambia `channels.is_active`.

```sql
select username, is_active, updated_at from channels where platform = 'instagram';
```

Cuando exista `/settings/integrations`, este criterio se revisa ahí.

---

### 8. Los mensajes se almacenan en `messages` — **solo se cumple para los salientes**

Esta es una diferencia real entre el documento y el fork, y conviene saberla antes de buscar filas
que no van a estar.

**El fork no guarda los mensajes entrantes.** El handler del webhook lo dice explícitamente:
*"Messages are stored by Zernio (source of truth) — no local insert needed"*. La bandeja los lee de
la API de Zernio en `/api/v1/messages`. Lo que sí se guarda en `messages` es lo **saliente**: lo que
manda el motor de flujos, el procesador de secuencias y el nodo de IA.

```sql
-- Salientes: tiene que haber filas si un flujo respondió.
select m.id, m.direction, m.text, m.conversation_id, m.sent_by_flow_id, m.created_at
from messages m
join conversations c on c.id = m.conversation_id
where c.platform = 'instagram'
order by m.created_at desc
limit 10;
```

**Pasa si:** los mensajes salientes están, con `conversation_id` correcto. La referencia al canal se
obtiene por la conversación (`conversations.channel_id`), no por una columna en `messages`.

**Qué hacer con la diferencia:** o se ajusta el criterio del documento a "los salientes se almacenan
y los entrantes se leen de Zernio", o se decide guardar también los entrantes, que es un cambio de
alcance con consecuencias —duplicar la fuente de verdad, y decidir qué pasa cuando difieren—. La
decisión no es parte de F4.

---

## Después de la verificación

- [ ] Borrar los contactos y conversaciones de prueba, o dejarlos anotados como datos de prueba
- [ ] `npm run verify:security` en verde (scope de leads y scope de Realtime)
- [ ] Ningún `[webhook] rechazado` en los logs del período de prueba

## Lo que este checklist NO cubre

**WhatsApp no se conecta en esta sesión**: no se crea el canal ni se registra el número. El
adaptador y el camino de entrada se verifican con los tests de Vitest
(`app/api/webhooks/late/route.test.ts`), que prueban que un `message.received` de WhatsApp entra por
el mismo camino que uno de Instagram y con el mismo resultado. La conexión real se verifica el día
que llegue el número, con los criterios de F6.
