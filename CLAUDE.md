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

**Ese es el ÚNICO documento de requerimientos del proyecto.** No hay un plano por bloque ni por etapa: F1 a F39 viven ahí, con una sola numeración. Si aparece otro archivo de requerimientos en `docs/`, **está superado: hay que borrarlo, no consultarlo.** Hasta el 21 de septiembre de 2026 convivieron dos, con numeraciones distintas que no se podían comparar, y durante una semana se actualizó el equivocado. Hay un test que falla si aparece un segundo.

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

**Datos reales del fork (los README dicen otra cosa).**

**Toda afirmación de esta lista lleva contra qué se verificó y cuándo, y eso no es formalismo.** Acá decía "16 tipos de nodo, no 17 ni 18", marcado como verificado en el código, sin decir contra qué archivo. Era falso, corregía un dato del README que estaba bien, y **la marca de verificado impidió que alguien volviera a mirar durante seis días**. Un dato con fuente se refuta en diez segundos; un sello sin fuente solo se puede creer. Si no podés decir contra qué se verificó algo, sacale la marca en vez de inventarle una fuente.

- **24 tablas** en 16 archivos de migración. *Contra `supabase/migrations/00001` a `00016`, 22/09/2026.* Ese es el conteo **del fork** y no cambia nunca. El conteo **de hoy** vive en un solo lugar, `docs/requerimientos-fase1.md` §14c, y un test lo comprueba contra el repo
- **18 tipos de nodo.** *Contra el tipo `NodeType` de `lib/types/database.ts`, 22/09/2026.* **Corregido ese día. Antes decía 16**, y que los conteos mayores separaban "Add Tag / Remove Tag" y "Subscribe / Unsubscribe" que en el código serían un solo tipo con un parámetro. Es falso: `addTag` y `removeTag` son dos miembros distintos del tipo, y `subscribe` y `unsubscribe` también. El README decía 17 o 18; 18 era el correcto
- Tailwind es **v4** (`^4.1.18`), no v3. *Contra `package.json`, 22/09/2026.*
- El fork **no usa Zod**. *Contra `package.json`: cero apariciones, 22/09/2026.* Si hace falta validación de esquemas, adoptamos Zod 4

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
- **Instagram:** Zernio, con la API oficial de Meta
- **WhatsApp:** Evolution API autoalojado, sobre un número dedicado
- **Email saliente:** Resend
- **Hosting:** Railway, **varios servicios en un mismo proyecto**: la app Next.js, Evolution API, su PostgreSQL, y Redis si se confirma necesario. Railway factura por consumo de recursos, no por cantidad de servicios
- **Versionado:** GitHub
- **Testing:** Vitest

## Decisión de canal para WhatsApp (16 de septiembre de 2026)

**Camino principal: Evolution API.** El motivo es el modelo de seguimiento del negocio: los leads llegan por pauta y escriben primero, se califican, algunos llegan a una reunión, y después reciben seguimiento semanal o quincenal. Ese seguimiento cae fuera de la ventana de 24 horas de Meta, así que en la API oficial serían plantillas aprobadas con costo por mensaje y por lead.

**El procedimiento está en `docs/contingencia-whatsapp.md`.** Esta sección describe el riesgo y la decisión; qué hacer el día que el canal se caiga, en cualquiera de sus formas, está ahí y no acá.

**Plan B: API oficial de Meta vía Zernio.** Se activa si Meta bloquea el número. La verificación de negocio en Meta **no es requisito para arrancar**: un negocio sin verificar puede conectar un número y operar con un tope de 250 contactos únicos cada 24 horas, que para este negocio sobra. La migración son días, no semanas.

**Consecuencia que no es negociable:** el historial de mensajes tiene que vivir en la base local. Migrar sin historial no es migrar. Ver la sección de Datos.

**Dos bases de datos Postgres, y no son intercambiables:** Supabase guarda los datos del negocio; el PostgreSQL de Railway guarda el estado interno de Evolution, incluida la sesión de WhatsApp.

**Resuelto en F22, el 17 de septiembre de 2026:** Evolution firma cada entrega con un JWT HS256 derivado del `jwt_key` de la instancia, y el receptor lo verifica y falla cerrado, igual que el de Zernio. *Contra `webhook.controller.ts` de la 2.3.7, líneas 78 a 86 y 287 a 305; nuestro lado en `lib/evolution-webhook.ts`.* El mecanismo está en el código pero **no documentado**, así que subir de versión obliga a re-verificarlo: el recordatorio vive en el recuadro de `lib/evolution-version.mjs`.

---

# Comandos

```bash
npm install          # instalar dependencias
npm run dev          # correr en desarrollo
npm run build        # build de producción
npm run lint         # linter
npm test             # tests con Vitest, incluida la compuerta de cierre
npm run typecheck    # tsc sobre todo el proyecto; Vitest no chequea tipos
node scripts/commits-sin-subir.mjs   # cuántos commits hay sin subir y de cuándo es el más viejo
```

---

# Apertura y cierre de sesión

**Al abrir sesión** se corre `node scripts/commits-sin-subir.mjs` y se informa cuántos commits hay sin subir y de qué fecha es el más viejo. Si dice "No medido", se dice así, no como "no hay nada sin subir".

**Al cerrar sesión**, si `npm test` está verde, se sube y se verifica el despliegue en Railway: el despliegue activo tiene que mostrar el mensaje del commit subido, y `app.alomercadeo.com` tiene que responder. **Si no se sube, se escribe en `docs/estado-fase1.md` por qué y qué condición lo destraba.** Un "no subimos" sin condición de destrabe no se acepta.

La suite hace cumplir las dos cosas desde `scripts/compuerta-cierre.test.ts`: se pone en rojo si el commit sin subir más viejo tiene más de un día, y si `tsc` encuentra un error de tipos. **Un día y no cero** a propósito: con cero falla apenas se commitea, es ruido en medio de la sesión y termina desactivado.

**Por qué existe.** El 22 de septiembre de 2026, producción y el repositorio se desincronizaron dos veces. Hubo 19 commits sin subir desde el 21, y una rotación del secreto hizo que producción re-registrara el webhook con código viejo y le borrara un evento, sin error y sin aviso. Al subirlos, el build de Railway falló por un error de tipos que 211 tests en verde no habían visto. El relato está en `docs/estado-fase1.md`.

---

# Migraciones

**El camino oficial para aplicar migraciones en este proyecto es el CLI de Supabase:** `supabase db push`. El repo trae `supabase/config.toml`, así que funciona sin configuración extra. El CLI registra cada migración aplicada en `supabase_migrations.schema_migrations`, y ese registro es lo que impide que algo se aplique dos veces.

**Las migraciones existentes del fork (00001 a 00016) NO son idempotentes.** `00001_initial_schema.sql` tiene 18 `create table` sin `IF NOT EXISTS`. Correrlas dos veces falla. Por eso el registro del CLI no es un detalle: es la protección.

**Sobre `ALL_MIGRATIONS.sql`:** este archivo viene con el fork y **se queda donde está**, dentro de `supabase/migrations/`. Es el contenido de los 16 archivos numerados consolidado en uno solo. El CLI no lo aplica: solo aplica archivos cuyo nombre cumple el patrón `<version>_nombre.sql` (dígitos, guion bajo, nombre) y saltea el resto con un aviso `Skipping migration...`. `ALL_MIGRATIONS.sql` no empieza con dígitos, así que queda fuera.

El riesgo de ese archivo es humano, no del CLI: si alguna vez se aplican migraciones a mano en el SQL Editor, se usa `ALL_MIGRATIONS.sql` **o** los numerados, nunca los dos. Aplicar los dos duplica todo y rompe la base.

**Pero el archivo no es inerte: hay que mantenerlo.** `lib/platforms.test.ts:36` tiene un test que exige que `ALL_MIGRATIONS.sql` sea una copia fiel y en orden de cada migración numerada. Cada migración nueva se agrega al final del bundle, con el mismo formato de encabezado que las anteriores, o `npm test` falla. El test es deliberado: sin él, el archivo consolidado se desincroniza en silencio y alguien que lo aplique a mano termina con un esquema incompleto.

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
- **Problema heredado, CORREGIDO en el Bloque 1 (migración 00021).** El fork guardaba la clave de la API en `workspaces.late_api_key_encrypted`, una columna que decía "encrypted" y tenía el valor en texto plano, y lo mismo con `ai_api_key`. Los valores se migraron a Vault, las lecturas apuntan ahí, y **las dos columnas ya no existen**: verificado el 22 de septiembre de 2026 contra el esquema. Se conserva escrito porque explica por qué todas las claves pasan por `lib/vault.ts` y por qué no hay que volver a agregar una columna de clave a `workspaces`.
- Validación en servidor, no solo en cliente.
- Firma HMAC validada en todos los webhooks de Zernio antes de procesar.
- Service Role Key solo en servidor.
- Logs sin tokens, contraseñas ni claves.

## Datos

- **Soft delete** en `contacts` y `conversations`, que existen hoy, y en `contact_notes` y `response_templates` **cuando se construyan en el Bloque 3** (F30 y F36). Retención de 30 días, después purga por cron.
- **El `audit_log` nunca se borra.** Esa tabla tampoco existe todavía: se crea en F31, Bloque 3. La regla está escrita de antemano para que no se construya sin ella.
- **Audit log** de todo cambio significativo: entidad, campos con valor anterior y nuevo, quién y cuándo.
- **Teléfonos normalizados a E.164 en el servidor**, no solo en el formulario. Sin esto la deduplicación entre canales falla.
- **Deduplicación de contactos** por teléfono normalizado o email. Nunca solo por nombre.
- **Las plantillas de WhatsApp son una entidad, no un texto.** El paso de secuencia referencia una plantilla por ID; nunca guarda el cuerpo como string libre. Aplica en el plan B; ver Ventanas de mensajería.
- **El historial de mensajes vive en la base local. Requisito, no mejora.** El fork solo guarda los salientes: los entrantes los lee de la API del proveedor. Eso se cambia. Los entrantes se guardan en `messages` con `platform_message_id` único para idempotencia, y después del backfill inicial la base es la única fuente de verdad y el proveedor queda como transporte. Sin esto no hay migración posible al plan B, no hay agente de IA, no hay analíticas y no hay búsqueda en la bandeja. Decidir aparte qué pasa con los adjuntos: las URL de medios de Meta vencen, así que guardar solo el link deja el texto y borra las imágenes.
- Snapshot de precio al momento de la venta (aplica en Etapa 4).

## Ventanas de mensajería

Cada canal tiene su propia configuración y se guarda **como configuración del canal**, no cableada en condicionales.

**Instagram:** ventana de 24 horas desde el último mensaje del lead. Fuera de la ventana no se puede enviar. Excepción: respuesta privada a un comentario, hasta 7 días, una sola vez por comentario. El sistema valida la ventana **antes de intentar el envío**, y en las secuencias la valida **al dar de alta**, no al enviar.

**WhatsApp por Evolution API: no hay ventana.** El seguimiento del negocio es semanal o quincenal después de una reunión, así que una restricción de 24 horas prohibiría el trabajo, no lo ordenaría. En su lugar van seis reglas de seguridad de secuencia, todas configurables y aplicadas por el sistema, no por la memoria de nadie:

1. **Cortar con el silencio.** Después de N seguimientos sin respuesta (por defecto 3), la secuencia se detiene sola. Es la protección más importante: el que nunca contesta y sigue recibiendo mensajes es el que denuncia.
2. **Texto variable.** La misma frase exacta a muchos destinatarios es huella de difusión. Interpolar nombre y datos del contacto, y rotar entre variantes.
3. **Envíos espaciados.** Separación aleatoria entre mensajes de una misma cohorte. Nunca disparar todo junto.
4. **Horario comercial.** Nada de madrugada, respetando la zona horaria del contacto.
5. **Opt-out duro.** Un pedido de no contacto corta para siempre, sin posibilidad de forzar el envío.
6. **Proporción de respuesta como métrica de salud.** Si el porcentaje de seguimientos que reciben respuesta cae, es la alarma temprana: es una de las señales que mira Meta. Mejor que un tope arbitrario de mensajes.

**WhatsApp en el plan B (API oficial vía Zernio): sí hay ventana.** 24 horas, o 72 si el contacto llegó por un anuncio click-to-WhatsApp, y fuera de la ventana solo plantillas aprobadas por Meta, con costo por mensaje. El modelo de ventana y plantillas se conserva en el plano marcado como condicional: si se migra, el seguimiento semanal pasa a ser mensajes de plantilla con costo por envío y por lead.

## Calidad de código

- El sistema tiene que funcionar con la base de datos vacía: empty states claros en todas las pantallas.
- `.env.example` actualizado con cada variable nueva, con un comentario de qué es y dónde se obtiene.
- Nunca commitear `.env` con valores reales.
- Los datos de demo van en seeds separados de las migraciones de estructura.
- **Fijar la versión exacta de `@zernio/node`** (sin `^`). Es una librería 0.x y puede romper compatibilidad entre versiones menores.
- Agregar tests de lo nuevo y de lo que se toca. El fork traía poca cobertura: **7 archivos de test para 23.000 líneas al momento de forkear**. Hoy hay 21, y ese número sube con cada bloque: no lo copies acá, contalo.

## Verificación: toda comprobación negativa necesita un control positivo

Una prueba que dice "esto no debería pasar" no distingue entre *no pasó porque está bien protegido* y *no pasó porque nada llegó a ejecutarse*. En el Bloque 1 esa confusión apareció tres veces: un script con cuatro falsos verdes porque su sección destructiva borraba los datos de las secciones siguientes, una policy de UPDATE que afectaba cero filas y devolvía 204, y un verificador de Realtime que daba verde con la suscripción fría.

Las cuatro formas de aplicarlo:

- Un script de verificación nuevo se corre **antes** del arreglo y tiene que fallar. Un script que nunca falló no prueba nada.
- Toda comprobación negativa sobre un canal que puede estar frío lleva un canario: se prueba primero que la cañería entrega un evento propio, y se espera por condición, no con un `sleep` fijo.
- Toda restricción por rol lleva su contraparte afirmativa: si probás que un Member no puede, probá también que un manager sí puede.
- Cuando el control positivo falla, el veredicto es **"no concluyente"**, dicho con esas palabras. Nunca verde.

## Verificación: preguntá qué cambia el propio test

Esta es una familia distinta de la anterior y no se atrapa con un control positivo. Apareció en el Bloque 2, con `verify-evolution-webhook.mjs`: la comprobación del evento repetido mandaba un evento **válido**, y en `route.ts` el cierre de alertas ocurre **antes** del control de duplicados. Así que esa comprobación cerraba la condición que las comprobaciones de rechazo acababan de abrir. La lectura de la alerta la buscaba y no la encontraba.

Lo peor no fue el rojo, fue el verde de al lado: la comprobación siguiente afirmaba "un evento válido cerró la condición" mirando que no quedara ninguna abierta, cosa trivialmente cierta cuando nunca hubo una. Un verificador que altera el estado que está midiendo puede fabricar la condición que dice estar comprobando.

Un control positivo no lo habría detectado, porque el camino afirmativo funcionaba perfecto. Lo que lo detecta es otra pregunta:

- **Antes de escribir un paso de verificación, preguntarse qué efectos colaterales tiene sobre el estado que miden los pasos siguientes.** Un paso que parece de solo lectura —"mandar el mismo evento otra vez"— puede disparar un camino de escritura del lado del servidor.
- **Los pasos que preparan una condición y los que la leen van juntos, sin nada en el medio que pueda alterarla.** Si entre "provocar el rechazo" y "leer la alerta" hay cualquier otra entrega, el resultado no es atribuible.
- **Una comprobación que se cumple por ausencia necesita que la presencia esté probada antes.** "No queda ninguna abierta" solo significa algo si antes se comprobó que había una. Si el paso anterior falló, este dice "no concluyente".

## Nomenclatura obligatoria en la interfaz

Hay dos cosas distintas que se llamarían "plantilla" y confundirlas genera errores caros:

- **"Respuestas rápidas"** — textos internos reutilizables que el operador inserta con "/" dentro de la ventana. Tabla `response_templates`.
- **"Plantillas de WhatsApp"** — mensajes aprobados por Meta para escribir fuera de la ventana de 24 horas. Tabla `whatsapp_templates`.

Nunca usar "plantilla" a secas en la UI.
