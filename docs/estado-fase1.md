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

**Migraciones aplicadas:** 00017 a 00021, todas idempotentes, sobre las 16 del fork.

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

**Tests:** 108 en 12 archivos. El fork traía 60 en 7.

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

- **Autenticación del webhook de Evolution.** Sin resolver, y hay que resolverlo antes de conectar el canal. La firma HMAC de Zernio ya falla cerrada; el webhook de Evolution necesita una garantía equivalente.
- **¿Redis es necesario?** La plantilla de Railway lo despliega, pero la documentación de Evolution v2 lo describe como caché de rendimiento y existe `CACHE_LOCAL_ENABLED`. Probable que se pueda prescindir. Sin verificar.
- **La sesión de WhatsApp expira sin aviso visible.** Sobrevive a un redeploy porque se guarda en Postgres, pero al expirar la bandeja simplemente deja de recibir, igual que si no escribiera nadie. Hace falta estado de sesión visible en la pantalla de canales y forma de volver a escanear el QR.
- **Verificación de negocio en Meta:** confirmada como no hecha. Prevista para la semana del 22 de septiembre. No bloquea nada; levanta el tope de 250.
- **Cuatro preguntas para Zernio**, todavía sin respuesta, hoy menos urgentes: si absorben la verificación de negocio, si exponen gestión de plantillas por API, si el webhook de WhatsApp es en tiempo real, y la región y tipo de línea del número.
- **Purga de datos de prueba, reconexión de Instagram y rotación del secreto de firma.** Pendiente, con procedimiento escrito y versionado en **`docs/purga-y-reconexion-instagram.md`**. Son cuatro pasos acoplados y el orden no es negociable. Incluye el motivo por el que la rotación no se hizo suelta: rotar obliga a re-registrar el webhook, y ese re-registro falla en silencio por un `try/catch`, así que el procedimiento de rotación pasa justo por el camino de falla que el propio hallazgo describe. La verificación de punta a punta que la rotación necesita ya está en ese documento, en vez de ser un paso que alguien tiene que acordarse de agregar.

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

## Siguiente paso

Correr `05-requerimientos` para generar el plano de los Bloques 2, 3 y 4, ya con las dos decisiones tomadas. Lo que tiene que entrar en esa regeneración y hoy no está en ningún plano:

- El adaptador de Evolution API, con el mismo contrato de canal que Instagram y sin condicionales por plataforma en el camino de entrada.
- El guardado de mensajes entrantes, con idempotencia por `platform_message_id`, el backfill inicial y la decisión sobre adjuntos.
- Las seis reglas de seguridad de secuencia, como configuración del canal.
- El estado de la sesión de WhatsApp visible en la pantalla de canales, con forma de volver a escanear el QR.
- La autenticación del webhook de Evolution.
- El despliegue en Railway con varios servicios y las dos bases Postgres separadas.
- El modelo de ventana y plantillas de WhatsApp, marcado como condicional al plan B.
