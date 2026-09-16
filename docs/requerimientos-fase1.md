# Requerimientos — Sistema Operativo para Negocios de Servicios Digitales
## Fase 1, Etapa 1

**Versión:** 2 (WhatsApp por API oficial sobre número dedicado; once discrepancias corregidas)
**Fecha:** 15 de septiembre de 2026

---

## 0. Registro de cambios respecto del BRD de clase

### Cambio mayor: WhatsApp

| Qué decía | Qué dice ahora | Por qué |
| --- | --- | --- |
| WhatsApp vía Evolution API (Baileys), servicio aparte en Railway, conexión por QR | **WhatsApp por API oficial de Meta vía Zernio, sobre un número nuevo dedicado** | El número disponible es personal de la dueña y la coexistencia apagaría la ubicación en tiempo real, que usa como protocolo de seguridad. Baileys arriesga un ban permanente del número. Ver el anexo de integración de WhatsApp |

Esto arrastra cambios en: arquitectura de hosting, variables de entorno, `integration_configs`, flujo de mensaje entrante, casos borde, stack, seguridad, README, y **dos funcionalidades nuevas** (plantillas y ventana de conversación).

### Otras once correcciones

| # | Discrepancia | Corrección |
| --- | --- | --- |
| 1 | "23 tablas" en el encabezado, pero la propia tabla 7.1 lista 24 filas | **24 tablas** en 16 migraciones |
| 2 | "17 tipos de nodo" acá, 18 en el alcance de clase | **16 componentes de nodo** en el código. Ver nota en 13c |
| 3 | La pantalla es `/settings/integrations` en 4.8 y F8, pero `/settings/channels` en la sección 10 | **`/settings/integrations`** en todos lados |
| 4 | F9 pide `youtube_channel_id` y `linkedin_profile_url`; la tabla 7.2 los omite | Se agregan a 7.2 |
| 5 | El README dice "migraciones 00001 a 00023", pero solo se definen hasta 00022 | **00001 a 00023**, con la nueva migración de WhatsApp |
| 6 | La migración de `late_api_key_encrypted` y `ai_api_key` a Vault se difiere a Fase 2 | **Se hace en Fase 1, Bloque 1.** Esas columnas guardan las claves en texto plano pese al nombre |
| 7 | F3 no tiene ningún criterio de aceptación para el scope de leads, pese a ser "restricción dura" | Se agregan criterios explícitos de scope, incluida la prueba por API |
| 8 | Realtime está habilitado en `conversations` y `messages` sin mencionar su interacción con el scope de leads | Se agrega criterio: Realtime respeta RLS |
| 9 | "No contactar" solo muestra advertencia al enviar | **Bloquea el envío de plantillas de WhatsApp.** Ver F18 |
| 10 | No hay modelo de la ventana de conversación | Se agrega (F6c y campos en `conversations`) |
| 11 | La URL del repo dice `github.com/zernio/zernflow` | **`github.com/zernio-dev/zernflow`** |

---

## 1. Mapa de ruta de fases

| Etapa | Fase | Duración estimada | Estado |
| --- | --- | --- | --- |
| **Etapa 1:** Sistema Operativo Base | **Fase 1: Foundation, Canales y CRM** | ~1 semana (4 bloques) | **← ACTUAL** |
|  | Fase 2: Comunicación y Automatizaciones | ~1 semana (3-4 bloques) | Siguiente |
|  | Fase 3: Agente IA, Analytics y Pulido | 3-5 días (2-3 bloques + testing integral) | Pendiente |
| **Etapa 2:** Publicación + Email + Roles + Ads | Fases 1-3 | Por definir | Futura |
| **Etapa 3:** Agente IA Integral + Fathom + MCP | Fases 1-3 | Por definir | Futura |
| **Etapa 4 (opcional):** Agendamiento + Ventas + Pipeline | Fases 1-3 | Por definir | Futura |

**Qué NO se construye ahora pero SÍ está contemplado en el diseño:**

- El modelo de datos incluye campos y relaciones preparados para: roles custom con permisos granulares (Etapa 2), email bidireccional (Etapa 2), publicación de contenido (Etapa 2), YouTube y LinkedIn (Etapa 2), agendamiento con Google Calendar (Etapa 4), ventas y pagos (Etapa 4), sistema de tareas (Extra A), form builder (Extra C).
- `contacts` incluye `ai_conversation_summary` (memoria acumulativa del agente, Fase 3) y `next_followup_date` (seguimientos, base del agendamiento de Etapa 4).
- `channels` abstrae la fuente de conexión para que el inbox unificado no dependa del mecanismo.
- `integration_configs` es genérica y extensible: soporta canales, proveedores de IA, email y cualquier integración futura sin nuevas tablas.
- **`whatsapp_templates` se crea en Fase 1 aunque las secuencias que la usan llegan en Fase 2.** Si el paso de secuencia guardara el texto como string libre, habría que rehacer el módulo.
- El flow builder mantiene su arquitectura extensible para que módulos futuros registren triggers, acciones y condiciones.

---

## 2. Objetivo de esta fase y mapa de bloques

**Objetivo:** levantar el sistema desde el fork de ZernFlow, conectar los dos canales de mensajería de la Etapa 1 (Instagram y WhatsApp, ambos por API oficial vía Zernio), configurar el email saliente con Resend, y construir un CRM completo con modelo de contacto extendido, detección cross-canal, scope de leads, herramientas de gestión y audit log. Todo single-tenant.

**Por qué esta fase va primero:** sin infraestructura base, canales conectados y un CRM funcional, no hay sobre qué construir automatizaciones (Fase 2) ni agente de IA (Fase 3).

**Dependencia externa de calendario:** la conexión de WhatsApp requiere un número dedicado que está en trámite, más la aprobación del nombre para mostrar por parte de Meta. **El desarrollo del canal no espera:** se construye y se prueba contra Instagram, y la conexión se ejecuta cuando el número esté disponible. Ver el anexo de integración de WhatsApp.

### Bloques de ejecución

| Bloque | Día | Qué se construye | Contexto compartido |
| --- | --- | --- | --- |
| Bloque 1: Fork, deploy y foundation | 1 | Fork de ZernFlow, deploy en Railway, Supabase Vault y **migración de las claves en texto plano**, verificación de roles/workspaces, **scope de leads por RLS**, conexión de Instagram y adaptador de WhatsApp (ambos Zernio) | `workspaces`, `workspace_members`, `channels`, `contacts`, `contact_channels`. Vault. Config de Railway |
| Bloque 2: Email, configuración de integraciones y BYOK IA | 2 | Resend, pantalla `/settings/integrations`, BYOK IA | `channels`, `integration_configs` (nueva). Vault |
| Bloque 3: Modelo de contacto y CRM | 3-4 | Extensión del contacto (atribución como JSONB), setter/vendedor, detección cross-canal, notas, ficha, soft delete | `contacts` (extendida), `contact_notes`, `audit_log` (nuevas) |
| Bloque 4: Bandeja, filtros, herramientas CRM y **ventana de conversación** | 4-5 | Filtros de inbox, templates de respuesta, "no contactar", importación CSV, audit log, **estado de ventana en la bandeja**, **plantillas de WhatsApp** | `response_templates`, `csv_imports`, `whatsapp_templates` (nuevas), `conversations` (extendida) |
| Testing de fase | 5 (medio día) | Testing funcional, correcciones, colchón | — |

Cada bloque es una unidad autocontenida que se ejecuta como un solo prompt (o serie de prompts) a Claude Code.

---

## 3. Usuarios y roles

| Rol | Descripción | Puede hacer | No puede hacer |
| --- | --- | --- | --- |
| Owner | Dueño del workspace. Se asigna al primer usuario que se registra | Todo: workspace, canales, equipo, contactos, conversaciones, configuración, eliminar workspace | — |
| Admin | Administrador con permisos amplios | Todo excepto eliminar el workspace | Eliminar workspace |
| Member | Operador del equipo (setter/closer) | Ver y responder **solo sus** conversaciones y gestionar **solo sus** contactos asignados (donde figura como setter, vendedor o agente), usar templates, importar CSV | Ver leads de otros, configurar canales, invitar o remover miembros, cambiar configuración del workspace, acceder a IA/Vault |

**Rol por defecto del primer usuario:** Owner, con el workspace creado automáticamente al registrarse.

**Invitaciones:** el Owner o Admin invita desde `/settings/team`. ZernFlow ya trae `workspace_invites` con expiración de 7 días. El invitado recibe un email por Resend con un link. Al aceptar se le asigna Member por defecto.

**Scope de leads (restricción dura por RLS):** un Member solo lee y edita los contactos y conversaciones donde es `setter_id`, `vendedor_id` o `assigned_to`. Se aplica en la base, no solo en la interfaz. Owner y Admin ven todo. Configurable por workspace: si un lead está sin asignar, el workspace decide si lo ven todos los Members o solo Owner y Admin (por defecto, solo Owner y Admin).

**Single-tenant:** el sistema opera con un solo workspace. La infraestructura de workspaces de ZernFlow se conserva intacta, así que la puerta a multi-negocio queda abierta sin costo, pero no se construye gestión multi-workspace.

**Nota para Etapa 2:** los roles se van a poder crear y personalizar con permisos granulares por módulo. `workspace_members.role` migrará a un modelo más flexible.

---

## 4. Alcance específico de esta fase

### 4.1. Fork y deploy de ZernFlow

- **Qué hace**: forkear el repositorio, ejecutar las 16 migraciones SQL en un proyecto de Supabase, desplegar en Railway y verificar que todo funcione.
- **Hasta dónde llega**: app corriendo en Railway con HTTPS, base de datos con las **24 tablas** existentes, autenticación funcional, pantallas cargando.
- **Qué NO hace**: no se modifican las pantallas existentes (eso es de los bloques siguientes). No hay optimizaciones de performance.

### 4.2. Supabase Vault y migración de claves en texto plano

- **Qué hace**: habilitar la extensión Vault para almacenar API keys con AES-256, crear las funciones helper, **y migrar las claves que el fork guarda en texto plano**.
- **Hasta dónde llega**: Vault funcional con `store_secret`, `read_secret` y `delete_secret`. Acceso restringido por RLS. Las columnas `workspaces.late_api_key_encrypted` y `workspaces.ai_api_key` vaciadas y eliminadas, con sus valores movidos a Vault y todas las lecturas del código apuntando a Vault.
- **Por qué es Fase 1 y no Fase 2**: la columna se llama `late_api_key_encrypted` pero el valor **no está encriptado**: el código la lee y la pasa directo al cliente de la API, sin desencriptar. Dejarla así mientras el sistema opera con datos reales es una exposición innecesaria.
- **Qué NO hace**: no hay rotación automática de keys (es manual desde la UI).

### 4.3. Roles, workspaces y scope de leads

- **Qué hace**: verificar que roles y workspaces de ZernFlow funcionan. **Agregar el scope duro de leads por RLS**: un Member solo ve y edita los contactos y conversaciones donde es setter, vendedor o agente asignado.
- **Hasta dónde llega**: roles funcionales, workspace creado al registrarse, invitaciones con expiración de 7 días, RLS de scope aplicada en `contacts` y `conversations`, **y respetada también por las suscripciones de Realtime**.
- **Qué NO hace**: no se crean roles custom configurables ni gestión multi-workspace.

### 4.4. Instagram vía Zernio

- **Qué hace**: verificar y asegurar que la integración existente con Zernio funciona: DMs, comentarios y story replies. Usa la 1ª de las 2 cuentas gratuitas de Zernio.
- **Hasta dónde llega**: mensajes entrantes y salientes funcionando, vinculados al contacto y la conversación correctos.
- **Qué NO hace**: no detecta nuevos seguidores (limitación de la API de Instagram). No implementa lógica proactiva de ventana más allá de mostrar el estado (ver 4.6c).

### 4.5. TikTok — fuera de la Etapa 1

- TikTok **no** se conecta como canal de bandeja. Zernio no entrega sus DMs ni comentarios por webhook, y la API de mensajes de TikTok, aunque existe, no permite que el negocio inicie conversaciones: no hay comment-to-DM ni secuencias posibles.
- **Dónde va**: Etapa 2, como canal de **publicación de contenido y métricas**.
- **Nota de cuentas de Zernio:** con WhatsApp ocupando la 2ª cuenta gratuita, **TikTok pasa a ser la 3ª cuenta, a $6/mes** desde la Etapa 2. Es un cambio respecto del BRD de clase, que reservaba la 2ª para TikTok.

### 4.6. WhatsApp por API oficial vía Zernio

- **Qué hace**: conectar WhatsApp usando la API oficial de Meta a través de Zernio, sobre un **número nuevo dedicado al negocio**. Usa la 2ª de las 2 cuentas gratuitas de Zernio.
- **Hasta dónde llega**: número dado de alta y verificado, mensajes entrantes recibidos por webhook, respuestas enviadas desde la bandeja dentro de la ventana de 24 horas, estado de conexión visible.
- **Qué NO hace**: no usa Baileys ni Evolution API. No implementa difusiones. No envía plantillas de forma automatizada (eso es Fase 2, con las secuencias); en Fase 1 solo se modelan y se sincroniza su estado.
- **Requisito del número, y es bloqueante si se hace mal**: [Cierta] el número debe poder recibir un SMS o llamada para la verificación, y **no debe tener ninguna cuenta de WhatsApp registrada**. Un número libre se registra directo; uno que ya tiene WhatsApp hay que darlo de baja primero. **No instalar WhatsApp ni WhatsApp Business en el número nuevo.**
- **Por qué no se usa el número existente del negocio**: conectarlo con coexistencia apagaría la ubicación en tiempo real en chats individuales, que la dueña usa como protocolo de seguridad personal. Ver el anexo de integración.

### 4.6b. Plantillas de WhatsApp (nuevo)

- **Qué hace**: modelar las plantillas de mensaje de Meta como entidad del sistema: alta, categoría, idioma, estado de aprobación, versión, motivo de rechazo y calificación de calidad.
- **Hasta dónde llega**: tabla `whatsapp_templates`, pantalla de gestión con listado y estado, sincronización del estado desde Zernio. Los pasos de secuencia de la Fase 2 **referencian una plantilla, nunca guardan el texto**.
- **Por qué se construye en Fase 1 aunque se use en Fase 2**: una plantilla tiene ciclo de vida propio, y Meta tarda de 24 a 48 horas en aprobar cada una. Si el modelo llega tarde, hay que rehacer el módulo de secuencias y además se pierde el tiempo de aprobación.
- **Qué NO hace**: no crea plantillas desde el sistema si Zernio no expone esa API (a confirmar). En ese caso la creación es manual desde Meta Business Manager y el sistema solo refleja el estado.

### 4.6c. Ventana de conversación (nuevo)

- **Qué hace**: calcular y mostrar si la ventana de mensajería de cada conversación está abierta, y cuánto le queda.
- **Hasta dónde llega**: campo derivado en la conversación, badge en la bandeja, y comportamiento del campo de respuesta según el estado.
- **Por qué es necesario en Fase 1**: sin esto, un operador escribe una respuesta, la envía, y falla sin entender por qué. Es el error más común al operar cualquier canal de Meta.

**Reglas por canal:**

| Canal | Ventana | Fuera de la ventana |
| --- | --- | --- |
| Instagram | 24 horas desde el último mensaje entrante | No se puede enviar. Excepción: respuesta privada a un comentario, hasta 7 días, una sola vez por comentario |
| WhatsApp | 24 horas desde el último mensaje entrante. 72 horas si el contacto llegó por un anuncio click-to-WhatsApp | Solo plantillas aprobadas, con costo |

### 4.7. Email saliente vía Resend

- **Qué hace**: conectar Resend para emails transaccionales (invitaciones, notificaciones) y, en Fase 2, marketing.
- **Hasta dónde llega**: API key en Vault, emails de invitación funcionales, infraestructura lista para Fase 2.
- **Qué NO hace**: no recibe emails (bidireccional es Etapa 2).

### 4.8. Pantalla de configuración de integraciones

- **Qué hace**: UI unificada en **`/settings/integrations`** para conectar canales, email y proveedores de IA (BYOK). Usa `integration_configs`.
- **Hasta dónde llega**: pantalla funcional con estado por integración, acciones de conectar y desconectar, sección de IA, y estructura extensible.
- **Qué NO hace**: no incluye test automático de conexión para todas las integraciones. No incluye YouTube ni LinkedIn (Etapa 2).

### 4.9. Modelo de contacto extendido

- **Qué hace**: extender `contacts` (que solo tiene `display_name`, `email`, `avatar_url`, `is_subscribed`, `metadata`) con teléfono, redes sociales, país, setter, vendedor, atribución, seguimiento, resumen de IA y flag de no contactar.
- **Qué NO hace**: no implementa merge automático de duplicados (solo detección y alerta).

### 4.10. Detección cross-canal

- **Qué hace**: al llegar un mensaje de un canal nuevo, detectar si el contacto ya existe (por teléfono, email o handle) y vincularlo. Cada conversación queda separada por canal.
- **Hasta dónde llega**: vinculación automática con match exacto de teléfono o email, sugerencia manual con match solo por username.
- **Qué NO hace**: no hace merge destructivo de dos contactos.

### 4.11. Soft delete

- **Qué hace**: borrado lógico con retención de 30 días para contactos, notas, conversaciones y templates. Purga por cron.
- **Qué NO hace**: no hay UI de papelera.

### 4.12. Filtros de inbox

- **Qué hace**: filtrar por tags, asignación, canal, fecha de último mensaje **y estado de ventana**.
- **Qué NO hace**: no hay filtros guardados ni vistas personalizadas.

### 4.13. Templates de respuesta rápida

- **Qué hace**: respuestas predefinidas con variables interpolables, para usar dentro de la ventana.
- **Nota:** son distintos de las plantillas de WhatsApp (4.6b). Los templates de respuesta son texto libre interno; las plantillas de WhatsApp son un recurso aprobado por Meta para escribir fuera de la ventana. **Nombrarlos distinto en la UI para que nadie los confunda.**

### 4.14. Marca "no contactar"

- **Qué hace**: detectar frases de opt-out y marcar al contacto. También marcado manual.
- **Hasta dónde llega**: detección automática, badge visible, pausa de secuencias activas, reversión por un admin.
- **Cambio respecto del BRD de clase**: al intentar enviar, **para texto libre dentro de la ventana muestra advertencia con confirmación; para plantillas de WhatsApp bloquea el envío**. Enviar plantillas a alguien que pidió no ser contactado es la vía rápida a que Meta baje la calificación de calidad del número y con ella el límite de mensajería.

### 4.15. Importación CSV

- **Qué hace**: importación masiva con mapeo de columnas, validación y deduplicación.
- **Qué NO hace**: no implementa exportación.

### 4.16. Audit log global

- **Qué hace**: registrar todo cambio significativo: entidad, campos, valores anterior y nuevo, autor, momento.
- **Qué NO hace**: no hay UI de exploración del audit log.

---

## 5. Funcionalidades y criterios de aceptación

### Bloque 1: Fork, deploy y foundation

#### F1: Fork y deploy de ZernFlow

**Descripción**: forkear el repositorio, configurar Railway y Supabase, ejecutar las 16 migraciones y verificar que la aplicación arranca.

**Criterios de aceptación**:

- [ ] Repositorio forkeado desde `https://github.com/zernio-dev/zernflow` y clonado
- [ ] Proyecto Railway creado con **un solo servicio**: la app Next.js
- [ ] Proyecto Supabase creado con plan Pro
- [ ] Las 16 migraciones ejecutadas sin errores, **24 tablas creadas**
- [ ] Variables de entorno configuradas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`
- [ ] **La versión de `@zernio/node` está fijada exacta** (no con `^`): una librería 0.x puede romper compatibilidad entre versiones menores
- [ ] La app carga y permite registrarse
- [ ] Al registrarse se crea un workspace con el usuario como Owner
- [ ] Las pantallas existentes cargan sin errores (dashboard, inbox, contacts, flows, sequences, settings)

#### F2: Supabase Vault y migración de claves

**Descripción**: habilitar Vault, crear las funciones helper, y mover a Vault las claves que hoy están en texto plano.

**Criterios de aceptación**:

- [ ] Extensión habilitada: `CREATE EXTENSION IF NOT EXISTS vault WITH SCHEMA vault`
- [ ] Funciones RPC creadas: `store_secret(secret_name, secret_value, workspace_id)`, `read_secret(secret_name, workspace_id)`, `delete_secret(secret_name, workspace_id)`
- [ ] Los secrets están aislados por `workspace_id`: un workspace no puede leer los de otro
- [ ] Solo Owner y Admin pueden crear, leer o eliminar secrets
- [ ] Un secret guardado se lee correctamente y devuelve el valor original; uno eliminado ya no es accesible
- [ ] Los secrets no aparecen en logs ni en respuestas de API, salvo la función de lectura explícita
- [ ] **Migración de las claves en texto plano**: los valores de `workspaces.late_api_key_encrypted` y `workspaces.ai_api_key` se copian a Vault
- [ ] **Todas las lecturas del código apuntan a Vault.** Verificar al menos: `lib/sequence-processor.ts`, `lib/flow-engine/nodes/ai-response.ts`, `lib/flow-engine/engine.ts`, `lib/comment-processor.ts`
- [ ] **Las columnas viejas se eliminan** de la tabla `workspaces` en la misma migración
- [ ] Prueba: consultar `select * from workspaces` no devuelve ninguna clave de API

#### F3: Roles, workspaces y scope de leads

**Descripción**: verificar el sistema de roles de ZernFlow y agregar el scope duro de leads por RLS.

**Criterios de aceptación de roles**:

- [ ] El primer usuario que se registra recibe el rol Owner automáticamente
- [ ] Owner puede invitar desde `/settings/team`; las invitaciones expiran en 7 días
- [ ] Un usuario invitado se registra con el rol Member por defecto
- [ ] Owner y Admin pueden cambiar el rol de un miembro
- [ ] Solo Owner puede remover miembros
- [ ] Member no puede acceder a Settings del workspace, canales, equipo ni Vault
- [ ] Los datos de un workspace son invisibles para miembros de otros workspaces

**Criterios de aceptación de scope de leads** (nuevos, no estaban en el BRD de clase):

- [ ] Existe una función helper `can_see_contact(contact_row)` usada en las policies de SELECT, UPDATE y DELETE de `contacts`
- [ ] Un Member solo lee contactos donde `setter_id = auth.uid()` o `vendedor_id = auth.uid()`
- [ ] Los contactos sin asignar se rigen por una configuración del workspace (por defecto: solo Owner y Admin)
- [ ] La misma lógica aplica a `conversations`, por `assigned_to` y por el contacto asociado
- [ ] **Prueba por API, no solo por UI**: con el token de un Member, un `GET` directo a Supabase de un contacto ajeno devuelve vacío, no el registro
- [ ] **Prueba de Realtime**: un Member suscrito a `conversations` y `messages` **no recibe eventos** de conversaciones que no le corresponden. Si Realtime no respeta la policy, se filtra del lado del servidor antes de emitir
- [ ] Al reasignar un lead, cambia inmediatamente quién puede verlo
- [ ] Si a un Member le quitan un lead que tenía abierto en pantalla, la vista muestra un mensaje claro, no un error crudo de permisos

#### F4: Instagram vía Zernio

**Descripción**: verificar que la integración con Zernio funciona para Instagram: DMs, comentarios y story replies.

**Criterios de aceptación**:

- [ ] Se puede conectar una cuenta de Instagram desde la UI con la API key de Zernio
- [ ] Los DMs entrantes llegan en tiempo real por webhook
- [ ] Los comentarios se reciben y se pueden responder
- [ ] Las story replies llegan a la bandeja
- [ ] Los mensajes se vinculan al contacto correcto por username de Instagram
- [ ] Se pueden enviar respuestas desde la bandeja
- [ ] El estado de la conexión es visible en `/settings/integrations`
- [ ] Los mensajes se almacenan en `messages` con la referencia correcta a conversación y canal

#### F5: TikTok — eliminado de la Fase 1

TikTok no se conecta como canal de bandeja. Zernio no entrega sus DMs ni comentarios por webhook, y la API de mensajes de TikTok no permite que el negocio inicie conversaciones. No hay criterios de aceptación de TikTok en esta fase. Entra en Etapa 2 como canal de publicación, usando la **3ª cuenta de Zernio ($6/mes)**, porque la 2ª la ocupa WhatsApp.

#### F6: WhatsApp por API oficial vía Zernio

**Descripción**: conectar WhatsApp por la API oficial de Meta a través de Zernio, sobre el número dedicado.

**Criterios de aceptación de construcción** (no dependen del número, se pueden cumplir ya):

- [ ] El adaptador de WhatsApp usa el mismo contrato de canal que Instagram, sin condicionales por plataforma en el camino de entrada
- [ ] La plataforma `whatsapp` ya está habilitada en el CHECK constraint de `channels` desde la migración 16: **no hace falta migración nueva para esto**
- [ ] `integration_configs` soporta un registro `type='channel', provider='whatsapp_zernio'`
- [ ] El webhook entrante de Zernio procesa mensajes de WhatsApp con la misma ruta que los de Instagram
- [ ] La idempotencia por `webhook_events` funciona igual para los dos canales

**Criterios de aceptación de conexión** (se verifican el día que llegue el número):

- [ ] El número no tiene ninguna cuenta de WhatsApp registrada antes del alta
- [ ] El número está dado de alta en la cuenta de WhatsApp Business (WABA) y la propiedad está verificada
- [ ] El PIN de verificación en dos pasos de 6 dígitos está configurado y guardado en un lugar seguro
- [ ] El nombre para mostrar está aprobado por Meta
- [ ] Desde la UI se puede conectar el canal con la API key de Zernio
- [ ] Los mensajes entrantes se reciben por webhook y se almacenan en `messages`
- [ ] Se pueden enviar respuestas de texto libre desde la bandeja **cuando la ventana está abierta**
- [ ] El contacto se busca y se vincula por teléfono normalizado a E.164
- [ ] El estado de la conexión es visible en `/settings/integrations`

**Lo que ya no aplica** (era propio de Baileys): flujo de QR, servicio de Evolution API en Railway, detección de desconexión con reconexión manual, pérdida de mensajes durante una caída. Con API oficial no hay sesión que se caiga.

#### F6b: Plantillas de WhatsApp

**Descripción**: modelar las plantillas de Meta como entidad, con su ciclo de vida.

**Criterios de aceptación**:

- [ ] Nueva tabla `whatsapp_templates` (ver 7.3)
- [ ] Pantalla de gestión en `/settings/whatsapp-templates` con listado, estado y categoría
- [ ] El estado de cada plantilla se sincroniza desde Zernio: borrador, enviada, aprobada, rechazada, pausada
- [ ] Cuando Meta rechaza una plantilla, el motivo queda visible en el sistema
- [ ] La calificación de calidad de la plantilla, cuando Zernio la expone, se muestra en el listado
- [ ] Editar una plantilla aprobada crea una versión nueva que vuelve a estado "enviada"
- [ ] **El modelo está listo para que un paso de secuencia referencie una plantilla por ID**, aunque las secuencias se construyan en Fase 2
- [ ] La categoría (marketing, utility, authentication) es obligatoria y visible, porque determina el costo

*Si Zernio no expone la gestión de plantillas por API (pendiente de confirmar), la creación se hace desde Meta Business Manager y el sistema solo refleja el estado. Los criterios de sincronización se mantienen; los de creación se pasan a Fase 2.*

#### F6c: Ventana de conversación

**Descripción**: calcular, mostrar y respetar la ventana de mensajería de cada conversación.

**Criterios de aceptación**:

- [ ] Campos `window_expires_at` y `window_source` agregados a `conversations` (ver 7.2)
- [ ] `window_expires_at` se recalcula con cada mensaje entrante: 24 horas desde el mensaje, o 72 si `window_source = 'ctwa'` (click-to-WhatsApp)
- [ ] En la bandeja, cada conversación muestra un indicador del estado de la ventana: abierta con tiempo restante, o cerrada
- [ ] Con la ventana **abierta**, el campo de respuesta acepta texto libre normalmente
- [ ] Con la ventana **cerrada en WhatsApp**, el campo de texto libre se deshabilita y se ofrece un selector de plantillas aprobadas, indicando el costo estimado
- [ ] Con la ventana **cerrada en Instagram**, el campo se deshabilita y se explica por qué, sin ofrecer alternativa
- [ ] Un mensaje que falla por ventana expirada muestra un error claro en la interfaz, no un error genérico
- [ ] La respuesta privada a un comentario de Instagram se permite hasta 7 días desde el comentario, una sola vez por comentario, y el sistema lo controla con `comment_logs`

### Bloque 2: Email, configuración de integraciones y BYOK IA

#### F7: Email saliente vía Resend

**Criterios de aceptación**:

- [ ] La API key de Resend se guarda en Vault desde `/settings/integrations`
- [ ] Se envían emails transaccionales: invitaciones de equipo y notificaciones del sistema
- [ ] El remitente es el dominio verificado por el usuario en Resend
- [ ] Si falla el envío, se registra el error y se reintenta hasta 3 veces
- [ ] Los emails enviados quedan registrados para referencia
- [ ] La infraestructura queda lista para que Fase 2 la use en secuencias

#### F8: Pantalla de configuración de integraciones y BYOK IA

**Descripción**: UI unificada en **`/settings/integrations`**.

**Criterios de aceptación**:

- [ ] Pantalla accesible desde el sidebar, solo para Owner y Admin
- [ ] Sección "Canales de mensajería":
    - Instagram (Zernio): API key, estado, conectar y desconectar
    - **WhatsApp (Zernio, API oficial): API key, número conectado, estado, nombre para mostrar y su estado de aprobación**
    - Facebook (Zernio, opcional): API key, nota "$6/mes extra"
    - X/Twitter (Zernio, opcional): API key, nota "$6/mes extra"
    - *(TikTok, YouTube y LinkedIn se agregan en Etapa 2; la estructura es extensible)*
- [ ] Sección "Email": Resend con API key, dominio verificado y estado
- [ ] Sección "Proveedores de IA (BYOK)": OpenAI, Anthropic y Google, cada uno con API key y modelo por defecto
- [ ] Todas las API keys se guardan en Supabase Vault, nunca en texto plano
- [ ] Al guardar una key se valida el formato: longitud mínima y prefijo esperado donde aplique
- [ ] Cada integración es un registro en `integration_configs` con su `type`
- [ ] El estado de cada integración se actualiza en tiempo real
- [ ] Agregar una integración nueva en Etapa 2 no requiere cambios en la tabla, solo un registro

### Bloque 3: Modelo de contacto y CRM

#### F9: Modelo de contacto extendido

**Criterios de aceptación**:

- [ ] Migración que agrega a `contacts`: `phone`, `secondary_email`, `country`, `instagram_username`, `tiktok_username`, **`youtube_channel_id`**, **`linkedin_profile_url`**, `whatsapp_phone`, `twitter_username`, `facebook_id`, `setter_id`, `vendedor_id`, `next_followup_date`, `do_not_contact`, `do_not_contact_reason`, `do_not_contact_at`, `ai_conversation_summary`, `lead_temperature`, `attribution`, `deleted_at`
- [ ] **El teléfono se normaliza a E.164 antes de guardarse**, en el servidor, no solo en el formulario. Sin esto, la deduplicación entre WhatsApp e Instagram falla y arreglarlo después implica migrar datos sucios
- [ ] Índices en: `phone`, `email`, `instagram_username`, `whatsapp_phone`, `setter_id`, `vendedor_id`, `deleted_at`
- [ ] Índice compuesto en `(workspace_id, phone)` y `(workspace_id, email)` para que la deduplicación sea eficiente
- [ ] RLS actualizada con la lógica de scope de leads de F3
- [ ] Los custom fields existentes (6 tipos: text, number, boolean, date, url, email) se conservan sin modificar

#### F10: Datos de atribución

**Criterios de aceptación**:

- [ ] Campo `attribution` (jsonb, default `'{}'`) en `contacts` con estructura de `first_click` y `last_click`
- [ ] `first_click` se escribe una sola vez y no se modifica
- [ ] `last_click` se actualiza en cada nueva interacción con parámetros de tracking
- [ ] **Para contactos que llegan por click-to-WhatsApp, se registra el origen y se marca `conversations.window_source = 'ctwa'`**, que es lo que habilita la ventana de 72 horas
- [ ] No requiere RLS adicional: hereda la política de `contacts`

#### F11: Asignación setter y vendedor

**Criterios de aceptación**:

- [ ] `setter_id` y `vendedor_id` aparecen en la ficha del contacto
- [ ] Se asignan desde un dropdown con los miembros del workspace
- [ ] Ambos son opcionales e independientes
- [ ] Los cambios quedan en el audit log
- [ ] Se puede filtrar la lista de contactos por cada uno
- [ ] **Cambiar una asignación cambia el scope de visibilidad de inmediato** (consecuencia de F3)

#### F12: Detección cross-canal

**Criterios de aceptación**:

- [ ] Al recibir un mensaje de un canal nuevo, el sistema busca contacto por teléfono normalizado, email o username de red social
- [ ] Con match exacto de teléfono o email, se vincula automáticamente al contacto existente
- [ ] Se crea una entrada en `contact_channels` vinculando el canal nuevo
- [ ] La conversación del canal nuevo se crea separada, no se mezcla con las de otros canales
- [ ] Con match solo por username, se sugiere la vinculación al operador en vez de hacerla automática
- [ ] La ficha del contacto muestra todas las conversaciones agrupadas por canal, **cada una con su propio estado de ventana**
- [ ] El audit log registra las vinculaciones automáticas y manuales

#### F13: Notas en el contacto

**Criterios de aceptación**:

- [ ] Nueva tabla `contact_notes` (ver 7.3)
- [ ] Sección "Notas" en la ficha del contacto, con lista cronológica
- [ ] Cualquier miembro con acceso al contacto puede crear notas
- [ ] Solo el autor, un Admin o el Owner puede editar o eliminar una nota
- [ ] RLS: hereda el scope del contacto asociado

#### F14: Ficha de contacto completa

**Criterios de aceptación**:

- [ ] Muestra todos los datos: nombre, email, teléfono, redes, país, setter, vendedor, temperatura, fecha de seguimiento
- [ ] Sección "Conversaciones": lista por canal con preview y **estado de ventana**
- [ ] Sección "Notas", "Tags", "Custom Fields", "Historial de cambios" y "Atribución"
- [ ] Badge visible si el contacto está marcado como "no contactar"
- [ ] Botón para editar todos los datos
- [ ] Clic en una conversación navega al hilo en la bandeja

#### F15: Soft delete

**Criterios de aceptación**:

- [ ] Campo `deleted_at` en `contacts`, `contact_notes`, `conversations`, `response_templates`
- [ ] Eliminar setea `deleted_at = now()` en vez de hacer DELETE
- [ ] Las queries de listado filtran `WHERE deleted_at IS NULL`
- [ ] Las RLS excluyen registros con `deleted_at IS NOT NULL`
- [ ] Cron diario en `/api/cron/purge-deleted` elimina permanentemente lo que tenga más de 30 días
- [ ] La purga elimina en cascada notas, conversaciones y mensajes del contacto
- [ ] **El `audit_log` no se purga**: sus registros sobreviven al contacto eliminado

### Bloque 4: Bandeja, filtros, herramientas CRM y ventana

#### F16: Filtros de inbox

**Criterios de aceptación**:

- [ ] Filtro por tags: multi-select
- [ ] Filtro por asignación: "Todas", "Sin asignar", "Agente IA", y miembros del equipo
- [ ] Filtro por canal: multi-select de canales activos (Instagram, WhatsApp)
- [ ] Filtro por fecha de último mensaje: presets y rango personalizado
- [ ] **Filtro por estado de ventana: abierta, cerrada, o por vencer en menos de 2 horas**
- [ ] Los filtros son combinables (AND entre categorías)
- [ ] Los filtros se reflejan en la URL para poder compartirlos
- [ ] Badge con la cantidad de filtros activos, y botón "Limpiar filtros"

#### F17: Templates de respuesta rápida

**Criterios de aceptación**:

- [ ] Nueva tabla `response_templates` (ver 7.3)
- [ ] Pantalla de gestión en `/settings/response-templates` con CRUD completo
- [ ] En la bandeja, al escribir "/" aparece el selector de templates
- [ ] Búsqueda por nombre o atajo
- [ ] Al seleccionar, se inserta el contenido con las variables interpoladas: `{{contact.display_name}}`, `{{contact.email}}`, `{{contact.phone}}`, `{{workspace.name}}`
- [ ] Si una variable no tiene valor, se deja vacía
- [ ] **En la UI se llaman "respuestas rápidas", nunca "plantillas"**, para no confundirlas con las plantillas de WhatsApp
- [ ] RLS: scoped por workspace

#### F18: Marca "no contactar"

**Criterios de aceptación**:

- [ ] Lista de frases de opt-out configurable por workspace: "no me escribas más", "dejá de mandar mensajes", "no quiero recibir mensajes", "stop", "unsubscribe", "basta", "no me contactes"
- [ ] Al detectar una frase en un mensaje entrante: se marca `do_not_contact = true`, se registra razón y fecha, se pausan todas las secuencias activas del contacto y se registra en el audit log
- [ ] Badge rojo "No contactar" visible en la bandeja y en la ficha
- [ ] Un Admin u Owner puede revertir la marca, con registro en el audit log
- [ ] **Al enviar texto libre dentro de la ventana a un contacto marcado: advertencia con confirmación**
- [ ] **Al enviar una plantilla de WhatsApp a un contacto marcado: se bloquea el envío, sin opción de forzar.** Enviar plantillas a quien pidió no ser contactado degrada la calificación de calidad del número y baja el límite de mensajería de todo el negocio
- [ ] La misma regla aplica al motor de secuencias en Fase 2: un contacto marcado nunca entra a una secuencia

#### F19: Importación CSV

**Criterios de aceptación**:

- [ ] Botón "Importar CSV" en `/contacts`
- [ ] Archivo de hasta 10MB y 10.000 filas
- [ ] Preview con las primeras 5 filas y mapeo de columnas sugerido
- [ ] El usuario ajusta el mapeo, incluyendo setter, vendedor, tags y custom fields
- [ ] Validación: email con formato válido, teléfono normalizado a E.164, al menos uno de los dos presente
- [ ] Deduplicación por email o teléfono: si existe, actualiza los campos no vacíos en vez de duplicar
- [ ] **Importaciones de más de 500 filas se encolan como trabajo en `scheduled_jobs`**, no corren en el request. El usuario recibe una notificación al terminar
- [ ] Barra de progreso y resumen final: importados, actualizados, errores con detalle
- [ ] Todo queda en el audit log y en `csv_imports`

#### F20: Audit log global

**Criterios de aceptación**:

- [ ] Nueva tabla `audit_log` (ver 7.3)
- [ ] Índices en `workspace_id`, `(entity_type, entity_id)` y `performed_at`
- [ ] Generan entrada: contacto creado, editado, eliminado, restaurado, asignado, marcado como no contactar; canal conectado, desconectado o con error; cambios de configuración; importaciones CSV; equipo (invitado, rol cambiado, removido); **plantilla de WhatsApp enviada a aprobación, aprobada o rechazada**
- [ ] RLS: solo miembros del workspace leen. Owner y Admin ven todo; un Member solo sus propias acciones
- [ ] El audit log nunca se elimina ni tiene soft delete

---

## 6. Flujos principales

### Flujo 1: Primer setup del sistema

1. El usuario entra a la app y se registra con email y contraseña (Supabase Auth).
2. El trigger `on_auth_user_created` crea el workspace con el usuario como Owner.
3. Llega al dashboard vacío con un wizard de onboarding.
4. El wizard lo lleva paso a paso:
   a. Nombre del negocio y datos del workspace.
   b. Conectar Instagram (API key de Zernio).
   c. **Conectar WhatsApp (API key de Zernio y número dado de alta).** Si el número todavía no está disponible, se puede saltar y conectar después.
   d. Configurar email saliente (API key de Resend).
   e. Configurar proveedores de IA (opcional, se puede hacer después).
5. Al completar el wizard, el sistema está listo para recibir mensajes.

**Resultado exitoso**: workspace creado, al menos un canal conectado, usuario en el dashboard.
**Casos de error**: si falla la creación del workspace, mostrar error y permitir reintentar. Si falla la conexión de un canal, permitir saltar y conectar después desde Settings.

### Flujo 2: Mensaje entrante de Instagram

1. El lead envía un DM.
2. Zernio lo entrega al sistema por webhook.
3. El sistema valida la firma HMAC del webhook.
4. Verifica idempotencia en `webhook_events`.
5. Busca contacto por `instagram_username`.
6. Si no existe: crea contacto, entrada en `contact_channels` y conversación nueva.
7. Si existe: vincula y busca la conversación activa de Instagram, o crea una.
8. Almacena el mensaje en `messages`.
9. **Recalcula `window_expires_at` de la conversación: 24 horas desde ahora.**
10. Actualiza `last_message_at`, `last_message_preview` y `unread_count` de la conversación, y `last_interaction_at` del contacto.
11. En Fase 2 se evalúan triggers de flows. En Fase 3 responde el agente si está activo.
12. El operador ve la conversación en la bandeja, con la ventana abierta.

**Casos de error**: webhook duplicado, se ignora por idempotencia. Falla de la API de Zernio, se registra y se reintenta.

### Flujo 3: Mensaje entrante de WhatsApp

1. El lead envía un mensaje al número del negocio.
2. **Zernio lo entrega al sistema por webhook**, igual que Instagram.
3. Validación de firma HMAC y verificación de idempotencia.
4. Busca contacto por teléfono normalizado a E.164 (`whatsapp_phone` o `phone`).
5. Si no existe: crea contacto con `display_name` (nombre de perfil de WhatsApp), `whatsapp_phone` y `phone`.
6. Si existe y ya tiene conversaciones por otro canal, se vincula al mismo contacto con conversación separada de WhatsApp.
7. Almacena el mensaje y actualiza conversación y contacto.
8. **Recalcula `window_expires_at`: 24 horas, o 72 si `window_source = 'ctwa'`.**
9. El operador ve la conversación con el tiempo restante de ventana.

**Casos de error**: webhook duplicado, se ignora. **Ya no existe el caso "WhatsApp desconectado con pérdida de mensajes"**: con API oficial no hay sesión que se caiga, y Meta reintenta la entrega del webhook.

### Flujo 4: Respuesta con la ventana cerrada (nuevo)

1. El operador abre una conversación de WhatsApp cuya ventana venció.
2. El campo de texto libre aparece deshabilitado, con la explicación: "La ventana de 24 horas se cerró. Solo se pueden enviar plantillas aprobadas".
3. Se ofrece un selector con las plantillas **aprobadas** para ese idioma, con la categoría y el costo estimado de cada una.
4. El operador elige una y completa las variables.
5. Si el contacto está marcado como "no contactar", **el envío se bloquea** y se explica por qué.
6. Se envía la plantilla por Zernio y se registra en `messages` con referencia a la plantilla usada.
7. Cuando el contacto responde, se abre una ventana nueva de 24 horas y el campo de texto libre se habilita.

**Casos de error**: si no hay ninguna plantilla aprobada, se indica y se enlaza a `/settings/whatsapp-templates`. Si Meta rechaza el envío, se muestra el motivo devuelto.

### Flujo 5: Detección cross-canal

1. El lead ya tiene contacto creado por su DM de Instagram.
2. Escribe por WhatsApp con un número no registrado.
3. El sistema crea el mensaje y la conversación de WhatsApp.
4. Al no encontrar match por teléfono, crea un contacto nuevo.
5. Si más adelante alguien agrega el teléfono al contacto de Instagram, el sistema detecta dos contactos con el mismo dato y sugiere vincularlos.
6. Si se acepta, se mueve `contact_channels` del duplicado al contacto principal. Las conversaciones quedan separadas por canal, **cada una con su ventana independiente**.
7. La detección automática funciona al crear el contacto: si el teléfono o email ya existe en el workspace, se vincula en vez de duplicar.

### Flujo 6: Importación CSV de contactos

1. El usuario va a `/contacts` y hace clic en "Importar CSV".
2. Sube el archivo; el sistema parsea y muestra preview de 5 filas.
3. Muestra el mapeo sugerido, detectando columnas por nombre.
4. El usuario ajusta el mapeo y puede asignar setter, vendedor y tags para todos.
5. Hace clic en "Importar".
6. **Con más de 500 filas, el trabajo se encola y el usuario recibe una notificación al terminar.** Con menos, se procesa en línea con barra de progreso.
7. Por cada fila: valida, normaliza el teléfono, busca duplicado por email o teléfono, actualiza o crea.
8. Resumen final con contadores y detalle de errores.

### Flujo 7: Operador gestiona la bandeja

1. Entra a `/inbox` y ve las conversaciones ordenadas por `last_message_at`, **limitadas por su scope**.
2. Filtra por tag, asignación, canal, fecha **o estado de ventana**.
3. Selecciona una conversación y ve el hilo, con burbujas diferenciadas (lead, operador, bot).
4. En el panel lateral: datos del contacto, tags, notas, campos custom, asignaciones.
5. **Un indicador muestra el estado de la ventana de esa conversación.**
6. Responde con texto libre (ventana abierta) o con una plantilla (ventana cerrada en WhatsApp).
7. Puede usar "/" para insertar una respuesta rápida.
8. Al responder, se asigna automáticamente a la conversación.
9. Puede agregar notas, cambiar tags, editar campos y asignar setter o vendedor.
10. Todos los cambios quedan en el audit log.

**Casos de error**: si el envío falla, error visible con opción de reintentar. Si el canal está desconectado, mensaje claro indicando reconectar.

---

## 7. Modelo de datos

### 7.1 Tablas existentes de ZernFlow (se conservan)

**Son 24 tablas en 16 archivos de migración.** (El BRD de clase decía 23, pero su propia tabla listaba 24.)

| Tabla | Notas |
| --- | --- |
| `workspaces` | **Se modifica**: se eliminan `late_api_key_encrypted` y `ai_api_key` tras migrar los valores a Vault |
| `workspace_members` | Se conserva. Roles: owner, admin, member |
| `channels` | Etapa 1 usa `'instagram'` y `'whatsapp'`, ambos ya en el constraint tras la migración 16. **No requiere migración nueva** |
| `contacts` | **Se extiende** (ver 7.2) |
| `contact_channels` | Se conserva |
| `tags`, `contact_tags` | Se conservan |
| `custom_field_definitions`, `contact_custom_fields` | Se conservan. 6 tipos reales: text, number, boolean, date, url, email |
| `flows`, `triggers`, `flow_sessions`, `flow_versions` | Se conservan |
| `conversations` | **Se extiende** con los campos de ventana (ver 7.2) |
| `messages` | **Se extiende** con la referencia a plantilla (ver 7.2) |
| `broadcasts`, `broadcast_recipients` | Se conservan, no se usan en Etapa 1 |
| `scheduled_jobs` | Se conserva. Se usa para importaciones grandes y la purga |
| `analytics_events` | Se conserva |
| `comment_logs` | Se conserva. Controla la regla de una respuesta privada por comentario |
| `sequences`, `sequence_enrollments` | Se conservan, se extienden en Fase 2 |
| `workspace_invites` | Se conserva |
| `webhook_events` | Se conserva. Ledger de idempotencia |

### 7.2 Extensiones a tablas existentes

**`contacts` — campos nuevos:**

| Campo | Tipo | Descripción |
| --- | --- | --- |
| phone | text | Teléfono principal, **normalizado a E.164** |
| secondary_email | text | Email secundario |
| country | text | País del contacto |
| instagram_username | text | @ de Instagram, sin @ |
| tiktok_username | text | @ de TikTok, sin @ |
| **youtube_channel_id** | text | ID del canal de YouTube (preparado para Etapa 2) |
| **linkedin_profile_url** | text | URL del perfil (preparado para Etapa 2) |
| whatsapp_phone | text | Teléfono de WhatsApp, puede diferir del principal |
| twitter_username | text | @ de X/Twitter |
| facebook_id | text | ID de Facebook |
| setter_id | uuid | FK → auth.users |
| vendedor_id | uuid | FK → auth.users |
| next_followup_date | timestamptz | Próximo seguimiento |
| do_not_contact | boolean | Default false |
| do_not_contact_reason | text | Razón del marcado |
| do_not_contact_at | timestamptz | Cuándo se marcó |
| ai_conversation_summary | text | Resumen acumulativo del agente (Fase 3) |
| lead_temperature | text | CHECK ('cold','warm','hot') |
| attribution | jsonb | Default `'{}'`. first_click y last_click |
| deleted_at | timestamptz | Soft delete |

**`conversations` — campos nuevos (sección nueva):**

| Campo | Tipo | Descripción |
| --- | --- | --- |
| window_expires_at | timestamptz | Cuándo se cierra la ventana de mensajería. Se recalcula con cada mensaje entrante |
| window_source | text | CHECK ('standard','ctwa'). `'ctwa'` cuando el contacto llegó por un anuncio click-to-WhatsApp, que da 72 horas en vez de 24 |

**`messages` — campo nuevo:**

| Campo | Tipo | Descripción |
| --- | --- | --- |
| whatsapp_template_id | uuid | FK → whatsapp_templates, nullable. Se completa cuando el mensaje se envió como plantilla fuera de la ventana |

**Estructura del campo `attribution`:**

```json
{
  "first_click": {
    "utm_source": "instagram", "utm_medium": "organic", "utm_campaign": "",
    "utm_term": null, "utm_content": null,
    "fbclid": "", "gclid": null,
    "ad_id": "", "campaign_id": "", "adset_id": "",
    "referrer_url": "", "landing_page": "", "captured_at": "2026-01-15T10:30:00Z"
  },
  "last_click": { "utm_source": "facebook", "utm_medium": "cpc", "captured_at": "2026-02-20T14:00:00Z" }
}
```

- `first_click` se escribe una sola vez; `last_click` se sobrescribe con cada interacción atribuible.

### 7.3 Tablas nuevas

**`whatsapp_templates`** (nueva respecto del BRD de clase)

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| id | uuid | Sí (PK) | — |
| workspace_id | uuid | Sí | FK → workspaces |
| internal_name | text | Sí | Cómo la llama el equipo |
| meta_name | text | Sí | Identificador con el que se envía a Meta |
| category | text | Sí | CHECK ('marketing','utility','authentication'). Determina el costo |
| language | text | Sí | Código de idioma (es, es_AR, en) |
| body | text | Sí | Cuerpo con variables `{{1}}`, `{{2}}` |
| variables | jsonb | No | Mapeo de cada variable a un campo del contacto |
| status | text | Sí | CHECK ('draft','submitted','approved','rejected','paused') |
| rejection_reason | text | No | Motivo devuelto por Meta |
| quality_rating | text | No | Calificación de calidad, cuando Zernio la expone |
| version | integer | Sí (default 1) | Editar una aprobada crea versión nueva |
| submitted_at | timestamptz | No | — |
| approved_at | timestamptz | No | — |
| created_by | uuid | Sí | FK → auth.users |
| created_at / updated_at | timestamptz | Sí | — |

**`contact_notes`**

| Campo | Tipo | Requerido |
| --- | --- | --- |
| id | uuid | Sí (PK) |
| contact_id | uuid | Sí (FK → contacts) |
| workspace_id | uuid | Sí (FK → workspaces) |
| content | text | Sí |
| created_by | uuid | Sí (FK → auth.users) |
| created_at / updated_at | timestamptz | Sí |
| deleted_at | timestamptz | No |

**`response_templates`**

| Campo | Tipo | Requerido |
| --- | --- | --- |
| id | uuid | Sí (PK) |
| workspace_id | uuid | Sí (FK → workspaces) |
| name | text | Sí |
| content | text | Sí |
| shortcut | text | No |
| created_by | uuid | Sí (FK → auth.users) |
| created_at / updated_at | timestamptz | Sí |
| deleted_at | timestamptz | No |

**`csv_imports`**

| Campo | Tipo | Requerido |
| --- | --- | --- |
| id | uuid | Sí (PK) |
| workspace_id | uuid | Sí (FK → workspaces) |
| file_name | text | Sí |
| total_rows / imported / updated / errors | integer | Sí |
| error_details | jsonb | No |
| status | text | Sí. CHECK ('queued','processing','completed','failed') |
| imported_by | uuid | Sí (FK → auth.users) |
| created_at | timestamptz | Sí |

**`audit_log`**

| Campo | Tipo | Requerido |
| --- | --- | --- |
| id | uuid | Sí (PK) |
| workspace_id | uuid | Sí (FK → workspaces) |
| entity_type | text | Sí |
| entity_id | uuid | Sí |
| action | text | Sí |
| changes | jsonb | No. `{ field: { old, new } }` |
| metadata | jsonb | No |
| performed_by | uuid | No (null = sistema) |
| performed_at | timestamptz | Sí (default now()) |

**`integration_configs`**

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| id | uuid | Sí (PK) | — |
| workspace_id | uuid | Sí | FK → workspaces |
| type | text | Sí | CHECK ('channel','ai_provider','email_provider') |
| provider | text | Sí | `'instagram_zernio'`, **`'whatsapp_zernio'`**, `'resend'`, `'openai'`, `'anthropic'`, `'google_ai'`. En Etapa 2: `'tiktok_zernio'`, `'youtube_api'`, `'linkedin_api'` |
| display_name | text | No | Nombre en la UI |
| vault_secret_name | text | No | Nombre del secret en Vault |
| oauth_data | jsonb | No | Datos de OAuth cuando aplique |
| config | jsonb | No | Configuración específica del proveedor |
| is_active | boolean | Sí (default false) | — |
| connected_at | timestamptz | No | — |
| last_error | text | No | — |
| created_at / updated_at | timestamptz | Sí | — |

### 7.4 Notas de optimización

- **Sin tabla de roles separada**: los roles se manejan en `workspace_members.role`. En Etapa 2 se migra a un modelo con tabla propia para soportar roles custom.
- **`workspace_id` desnormalizado en `contact_notes`**: simplifica las RLS y evita JOINs.
- **`attribution` como JSONB**: relación 1:1 con el contacto; evita una tabla extra y permite agregar campos sin migraciones.
- **`ai_conversation_summary` desde ahora**: se usa en Fase 3, pero agregarlo ahora evita una migración futura.
- **`integration_configs` genérica**: una sola tabla para canales, IA y email, diferenciados por `type`.
- **Ventana como campo derivado en `conversations`**: se podría calcular en cada consulta a partir del último mensaje entrante, pero guardarla permite indexar y filtrar la bandeja por estado de ventana sin recorrer `messages`.

### 7.5 Políticas de datos

**Soft delete:** `contacts`, `contact_notes`, `conversations`, `response_templates`. Retención 30 días, purga por cron diario.

**Auditoría:** `created_at` y `updated_at` en todas las tablas principales (triggers existentes). Los cambios significativos van al `audit_log`, que nunca se elimina.

**Snapshots:** no aplica en esta fase. En Etapa 4 los precios se guardan al momento de la transacción.

---

## 8. Arquitectura del sistema

### Frontend

- **Next.js 16** con React 19 y App Router
- **Tailwind CSS v4** (el fork ya usa v4)
- **@xyflow/react** para el flow builder
- **Supabase SSR** para autenticación del lado del servidor
- Server Components por defecto, Client Components donde haga falta interactividad

### Backend

- **Next.js API Routes** para webhooks y endpoints REST
- **Server Actions** para mutaciones desde componentes
- **Supabase JS Client** con RLS
- **Service Role Key** solo en servidor, para cron jobs y webhooks

### Base de datos

- **Supabase (PostgreSQL)**, plan Pro
- **RLS** habilitado en todas las tablas, con políticas por workspace **y scope de leads**
- **Supabase Vault** para secrets con AES-256
- **Realtime** en `conversations` y `messages`, **respetando el scope de leads**

### Integraciones externas

| Servicio | Protocolo | Uso |
| --- | --- | --- |
| Zernio | Webhooks entrantes con firma HMAC + API REST | **Instagram** (1ª cuenta free) y **WhatsApp por API oficial** (2ª cuenta free) |
| Resend | API REST | Emails transaccionales |
| *(Etapa 2)* Zernio | API REST | TikTok para publicación, 3ª cuenta ($6/mes) |
| *(Etapa 2)* Google Cloud / YouTube | OAuth 2.0 + REST | Comentarios y metadata |
| *(Etapa 2)* LinkedIn | OAuth 2.0 + REST | Publicación en perfil |

### Autenticación

- **Supabase Auth** con email y contraseña
- Trigger `on_auth_user_created` crea el workspace automáticamente
- Sesiones con Supabase SSR y cookies httpOnly

### Hosting

```
┌──────────── Railway (un proyecto, un servicio) ────────────┐
│                                                             │
│   ┌──────────────────────────────────┐                      │
│   │  App Next.js (fork de ZernFlow)  │                      │
│   │  Puerto público HTTPS            │                      │
│   └──────────────┬───────────────────┘                      │
│                  │                                          │
└──────────────────┼──────────────────────────────────────────┘
                   │ HTTPS
        ┌──────────┴───────────┐
        ▼                      ▼
┌──────────────────┐   ┌──────────────────────┐
│  Supabase        │   │  Zernio (SaaS)       │
│  - PostgreSQL    │   │  - Instagram         │
│  - Auth          │   │  - WhatsApp oficial  │
│  - Vault         │   │  - Webhooks firmados │
│  - Realtime      │   └──────────────────────┘
│  - Storage       │
└──────────────────┘
```

**Cambio respecto del BRD de clase:** desaparece el segundo servicio de Railway (Evolution API) y con él la red privada interna. La Etapa 1 corre con **un solo servicio**.

---

## 9. Stack y decisiones técnicas

| Componente | Tecnología | Versión | Justificación |
| --- | --- | --- | --- |
| Frontend | Next.js + React | 16.1.6 + 19.2.4 | Viene en ZernFlow. App Router con Server Components |
| Estilos | Tailwind CSS | 4.1.18 | Viene en ZernFlow |
| Flow Builder | @xyflow/react | 12.10 | Viene en ZernFlow |
| Base de datos | Supabase (PostgreSQL) | — | RLS, Vault, Auth, Realtime |
| Auth | Supabase Auth | — | Email/password con trigger de auto-creación de workspace |
| Client | @supabase/supabase-js + @supabase/ssr | 2.95 + 0.8 | Acceso con RLS automático |
| Hosting | Railway | — | Un solo servicio en Etapa 1 |
| **Instagram y WhatsApp** | **Zernio (API oficial de Meta)** | SDK `@zernio/node` 0.2.519, **versión fijada exacta** | Infraestructura oficial, sin riesgo de ban. Cliente ya escrito y con tests en el fork |
| Email | Resend | — | Solo saliente en Fase 1 |
| IA (SDK) | Vercel AI SDK | v6 | Viene en ZernFlow. Soporta ToolLoopAgent |
| Secrets | Supabase Vault | — | AES-256, nativo de Supabase |
| Testing | Vitest | 3.x | Viene en ZernFlow |
| TypeScript | TypeScript | 5.9 | Viene en ZernFlow |

**Ya no forma parte del stack:** Evolution API y Baileys.

---

## 10. Pantallas principales

### 10.1 Convenciones globales

**Navegación:** sidebar colapsable con Dashboard, Inbox, Contacts, Flows, Sequences, Growth y Settings. En mobile colapsa a bottom navigation. Breadcrumbs arriba del contenido.

**Sistema visual:** tipografía Inter. Paleta heredada de ZernFlow: neutros con un acento. Componentes reutilizables: botones (primary, secondary, ghost, destructive), inputs con validación, cards, tablas con sorting y paginación, modales, dropdowns, toasts.

**Estados estándar:**
- **Vacío**: ícono + texto explicativo + CTA principal
- **Cargando**: skeleton loaders para listas, spinner para acciones puntuales
- **Error**: banner con mensaje claro y acción sugerida
- **Éxito**: toast que se cierra solo a los 4 segundos

**Responsive:** mobile (<768px), tablet (768-1024px), desktop (>1024px). En mobile el inbox muestra primero la lista y al tocar abre el hilo a pantalla completa.

### 10.2 Detalle por pantalla

#### Dashboard (`/dashboard`)

- **Propósito**: vista general. Wizard de onboarding si no hay canales; cards de resumen si los hay.
- **Componentes**: wizard de setup, cards (total de contactos, conversaciones abiertas, canales activos), actividad reciente.
- **Estados**: sin canales (wizard), con canales sin datos (ceros y "Esperando mensajes"), con datos.

#### Inbox (`/inbox`)

- **Propósito**: ver y responder conversaciones de todos los canales.
- **Layout**: tres columnas en desktop (lista, hilo, panel del contacto). En mobile, lista y hilo son pantallas separadas.
- **Componentes**:
    - Lista: avatar, nombre, preview, ícono de canal, timestamp, unread badge, badge "no contactar", **indicador de ventana**
    - Hilo: burbujas diferenciadas, timestamps, estado del mensaje, **marca visual en los mensajes enviados como plantilla**
    - Panel del contacto: datos, tags, asignaciones, notas, campos custom
    - Campo de respuesta con selector de respuestas rápidas ("/")
    - Toggle de agente IA (visible pero no funcional hasta Fase 3)
    - **Barra de filtros**: canal, tags, asignación, fecha, **estado de ventana**
- **Reglas**:
    - Owner y Admin ven todas las conversaciones; un Member solo las suyas (scope por RLS)
    - Al responder, el operador se asigna automáticamente
    - **El campo de respuesta cambia según el estado de la ventana** (ver F6c)
    - Mensajes a contacto "no contactar": advertencia en texto libre, bloqueo en plantillas

#### Configuración de integraciones (`/settings/integrations`)

- **Propósito**: conectar y gestionar canales, email y proveedores de IA.
- **Componentes**: card por integración con ícono, nombre, estado (badge verde o rojo), cuenta conectada y botón de acción. Para WhatsApp, además: número conectado y estado del nombre para mostrar.
- **Reglas**: solo Owner y Admin.

#### Plantillas de WhatsApp (`/settings/whatsapp-templates`) — pantalla nueva

- **Propósito**: gestionar las plantillas aprobadas por Meta.
- **Componentes**: tabla con nombre interno, nombre en Meta, categoría, idioma, estado (badge por color), calificación de calidad, acciones. Formulario de alta con cuerpo, variables y categoría. Vista del motivo de rechazo cuando aplique.
- **Estados**: borrador, enviada (con aviso de 24 a 48 horas de revisión), aprobada, rechazada (con motivo), pausada por calidad.
- **Reglas**: solo Owner y Admin.

#### Respuestas rápidas (`/settings/response-templates`)

- **Propósito**: CRUD de respuestas predefinidas para usar dentro de la ventana.
- **Componentes**: tabla con nombre, atajo, preview, autor y acciones. Formulario con guía de variables disponibles y preview en vivo.
- **Reglas**: Owner y Admin crean y editan; Member usa.

#### Lista de contactos (`/contacts`)

- **Propósito**: ver todos los contactos con filtros y acciones.
- **Componentes**: búsqueda, filtros (tags, setter, vendedor, temperatura, canal), tabla paginada de 25, botones "Importar CSV" y "Nuevo contacto".
- **Reglas**: Owner y Admin ven todos; un Member solo los suyos. Eliminar solo Admin y Owner.

#### Ficha de contacto (`/contacts/[id]`)

- **Propósito**: vista completa del contacto.
- **Componentes**: header con datos principales y badges, sidebar con asignaciones y datos, secciones de Conversaciones (**con estado de ventana por canal**), Notas, Tags, Custom Fields, Historial y Atribución.
- **Reglas**: Owner y Admin ven cualquier ficha; un Member solo las suyas.

#### Modal de importación CSV

- **Propósito**: importar contactos.
- **Layout**: cuatro pasos (upload, preview y mapeo, opciones, resultado).
- **Estados**: subiendo, mapeando, **encolado** (más de 500 filas), importando, completado, error con descarga de detalle.

---

## 11. Guías de UI, marca y diseño

- **Colores**: diseño neutro y profesional, grises con un acento azul por defecto, heredado de ZernFlow.
- **Tipografía**: Inter. h1 (2rem), h2 (1.5rem), h3 (1.25rem), body (14px), small (0.875rem).
- **Tono de los textos**: profesional y cercano, en español rioplatense. Sin jerga técnica en la interfaz. Errores claros y con acción sugerida.
- **Lineamientos de UX**:
    - Acciones en un clic, sin enterrarlas en menús
    - Modales solo para confirmaciones y formularios cortos
    - Feedback inmediato: toasts, spinners, skeletons
    - Deshacer donde se pueda, especialmente en eliminaciones (5 segundos antes del soft delete)
    - Teclado: "/" para respuestas rápidas, Ctrl+Enter para enviar, Escape para cerrar modales
- **Nomenclatura obligatoria**: "respuestas rápidas" para los templates internos, "plantillas de WhatsApp" para las de Meta. Nunca usar "plantilla" a secas.

---

## 12. Fuera del alcance de esta fase

### Para fases siguientes de esta etapa

| Funcionalidad | Fase | Nota |
| --- | --- | --- |
| Flow builder con triggers extendidos | Fase 2 | Los triggers básicos ya existen |
| BYOK multi-proveedor en el nodo AI Response | Fase 2 | La UI de BYOK se construye en Fase 1 |
| **Secuencias que envían plantillas de WhatsApp** | Fase 2 | El modelo de plantillas se construye en Fase 1 |
| **Validación de ventana al dar de alta una secuencia** | Fase 2 | Marca en rojo los pasos que van a fallar |
| Base de conocimiento con pgvector | Fase 2 | — |
| Notificaciones para admins por derivación a humano | Fase 2 | — |
| Agente IA conversacional con tool calling | Fase 3 | — |
| Memoria acumulativa del agente | Fase 3 | El campo ya existe |
| Clasificación automática post-conversación | Fase 3 | — |
| Toggle de agente IA funcional | Fase 3 | Se muestra en Fase 1 sin activar nada |
| Dashboards de analytics | Fase 3 | — |

### Para etapas futuras

| Funcionalidad | Etapa | Nota |
| --- | --- | --- |
| TikTok (publicación y métricas) | Etapa 2 | **3ª cuenta de Zernio, $6/mes**, porque WhatsApp ocupa la 2ª |
| YouTube y LinkedIn | Etapa 2 | No son canales de chat |
| Publicación de contenido (LateWiz) | Etapa 2 | Componentes de UI adaptados |
| Email bidireccional | Etapa 2 | — |
| Roles custom con permisos por módulo | Etapa 2 | El scope de leads ya está en Etapa 1 |
| Meta Ads dashboard | Etapa 2 | — |
| Agente asistente integral, Fathom, MCP | Etapa 3 | — |
| Agendamiento, ventas y pipeline | Etapa 4 (opcional) | — |

### Fuera del proyecto completo

| Funcionalidad | Motivo |
| --- | --- |
| Detección de nuevos seguidores de Instagram | Limitación de la API |
| **Comment-to-DM y secuencias en TikTok** | La plataforma no permite que el negocio inicie conversaciones |
| App móvil nativa | PWA responsive es suficiente |
| Integración con CRMs externos | El sistema ES el CRM |
| Facturación y cobros automáticos | No es el core |
| Rotación automática de API keys | La manual alcanza |
| Merge automático de contactos duplicados | La detección y vinculación manual alcanzan |

---

## 13. Decisiones transversales

| Decisión | Definición |
| --- | --- |
| **Historial y auditoría** | `audit_log` global. Registra contactos, asignaciones, importaciones, canales, equipo y **ciclo de vida de plantillas**. No se elimina nunca |
| **Soft delete** | `deleted_at` en contactos, notas, conversaciones y respuestas rápidas. Retención 30 días, purga por cron. Cascada al purgar; el audit log sobrevive |
| **Deduplicación de contactos** | Por teléfono normalizado a E.164 y email. Match exacto vincula; match solo por username sugiere |
| **Estados y ciclo de vida** | Conversación: open → closed. Contacto: active → do_not_contact. **Plantilla: draft → submitted → approved / rejected → paused.** Enrollment y flow session: ya existen en ZernFlow. Invitación: pending → accepted → expired |
| **Ventanas de mensajería** | Guardadas como configuración del canal, no cableadas. Instagram 24h más respuesta privada de 7 días; WhatsApp 24h, o 72h si vino de click-to-WhatsApp. El motor valida antes de enviar y, en Fase 2, al dar de alta la secuencia |
| **Casos borde** | Webhook duplicado: verificar `webhook_events`. CSV inválido: abortar con error. API key inválida: error visible al usarla. Dos operadores responden a la vez: gana el último, Realtime actualiza a ambos. **Ventana cerrada: el sistema lo impide antes de intentar el envío** |
| **Zona horaria e idioma** | Fechas en UTC, el frontend convierte a la zona del navegador. UI en español rioplatense |
| **Motor de automatización** | Flow builder de ZernFlow. En Fase 1 se verifica; en Fase 2 se extiende. Las secuencias son independientes pero se activan desde flows |
| **Modelo de asignación** | Doble: setter y vendedor, opcionales e independientes. Asignación manual en Fase 1. Las conversaciones se auto-asignan a quien responde. **La asignación define el scope de visibilidad por RLS** |
| **Contacto cross-canal** | Identificador principal: teléfono > email > username. Vinculación automática con los dos primeros, sugerida con el tercero. Cada conversación separada por canal, **con su propia ventana** |
| **BYOK y secrets** | Supabase Vault con AES-256, aislado por workspace. **Las columnas de claves en texto plano del fork se migran y se eliminan en Fase 1** |
| **Patrón de webhooks** | Idempotencia con `webhook_events`. Ack inmediato con 200 antes de procesar. Procesamiento async en `scheduled_jobs` cuando sea pesado. **Validación HMAC obligatoria para todos los webhooks de Zernio**, que ahora incluyen WhatsApp |
| **Difusiones y rate limiting** | No aplican en Fase 1. Instagram: 200 mensajes automatizados por hora. **WhatsApp: el límite de mensajería cuenta contactos únicos por día fuera de la ventana; arranca en 250 y sube a 2.000 con los pasos de escalado de Meta.** Con el volumen previsto (~23 por día) no es restrictivo |

---

## 13b. Seguridad

### Autenticación y sesiones

| Área | Definición |
| --- | --- |
| Método | Email y contraseña vía Supabase Auth |
| Contraseñas | Mínimo 8 caracteres (default de Supabase) |
| Sesiones | Supabase SSR con cookies httpOnly. Access token 1 hora, refresh 7 días |
| Fuerza bruta | Rate limiting nativo de Supabase Auth |
| Recuperación | Flujo de reset nativo con token de tiempo limitado |

### Row Level Security

Todas las tablas con RLS. La función `is_workspace_member(ws_id)` ya existe en ZernFlow. Se agrega `can_see_contact(contact_row)` para el scope de leads.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `contacts` | **Owner/Admin todo; Member solo asignados** | Miembros | Igual que SELECT | Owner, Admin |
| `conversations` | **Igual que contacts** | Sistema | Igual que SELECT | Owner, Admin |
| `contact_notes` | Hereda el scope del contacto | Miembros con acceso al contacto | Autor, Admin, Owner | Autor, Admin, Owner |
| `response_templates` | Miembros | Owner, Admin | Owner, Admin | Owner, Admin |
| **`whatsapp_templates`** | Miembros | Owner, Admin | Owner, Admin | Owner, Admin |
| `csv_imports` | Miembros | Miembros | — (inmutable) | — |
| `audit_log` | Member solo sus acciones; Admin y Owner todo | Solo service role | — | — (nunca) |
| `integration_configs` | Owner, Admin | Owner, Admin | Owner, Admin | Owner, Admin |

**Verificaciones obligatorias:**

- Todos los SELECT en tablas con `deleted_at` filtran `WHERE deleted_at IS NULL`
- **El scope se evalúa en la base, no en la interfaz**: con el token de un Member, una consulta directa a la API de Supabase de un lead ajeno devuelve vacío
- **Realtime respeta el scope**: un Member no recibe eventos de conversaciones que no le corresponden. Si la configuración de Realtime no lo garantiza, se filtra del lado del servidor antes de emitir

### Validación de inputs

- Validación en cliente **y en servidor**
- Email con formato válido; **teléfono normalizado a E.164 en el servidor**; URLs con formato válido
- API keys: longitud mínima y prefijo esperado donde aplique
- CSV: formato, máximo 10MB y 10.000 filas
- Sanitización contra XSS en todos los campos de texto

### Protección de API

- Verificación de JWT de Supabase en todas las API routes y Server Actions
- Rate limiting en los endpoints de webhooks
- CORS solo con el dominio de la app, sin wildcard
- Headers: Content-Security-Policy, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Strict-Transport-Security

### Datos sensibles

- API keys de terceros en Supabase Vault, nunca en variables de entorno del frontend
- Service Role Key solo en servidor
- Logs sin tokens, contraseñas ni claves
- `.env` en `.gitignore`, con `.env.example` de placeholders
- **Ninguna clave de API queda en columnas de `workspaces` al terminar el Bloque 1**

### Comunicaciones

- HTTPS obligatorio en producción
- **Todos los webhooks de Zernio (Instagram y WhatsApp) validan firma HMAC antes de procesar**

### Checklist para la IA constructora

- [ ] RLS habilitado en todas las tablas, existentes y nuevas
- [ ] Políticas de scope de leads escritas y probadas **por API, no solo por UI**
- [ ] Realtime verificado contra el scope de leads
- [ ] JWT verificado en todas las API routes y Server Actions
- [ ] Rate limiting en webhooks
- [ ] Validación en servidor, no solo en cliente
- [ ] Teléfonos normalizados a E.164 en el servidor
- [ ] CORS con dominio específico
- [ ] Headers de seguridad en `next.config.js`
- [ ] Secrets en Vault; **columnas de claves en texto plano eliminadas**
- [ ] Service Role Key solo en servidor
- [ ] HTTPS en producción
- [ ] Logs sin datos sensibles
- [ ] `.env` en `.gitignore`
- [ ] Firmas HMAC validadas en todos los webhooks de Zernio
- [ ] Versión de `@zernio/node` fijada exacta

---

## 13c. Base técnica heredada (fork de ZernFlow)

- **Proyecto base**: [ZernFlow](https://github.com/zernio-dev/zernflow), licencia MIT
- **Framework y versiones**: Next.js 16.1.6, React 19.2.4, Tailwind CSS 4.1.18, TypeScript 5.9.3, Vitest 3.2.4
- **Base de datos**: **24 tablas en 16 archivos de migración**
    - Migración 1: workspaces, workspace_members, channels, contacts, contact_channels, tags, contact_tags, custom_field_definitions, contact_custom_fields, flows, triggers, flow_sessions, conversations, messages, broadcasts, broadcast_recipients, scheduled_jobs, analytics_events (18)
    - Migración 4: comment_logs (19)
    - Migración 5: sequences, sequence_enrollments (21)
    - Migración 6: workspace_invites (22)
    - Migración 10: flow_versions (23)
    - Migración 12: webhook_events (24)
    - Migración 16: agrega `'whatsapp'` al CHECK constraint de `channels.platform`, sin crear tabla

**Sobre el conteo de nodos del flow builder:** `lib/flow-engine/types.ts` define **16 tipos de `NodeData`**: Trigger, Send Message, Condition, Delay, Smart Delay, Tag, Set Field, HTTP Request, Go To Flow, Human Takeover, A/B Split, Subscribe, Comment Reply, Private Reply, AI Response, Enroll Sequence. Los documentos previos dicen 17 y 18 porque cuentan por separado "Add Tag / Remove Tag" y "Subscribe / Unsubscribe", que en el código son un solo tipo con un parámetro. **Se implementan 16 componentes de nodo.**

- **Ya implementado, no reconstruir**: autenticación con trigger de auto-creación de workspace; flow builder visual con motor recursivo de profundidad máxima 50; inbox con lista y panel de mensajes; CRM con tags y custom fields (6 tipos); secuencias con auto-pausa en respuesta; team management con invitaciones de 7 días; difusiones (tabla y UI, sin uso en Etapa 1); ledger de idempotencia de webhooks; versionado de flows; Realtime en conversaciones y mensajes; **cliente de Zernio con webhooks y adaptadores por plataforma, con tests**
- **Patterns a seguir**: Supabase SSR con cookies httpOnly; Server Components más hooks, sin store global; webhooks en API Routes y mutaciones en Server Actions; `@supabase/supabase-js` con RLS, Service Role solo cuando hace falta bypass; Tailwind v4 sin CSS modules; motor de flujos en `lib/flow-engine/engine.ts`, nodos en `lib/flow-engine/nodes/`, abstracción de plataforma en `lib/flow-engine/platform-adapter.ts`
- **Dependencias críticas**: `@supabase/supabase-js: ^2.95.3`, `@supabase/ssr: ^0.8.0`, `@xyflow/react: ^12.10.0`, **`@zernio/node: 0.2.519` (fijar exacta)**, `ai: ^6.0.85`, `next: ^16.1.6`, `react: ^19.2.4`, `tailwindcss: ^4.1.18`

**Problema de seguridad heredado, a corregir en el Bloque 1:** la columna `workspaces.late_api_key_encrypted` **no está encriptada**. El código la lee y la pasa directo al cliente de la API, sin ninguna función de desencriptado. Lo mismo con `ai_api_key`. Ver F2.

---

## 13d. Proyecto como template clonable

### Migraciones

Formato `000NN_nombre.sql`, idempotentes con `IF NOT EXISTS` y bloques `DO $$`. Las nuevas continúan desde `00017`:

- `00017_extend_contacts.sql`: campos nuevos en contacts, incluida atribución y soft delete
- `00018_vault_setup.sql`: extensión vault, funciones RPC, **migración de las claves en texto plano y eliminación de las columnas viejas**
- `00019_crm_tables.sql`: contact_notes, response_templates, csv_imports, audit_log, integration_configs
- `00020_whatsapp_templates.sql`: **tabla de plantillas y campos de ventana en conversations, más `whatsapp_template_id` en messages**
- `00021_crm_indexes.sql`: índices para tablas y campos nuevos, incluidos los compuestos de deduplicación
- `00022_crm_rls.sql`: políticas RLS de las tablas nuevas **y scope de leads con `can_see_contact`**
- `00023_soft_delete_cron.sql`: función y configuración del cron de purga

*No hace falta migración del CHECK constraint de `channels`: `'instagram'` y `'whatsapp'` ya están tras la migración 16. `'tiktok'`, `'youtube'`, `'linkedin'` y `'email'` se agregan en Etapa 2.*

#### Renumeración real (se actualiza al crear cada migración)

La lista de arriba es la planificada. La construcción del Bloque 1 necesitó dos migraciones que no
estaban previstas, así que la numeración efectiva se corre. Esta es la lista real:

| Archivo real | Bloque | Qué hace | Estado |
| --- | --- | --- | --- |
| `00017_lead_scope_columns.sql` | 1 | `contacts.setter_id`, `contacts.vendedor_id`, `workspaces.unassigned_leads_visible_to_members` e índices | **Aplicada** |
| `00018_vault_setup.sql` | 1 | Extensión, funciones RPC y **copia** de las claves en texto plano. No borra columnas | **Aplicada** |
| `00019_lead_scope_rls.sql` | 1 | `can_see_contact`, `can_see_conversation`, reemplazo de las policies del fork en 13 tablas y borrado sin reemplazo de las de `scheduled_jobs` | **Aplicada** |
| `00020_workspace_members_manager_select.sql` | 1 | Un manager ve las membresías de su workspace. Sin esto la policy de UPDATE de la 00019 era letra muerta | **Aplicada** |
| `signup_respects_invite` | 1 | Que `handle_new_user` no le cree workspace propio al invitado. **No hizo falta**: el invitado aterriza en el workspace correcto por la heurística de membresía más reciente. Si alguna vez se hace, toma el número libre que corresponda | Condicional, no aplicada |
| `00021_drop_plaintext_key_columns.sql` | 1 | Borra `late_api_key_encrypted` y `ai_api_key` | Pendiente (Sesión B) |
| `00022_extend_contacts.sql` y siguientes | 3 y 4 | La lista planificada de arriba, corrida cinco números | Pendiente |

**`00018` no borra las columnas: expandir y contraer.** El plan original juntaba en una sola
migración la creación de los RPC, la copia de los valores y el `drop` de las columnas. Entre ese
push y la reescritura de las 16 lecturas del código la app queda rota, y si la reescritura sale mal
no hay camino de vuelta porque el dato viejo ya no existe. Ahora `00018` solo copia, los dos
mecanismos conviven mientras se reescribe y se prueba el código, y `00021` borra las columnas
cuando Vault ya está probado en todos los caminos. Consecuencia: el criterio de F2
"`select * from workspaces` no devuelve ninguna clave" se cumple al aplicar `00021`, no `00018`.

**Fuga encontrada al verificar F2, más grave que el problema documentado.** El documento describe
las claves "en texto plano en una columna". Además de eso, seis consultas mandaban secretos al
navegador o los devolvían en una respuesta de API:

| Dónde | Cómo salía |
| --- | --- |
| `app/(dashboard)/layout.tsx` | fila completa del workspace a `<Sidebar>` (Client Component) |
| `.../dashboard/channels/page.tsx` | filas completas de canales a `<ChannelsView>` |
| `.../dashboard/growth/page.tsx` | filas completas de canales a `<GrowthView>` |
| `GET /api/v1/channels` | filas de canales como JSON |
| `POST /api/v1/channels/sync` | devuelve la lista de canales en la respuesta |
| `/api/v1/messages` y `/api/cron/jobs` | `channels(*)` relacional, de uso interno |

`workspaces.webhook_secret` y `channels.webhook_secret` son el secreto con el que se valida la
firma HMAC de los webhooks de Zernio: quien lo tuviera podía **forjar eventos entrantes firmados**.
Las props de un Client Component se serializan en el HTML, así que una fila "leída solo en el
servidor" terminaba en el navegador con todo lo que trae.

**Regla nueva del proyecto, en `lib/safe-columns.ts`:** ninguna consulta que alimente un Client
Component o una respuesta de API usa `select("*")` sobre `workspaces` ni `channels`. Se enumeran
columnas. Lo hacen cumplir dos cosas: el tipo (los Client Components usan `Omit<Row, secreto>`, así
que el compilador rechaza traer la columna) y `lib/safe-columns.test.ts`, un test estático que
prohíbe el `*` y el nombre de la columna fuera de un allowlist con motivo escrito. El test encontró
cuatro de los seis puntos que la revisión manual no había visto.

**La extensión de `channels` a más plataformas no hace falta todavía**, igual que dice la nota de
arriba.

**Por qué se desdobló `00017_extend_contacts`:** el scope de leads de F3 se define por `setter_id` y
`vendedor_id`, que el plan original ubicaba en la extensión de `contacts` del Bloque 3. Sin esas dos
columnas las policies de F3 no se pueden escribir. Se adelantaron solo esas dos más el flag de
visibilidad de leads sin asignar; el resto de la extensión de `contacts` sigue en el Bloque 3.
`00017_extend_contacts.sql` pasa a numerarse desde `00022` y arranca sin esas dos columnas (siendo
idempotente con `add column if not exists`, tampoco rompería si las repitiera).

**Desvío en la firma de `can_see_contact`:** el criterio de F3 la describe como
`can_see_contact(contact_row)`. Se implementa con argumentos sueltos,
`can_see_contact(p_workspace_id, p_setter_id, p_vendedor_id)`. Motivo verificado con `EXPLAIN` sobre
esta base: una función `security definer` no se inlinea nunca, así que con cualquiera de las dos
firmas la policy se evalúa fila por fila y ningún índice la ayuda; recibir la fila completa solo
agrega el costo de armar un valor compuesto por fila, ata la firma al rowtype de `contacts` (que el
Bloque 3 extiende) y obliga a materializar el registro entero en las policies de las tablas
satélite. Se mantiene el espíritu del criterio: una sola función helper usada en las policies de
SELECT, UPDATE y DELETE de `contacts`.

#### Decisiones de la 00019

**El INSERT no es simétrico entre `contacts` y `conversations`.** Las policies del fork son
`for all`, así que también eran las que habilitaban el INSERT: al reemplazarlas hubo que decidir
quién crea cada cosa.

- **`contacts`: insertan todos los miembros, con un `with check` de auto-asignación.** Un Member que
  crea un lead tiene que quedar como `setter_id` o `vendedor_id`, o el insert falla; Owner y Admin
  insertan libre. Sin ese `with check` el propio scope le esconde el contacto en la consulta
  siguiente: el lead existiría, sin dueño y sin que su creador pueda verlo. Queda listo para el alta
  manual y la importación CSV del Bloque 3 sin otra migración.
- **`conversations`: el INSERT desde el navegador es solo de manager.** Las conversaciones nacen del
  webhook, que entra con service role y se saltea la RLS. No hay caso legítimo de creación desde la
  interfaz.

**`conversations` necesita policy de UPDATE, y no es opcional.** La bandeja marca como leído desde
el **navegador** (`inbox-view.tsx`, `update` de `unread_count` con el cliente del usuario) y
`api/v1/messages` actualiza la conversación al enviar. Sin UPDATE las dos cosas fallan devolviendo
cero filas afectadas, sin error visible en ningún lado.

**`scheduled_jobs`: se borraron las tres policies de la 00009 y no se reemplazaron.** Autorizaban
con `auth.uid() is not null` y la tabla no tiene `workspace_id`, así que cualquier usuario
autenticado del proyecto podía encolar un job con el `type` que quisiera —que el cron ejecuta—,
marcar la cola entera como `completed` dejando caer secuencias y resume de flujos en silencio, y
leer los payloads de todos los workspaces. Con RLS activa y sin policies, Postgres niega todo para
cualquier token de usuario; el cron y el motor de flujos entran con service role y no se ven
afectados.

Antes de borrarlas se verificaron los dos puntos de inserción. `lib/flow-engine/engine.ts`
(`executeDelay`) está limpio: los tres puntos de entrada a `executeFlow` / `resumeSession` son el
webhook, `processComment` —que tiene un solo llamador, el mismo webhook— y el cron, los tres con
`createServiceClient()`. `lib/scheduler.ts` (`scheduleBroadcastDelivery`) **no** lo estaba: recibía
el cliente con cookies desde `/api/v1/broadcasts/[id]/send`. Esa ruta se corrigió en el mismo
commit: encola con service role, quedó detrás de una guarda de manager —pasa a ser el único camino
que le queda a un cliente para meter filas en la cola, así que sin guarda la puerta no se cierra, se
muda— y su sexta copia del `limit(1).single()` sobre `workspace_members` se reemplazó por el
resolvedor de `lib/workspace.ts`.

**`flow_sessions` y `broadcast_recipients` también entraron.** Las dos tienen `contact_id` y
autorizaban vía `flows` y vía `broadcasts` con `is_workspace_member`. La primera es la más grave de
las dos: `variables jsonb` es donde el motor guarda todo lo que capturó de la conversación —nombre,
email, teléfono, respuestas—, así que un Member leía lo capturado de cualquier lead del workspace.

#### Decisiones de la 00020, y el bug silencioso que la motivó

La 00019 le dio al manager una policy de UPDATE sobre `workspace_members` para poder cambiar el rol
de un miembro. **No alcanzaba, y fallaba en silencio.**

Postgres aplica también las policies de **SELECT** cuando un UPDATE o un DELETE referencia columnas
de la tabla, y PostgREST siempre arma un `WHERE`. La policy de SELECT del fork es
`user_id = auth.uid()`: cada quien ve solo su propia fila. Entonces un Owner que intentaba cambiarle
el rol a otra persona no veía esa fila, el UPDATE afectaba cero filas, y PostgREST respondía **204**
igual. Éxito aparente, rol sin cambiar.

Apareció probando con un Member invitado de verdad: la comprobación "un Manager SÍ puede cambiar el
rol de un miembro" devolvía 204 con el rol intacto. Es el mismo modo de fallar que el de
`conversations` y el marcar-como-leído: cero filas afectadas no es un error.

La 00020 lo arregla dejando que el manager vea las membresías de su workspace. Además de destrabar
el UPDATE, es correcto por sí solo: la pantalla de equipo ya muestra ese listado y hasta ahora tenía
que armarlo con el service client porque la RLS no se lo permitía. No hay recursión porque la rama
nueva no consulta `workspace_members` directamente: llama a `is_workspace_manager`, que es
`security definer`. Escribir no cambia: el UPDATE sigue siendo de manager y el DELETE solo del Owner.

#### Roles e invitaciones (Sesión B, PASO 2)

**Las guardas de rol viven en `lib/workspace.ts`**, no como parches por ruta: `requireManager()` para
rutas de API (403 en JSON, distinguido del 401) y `getWorkspaceAsManager()` para páginas (manda al
Member a `/dashboard` en vez de renderizar). Cubren `/dashboard/settings`,
`/dashboard/settings/team`, `/dashboard/channels` y las **cinco** rutas de `api/v1/channels`, más
`/api/v1/broadcasts/[id]/send` que ya las necesitaba desde la 00019.

Poner la guarda en `/dashboard/settings/team` es lo que cierra la fuga del listado de equipo: la
página arma el roster con el service client y resuelve cada email contra `auth.users`, así que la
RLS no la frenaba y esconder los botones en el cliente no servía de nada.

**`api/v1/channels/test-key` no tenía ninguna capa de autorización**: ni `getUser()`, ni chequeo de
membresía, y tomaba el `workspaceId` del body. Un POST sin sesión llegaba a Zernio con la clave que
mandara quien llamara y recibía `{ accounts }`, o sea un oráculo abierto para validar claves de
Zernio robadas. Ahora exige manager y el workspace sale de la sesión.

**Quién hace qué:** invitar, revocar y cambiar rol es de Owner y Admin; remover a alguien del
workspace sigue siendo solo del Owner. No se puede tocar el rol de un Owner ni ascender a nadie a
Owner: sin ese límite un Admin podría degradar al Owner y quedarse con el workspace.

**Entrega de la invitación.** No se manda ningún email —eso es Resend, Bloque 2—, así que el link
`/invite/<id>` se muestra y se copia desde la pantalla de equipo: hasta ahora no se mostraba en
ningún lado y no había forma de hacerlo llegar. Además `/login` y `/register` ahora respetan el
parámetro `next`, que la pantalla de invitación ya les pasaba y las dos ignoraban; el invitado
volvía del login al dashboard con la invitación sin aceptar. El `next` se valida en
`lib/next-param.ts` con la misma regla que `auth/callback`: solo rutas internas, porque si no la
pantalla de login se convierte en un redirector abierto.

**Lead que sale del scope con la pantalla abierta.** `api/v1/messages` devolvía un 404 genérico que
la bandeja interpretaba como "conversación sin mensajes" y renderizaba un hilo vacío sin
explicación. Ahora responde 403 con `code: "fuera_de_scope"` en el GET y en el POST, y la bandeja
muestra un mensaje claro con un botón para actualizar. No se distingue "se borró" de "te la
sacaron": la RLS devuelve vacío en los dos casos y decir "existe pero no es tuya" confirmaría la
existencia de un lead ajeno.

#### Pendientes de rendimiento, para el Bloque 4

**La medición de `EXPLAIN ANALYZE` de la consulta de la bandeja queda diferida.** Hoy la base tiene
0 contactos y 0 conversaciones: medir sería un seq scan de cero filas con cualquiera de las dos
formas del helper y no diría nada. Se hace en el Bloque 4, cuando la importación CSV permita cargar
unos miles de contactos de prueba. **Cómo:** `SUPABASE_DB_URL` en `.env` más un
`scripts/explain-inbox.mjs` versionado que haga `SET LOCAL ROLE authenticated` con los claims del
Member y corra el `EXPLAIN ANALYZE` bajo RLS real. Hasta entonces el helper se queda como está: la
decisión de pasarlo a forma inline se toma con datos, no antes.

En la misma corrida se mide otra cosa: **el SELECT de `messages` hace una llamada a función por fila
y cada una consulta `contacts`.** No se optimiza ahora.

#### Deuda conocida que la 00019 no cubre

- **`comment_logs`, para el Bloque 4.** Tiene `author_username`, `author_name` y `comment_text`, y
  `author_username` es el mismo identificador que `contact_channels.platform_username`, así que se
  correlaciona con un lead. Pero **no tiene `contact_id`**: arreglarla exige decidir antes si un
  comentario pertenece a un lead o al workspace, y esa decisión no se toma todavía.
- Las policies de INSERT y UPDATE de `broadcast_recipients` que agregó la 00009 siguen autorizando
  por `is_workspace_member`. Son caminos de escritura, no de lectura.
- `scheduleJob` (`lib/scheduler.ts`) es código muerto: no tiene ningún llamador.
- **Los dos verificadores corren contra la base de producción.** Hoy está vacía y es tolerable;
  cuando el negocio opere tienen que apuntar a una base local o de staging.
- **El envío de invitaciones por email, Bloque 2** (Resend). Hasta entonces el link se copia a mano
  desde la pantalla de equipo.
- El botón de sincronizar de la bandeja le devuelve 403 a un Member en vez de esconderse. Antes le
  fallaba igual, con un error de Vault menos claro, porque leer la clave de Zernio ya exigía manager.

### Variables de entorno

```
# === Supabase ===
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# === App ===
NEXT_PUBLIC_APP_URL=
CRON_SECRET=

# === Integraciones ===
# Las API keys NO van acá: se configuran desde /settings/integrations
# y se guardan en Supabase Vault (encriptadas)

# === Google Cloud (OAuth) — Etapa 2 ===
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_REDIRECT_URI=

# === LinkedIn (OAuth) — Etapa 2 ===
# LINKEDIN_CLIENT_ID=
# LINKEDIN_CLIENT_SECRET=
# LINKEDIN_REDIRECT_URI=
```

**Ya no existen:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `RESEND_API_KEY` (esta última pasa a Vault como todas las demás).

### README de setup

1. Forkear [el repositorio](https://github.com/zernio-dev/zernflow) en GitHub
2. Crear proyecto en Supabase, plan Pro
3. Habilitar Vault: `CREATE EXTENSION IF NOT EXISTS vault WITH SCHEMA vault`
4. Correr migraciones **00001 a 00023** en orden
5. Copiar `.env.example` a `.env` y completar Supabase, App URL y Cron Secret
6. `npm install`
7. `npm run dev` para desarrollo local
8. Deploy a Railway: conectar el repo de GitHub y configurar las variables de entorno
9. Desde la app, ir a `/settings/integrations` y conectar Zernio (Instagram y WhatsApp), Resend y los proveedores de IA

**Troubleshooting:**
- "RLS policy error": verificar que las migraciones de RLS corrieron
- "Vault not found": habilitar la extensión Vault
- "Un Member ve leads que no son suyos": la migración 00022 no corrió o `can_see_contact` no está en la policy
- "El mensaje no se envía": verificar el estado de la ventana de la conversación antes que la conexión del canal
- "API key inválida": verificar desde `/settings/integrations`

### Personalización sin código

| Qué se personaliza | Desde dónde |
| --- | --- |
| Nombre del negocio y datos del workspace | Settings |
| Canales conectados | Settings → Integraciones |
| Proveedores de IA | Settings → Integraciones |
| **Plantillas de WhatsApp** | Settings → Plantillas de WhatsApp |
| Respuestas rápidas | Settings → Respuestas rápidas |
| Tags y custom fields | Contacts |
| Flows y automatizaciones | Flow Builder |
| Frases de opt-out | Settings |
| Funcionalidades nuevas, flujos de negocio, canales nuevos | Código |

---

## 14. Pendientes

### Dependencias externas con plazo

| Dependencia | Plazo | Bloquea |
| --- | --- | --- |
| **Número dedicado de WhatsApp** | En trámite | La conexión del canal, no su construcción |
| **Nombre para mostrar aprobado por Meta** | Horas a días | El envío de plantillas |
| **Plantillas aprobadas por Meta** | 24 a 48 horas por plantilla | Las secuencias de Fase 2 |
| Verificación de negocio con Meta | 3 a 5 días, salvo que Zernio la absorba | Etapa 2 (Meta Ads) |
| Dominio verificado en Resend | Horas | Emails con remitente propio |
| Cuenta de Zernio con las 2 cuentas gratuitas | Minutos | Ambos canales |

### A confirmar con Zernio

1. **¿Absorben la verificación de negocio con Meta?** Cambia el cronograma de la Etapa 2.
2. **¿Exponen la gestión de plantillas por API** (alta, estado, calificación) o hay que crearlas a mano en Meta Business Manager? Define si F6b es un módulo completo o un espejo de lectura.
3. **¿El webhook de WhatsApp es en tiempo real?** Su documentación dice que Meta, Telegram y Slack lo son; WhatsApp es de Meta, así que debería, pero conviene confirmarlo por escrito.
4. **¿La API expone `window_expires_at` o hay que calcularla del último mensaje entrante?** Si la expone, es preferible usarla como fuente de verdad.

### Decisiones abiertas menores

- **Wizard de onboarding**: la estructura exacta se puede refinar durante la construcción.
- **Frases de opt-out**: la lista inicial es la del F18; el cliente puede ampliarla desde Settings.

---

**Siguiente paso:** el plano de la Fase 1 está listo. Para la propuesta comercial, usá `06-propuesta`. Para arrancar la construcción, los bloques están definidos para ejecutar en orden con Claude Code (`09-construccion-claude-code`). Para diseñar los flujos visualmente, usá `07-flujogramas`.
