# Comunicación

- Explicá todo en lenguaje simple. Si usás un término técnico, agregá una explicación breve entre paréntesis.
- Cuando propongas algo, dame tu recomendación y explicá por qué. No me listes opciones sin recomendar una.
- Si algo sale mal, explicá qué pasó, por qué, y cómo lo vas a resolver. No me tires el error técnico solo.
- Antes de hacer cambios grandes, explicá qué vas a hacer y esperá confirmación.
- **Verificá antes de afirmar.** Cualquier afirmación sobre cómo se comporta una herramienta, una librería, una API o el código del fork tiene que estar verificada contra el código o la documentación oficial antes de decirla. Si no está verificada, decilo con esas palabras y no la presentes como un hecho. "Creo que funciona así pero no lo verifiqué" es una respuesta aceptable. Una suposición presentada como hecho, no.
- Marcá el grado de confianza cuando no sea obvio: verificado, inferencia, o suposición.
- Usá español rioplatense (vos/tenés, no tú/tienes).
- Sin emojis.

---

# Proyecto

**Nombre:** Sistema Operativo para Negocios de Servicios Digitales
**Descripción:** CRM con bandeja de chat unificada, automatizaciones y agente de IA para un negocio de servicios digitales. Centraliza los mensajes de Instagram y WhatsApp, identifica al mismo contacto entre canales, y da seguimiento automático a los leads que no agendan.
**Modo:** single-tenant (un solo negocio), aunque la arquitectura del fork es multi-tenant y se conserva intacta.

## Etapas

- **Etapa 1 — Sistema Operativo Base.** Fase 1: Foundation, Canales y CRM ← **ACTUAL**. Fase 2: Comunicación y Automatizaciones. Fase 3: Agente IA, Analytics y Pulido.
- Etapa 2 — Publicación de contenido, email bidireccional, roles custom, Meta Ads.
- Etapa 3 — Agente IA integral, Fathom, conector MCP.
- Etapa 4 (opcional) — Agendamiento, ventas, pipeline comercial.

El plano de la fase actual está en `docs/requerimientos-fase1.md`. Leelo antes de construir.

---

# Base del proyecto

**Fork de:** [ZernFlow](https://github.com/zernio-dev/zernflow), licencia MIT.

**Lo que el fork YA trae. No lo reconstruyas, verificalo y extendelo:**

- Autenticación con Supabase Auth y trigger de auto-creación de workspace
- Flow builder visual con `@xyflow/react`, motor recursivo con profundidad máxima 50
- Bandeja con lista de conversaciones y panel de mensajes
- CRM con tags y custom fields (6 tipos: text, number, boolean, date, url, email)
- Secuencias con auto-pausa cuando el contacto responde
- Team management con invitaciones que expiran a los 7 días
- Difusiones (tabla y UI; no se usan en Etapa 1 pero se conservan)
- Ledger de idempotencia de webhooks (`webhook_events`)
- Versionado de flows al publicar
- Realtime en `conversations` y `messages`
- Cliente de Zernio con webhooks y adaptadores por plataforma, con tests

**Datos reales del fork, verificados en el código (los README dicen otra cosa):**

- **24 tablas** en 16 archivos de migración
- **16 tipos de nodo** en `lib/flow-engine/types.ts`, no 17 ni 18. Los otros conteos separan "Add Tag / Remove Tag" y "Subscribe / Unsubscribe", que en el código son un solo tipo con un parámetro
- Tailwind es **v4** (`^4.1.18`), no v3
- El fork **no usa Zod**. Si hace falta validación de esquemas, adoptamos Zod 4

**Patterns del fork que hay que respetar:**

- Auth: Supabase SSR con cookies httpOnly
- Estado: Server Components más hooks. No hay store global (ni Redux ni Zustand)
- API: webhooks en API Routes (`app/api/`), mutaciones de UI en Server Actions
- Datos: `@supabase/supabase-js` con RLS. Service Role solo en servidor, cuando hace falta saltear RLS
- Estilos: clases de Tailwind v4. Sin CSS modules ni styled-components
- Motor de flujos: `lib/flow-engine/engine.ts`, nodos en `lib/flow-engine/nodes/`, abstracción de plataforma en `lib/flow-engine/platform-adapter.ts`

---

# Stack

- **Base de datos, auth, secrets y storage:** Supabase (plan Pro)
- **Frontend:** Next.js 16.1.6 con React 19.2.4 y App Router
- **Estilos:** Tailwind CSS 4.1.18
- **Flow builder:** `@xyflow/react` 12.10
- **IA:** Vercel AI SDK v6, con BYOK (las claves las pone el usuario)
- **Canales:** Zernio, con la API oficial de Meta, para Instagram y WhatsApp
- **Email saliente:** Resend
- **Hosting:** Railway, **un solo servicio**
- **Versionado:** GitHub
- **Testing:** Vitest

**NO forman parte del stack:** Evolution API, Baileys. WhatsApp va por API oficial sobre un número dedicado.

---

# Comandos

```bash
npm install          # instalar dependencias
npm run dev          # correr en desarrollo
npm run build        # build de producción
npm run lint         # linter
npm test             # tests con Vitest
```

---

# Migraciones

**El camino oficial para aplicar migraciones en este proyecto es el CLI de Supabase:** `supabase db push`. El repo trae `supabase/config.toml`, así que funciona sin configuración extra. El CLI registra cada migración aplicada en `supabase_migrations.schema_migrations`, y ese registro es lo que impide que algo se aplique dos veces.

**Las migraciones existentes del fork (00001 a 00016) NO son idempotentes.** `00001_initial_schema.sql` tiene 18 `create table` sin `IF NOT EXISTS`. Correrlas dos veces falla. Por eso el registro del CLI no es un detalle: es la protección.

**Sobre `ALL_MIGRATIONS.sql`:** este archivo viene con el fork y **se queda donde está**, dentro de `supabase/migrations/`. Es el contenido de los 16 archivos numerados consolidado en uno solo. El CLI no lo aplica: solo aplica archivos cuyo nombre cumple el patrón `<version>_nombre.sql` (dígitos, guion bajo, nombre) y saltea el resto con un aviso `Skipping migration...`. `ALL_MIGRATIONS.sql` no empieza con dígitos, así que queda fuera.

El riesgo de ese archivo es humano, no del CLI: si alguna vez se aplican migraciones a mano en el SQL Editor, se usa `ALL_MIGRATIONS.sql` **o** los 16 numerados, nunca los dos. Aplicar los dos duplica todo y rompe la base.

Reglas:

- Migraciones nuevas y re-aplicaciones: siempre con `supabase db push`. Nunca pegando SQL en el editor de Supabase salvo que yo lo pida explícitamente.
- **Nunca re-aplicar las migraciones 00001 a 00016 "para verificar".** Para verificar el estado de la base, consultar la base (contar tablas, listar policies), no re-correr migraciones.
- **No mover ni borrar archivos que vienen del fork** sin una razón concreta. Cada archivo movido es una diferencia más al traer actualizaciones de upstream.
- Si una migración falla a mitad de camino, **no la re-corras**: resetear la base y arrancar de nuevo, o aplicar solo la parte que faltó.
- **Las migraciones nuevas (00017 en adelante) SÍ tienen que ser idempotentes:** `IF NOT EXISTS`, bloques `DO $$ ... END $$` con checks previos, y `ADD COLUMN IF NOT EXISTS`.
- Cada cambio de base de datos va en su propia migración numerada. Nunca editar una migración ya aplicada.

---

# Reglas del proyecto

## Seguridad

- **RLS habilitado en todas las tablas**, sin excepción.
- **Scope de leads (restricción dura):** un Member solo lee y edita los contactos y conversaciones donde es `setter_id`, `vendedor_id` o `assigned_to`. Owner y Admin ven todo. Se aplica **en la base con RLS**, no con un filtro en la interfaz. Se prueba con una consulta directa a la API usando el token de un Member, no solo mirando la pantalla.
- **Realtime tiene que respetar el scope de leads.** Si la configuración no lo garantiza, filtrar del lado del servidor antes de emitir.
- **Secrets en Supabase Vault**, nunca hardcodeados ni en variables de entorno del frontend.
- **Problema heredado a corregir en el Bloque 1:** la columna `workspaces.late_api_key_encrypted` se llama "encrypted" pero **guarda la clave en texto plano**. El código la lee y la pasa directo al cliente de la API, sin desencriptar. Lo mismo con `ai_api_key`. Hay que migrar los valores a Vault, apuntar todas las lecturas a Vault, y eliminar las columnas.
- **Nunca `select("*")` sobre `workspaces` ni `channels`** en una consulta que alimente un Client Component o una respuesta de API. Enumerar columnas con `WORKSPACE_PUBLIC_COLUMNS` o `CHANNEL_PUBLIC_COLUMNS` de `lib/safe-columns.ts`. Las dos tablas guardan secretos en columnas, y las props de un Client Component se serializan en el HTML: un `*` manda el secreto al navegador. Lo hacen cumplir el tipo (los Client Components usan `Omit<Row, secreto>`) y `lib/safe-columns.test.ts`.
- **Una sola resolución de workspace:** `lib/workspace.ts`. `getWorkspace()` en páginas, `getWorkspaceOrNull()` en API routes. Nunca reimplementar la consulta de membresía en una ruta: había cinco copias, todas con `.limit(1).single()` sin `order by`, y sin orden Postgres puede devolver un workspace distinto en cada llamada. Las guardas de rol van ahí, no por ruta.
- **Toda columna nueva cuyo nombre tenga `secret`, `token`, `key` o `password` como segmento** hay que registrarla en `lib/safe-columns.ts`, como prohibida (`SECRET_COLUMNS`) o como segura (`SAFE_LOOKING_COLUMNS`, con el motivo). El test lee las migraciones y falla si falta, diciendo qué migración la introdujo.
- Validación en servidor, no solo en cliente.
- Firma HMAC validada en todos los webhooks de Zernio antes de procesar.
- Service Role Key solo en servidor.
- Logs sin tokens, contraseñas ni claves.

## Datos

- **Soft delete** en `contacts`, `contact_notes`, `conversations`, `response_templates`. Retención de 30 días, después purga por cron. El `audit_log` nunca se borra.
- **Audit log** de todo cambio significativo: entidad, campos con valor anterior y nuevo, quién y cuándo.
- **Teléfonos normalizados a E.164 en el servidor**, no solo en el formulario. Sin esto la deduplicación entre canales falla.
- **Deduplicación de contactos** por teléfono normalizado o email. Nunca solo por nombre.
- **Las plantillas de WhatsApp son una entidad, no un texto.** El paso de secuencia referencia una plantilla por ID; nunca guarda el cuerpo como string libre.
- Snapshot de precio al momento de la venta (aplica en Etapa 4).

## Ventanas de mensajería

Cada canal tiene su propia ventana y se guarda **como configuración del canal**, no cableada en condicionales:

- **Instagram:** 24 horas desde el último mensaje del lead. Fuera de la ventana no se puede enviar. Excepción: respuesta privada a un comentario, hasta 7 días, una sola vez por comentario.
- **WhatsApp:** 24 horas, o 72 si el contacto llegó por un anuncio click-to-WhatsApp. Fuera de la ventana solo plantillas aprobadas por Meta, con costo.

El sistema valida la ventana **antes de intentar el envío**, y en las secuencias la valida **al dar de alta**, no al enviar.

## Calidad de código

- El sistema tiene que funcionar con la base de datos vacía: empty states claros en todas las pantallas.
- `.env.example` actualizado con cada variable nueva, con un comentario de qué es y dónde se obtiene.
- Nunca commitear `.env` con valores reales.
- Los datos de demo van en seeds separados de las migraciones de estructura.
- **Fijar la versión exacta de `@zernio/node`** (sin `^`). Es una librería 0.x y puede romper compatibilidad entre versiones menores.
- Agregar tests de lo nuevo y de lo que se toca. El fork tiene poca cobertura: 7 archivos de test para 23.000 líneas.

## Nomenclatura obligatoria en la interfaz

Hay dos cosas distintas que se llamarían "plantilla" y confundirlas genera errores caros:

- **"Respuestas rápidas"** — textos internos reutilizables que el operador inserta con "/" dentro de la ventana. Tabla `response_templates`.
- **"Plantillas de WhatsApp"** — mensajes aprobados por Meta para escribir fuera de la ventana de 24 horas. Tabla `whatsapp_templates`.

Nunca usar "plantilla" a secas en la UI.
