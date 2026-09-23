# Requerimientos, Sistema Operativo para Negocios de Servicios Digitales

## Etapa 1, Fase 1: Foundation, Canales y CRM. Bloques 1 a 4

**Este es el único documento de requerimientos del proyecto.** Si aparece otro plano en `docs/`, en `Claude outputs/` o en cualquier otro lado, está superado por este y hay que borrarlo, no consultarlo. Las versiones anteriores las guarda git.

**Versión:** 2.0, regenerada tras el cambio de canal de WhatsApp
**Fecha:** 16 de septiembre de 2026
**Revisión:** 17 de septiembre de 2026, migración desde Pipedrive y decisión de Calendly
**Cliente:** negocio de servicios digitales (single-tenant)

> Este documento cubre la Fase 1 completa, de los bloques 1 a 4, y reemplaza a los dos planos que convivían hasta el 21 de septiembre de 2026. El Bloque 1 está construido, probado y publicado, y se conserva acá especificado porque el plano tiene que describir la fase entera y no solo lo que falta. El registro de lo construido está en `docs/estado-fase1.md`, y las decisiones con su razonamiento en los documentos del proyecto.

---

## 0. Qué cambió respecto de la versión anterior

Tres cosas, y ninguna es cosmética.

**WhatsApp ya no va por la API oficial de Meta.** Va por [Evolution API](https://github.com/EvolutionAPI/evolution-api) autoalojado en [Railway](https://railway.com). El motivo es el modelo de seguimiento del negocio: los leads llegan por pauta y escriben primero, se califican, algunos llegan a una reunión, y después reciben seguimiento semanal o quincenal. Ese seguimiento cae fuera de la ventana de 24 horas de Meta, así que en la API oficial serían plantillas aprobadas con costo por mensaje y por lead, todas las semanas. La API oficial vía [Zernio](https://zernio.com) queda como plan B, y se activa si Meta bloquea el número.

**El historial de mensajes pasa a vivir en la base local.** El fork solo guarda los mensajes que salen y lee los que entran desde la API del proveedor, cada vez. Eso se invierte: los entrantes se guardan, y la base pasa a ser la única fuente de verdad. Sin esto no hay migración posible al plan B, ni agente de IA, ni analíticas, ni búsqueda dentro de las conversaciones.

**La ventana de 24 horas deja de aplicar a WhatsApp.** Se conserva completa para Instagram, donde es una regla real de Meta. Para WhatsApp la reemplazan seis reglas de seguridad de secuencia, que protegen el número sin prohibir el trabajo. El modelo de ventana y plantillas no se borra: queda escrito y sin construir, para el plan B.

Todo lo que sigue se apoya en `docs/investigacion-evolution-api.md`, que respondió cinco preguntas contra el código fuente de Evolution 2.3.7, citando archivo y línea.

### Y qué cambió el 17 de septiembre

El proyecto arrancó como ejercicio de curso con un cliente de ejemplo. El cliente real usa dos herramientas que este plano no contemplaba: **Pipedrive** como CRM actual, con contactos y tratos que hay que migrar, y **Calendly** para agendar reuniones, sin ninguna conexión con el CRM.

Los dos exports se analizaron contra los datos reales, 526 personas y 517 tratos, y de ahí salieron tres cosas: **F38**, la migración desde Pipedrive, al final del Bloque 4; **diez columnas nuevas en `contacts`**, siete de estado comercial heredado y tres de estado de agenda; y la decisión de construir una **integración de solo lectura con Calendly en la Fase 2**, con una de sus definiciones tomada desde ahora porque condiciona cómo se arma el flujo. Todos los números que aparecen en esas secciones salen del análisis, no de estimaciones.

---


### Y qué cambió el 21 de septiembre

**Este documento pasó a ser el único plano del proyecto.** Hasta hoy convivían dos: `docs/requerimientos-fase1.md`, con las funcionalidades F1 a F20 de toda la Fase 1, congelado desde el 15 de septiembre; y `docs/requerimientos-bloques-2-3-4.md`, con F21 a F39, que era el que se venía actualizando. Los dos numeraban distinto, así que no se podían comparar, y nadie verificaba que el segundo contuviera todo lo que el primero diseñaba.

El `CLAUDE.md` del repo apuntaba al primero. O sea que la instrucción de "leé el plano antes de construir" señalaba el documento que no se estaba actualizando. Eso explica cómo se separaron.

**Lo que se hizo:** conciliar los dos en este archivo, que conserva el path `docs/requerimientos-fase1.md` porque es el que el `CLAUDE.md` ya nombra. El otro se borró en el mismo commit; git conserva su historia. Se trajo el Bloque 1 completo, que existía solo en el viejo, el modelo de ventana y plantillas, y la especificación del campo de atribución. La numeración F21 a F39 se conservó porque ya está citada en commits, tests y los otros documentos de `docs/`; renumerar habría invalidado todas esas referencias. La tabla de correspondencia de los números jubilados está en §16.

**La regla que sale de esto, y vale para todo el proyecto:** un solo documento por artefacto, en un solo path, siempre el mismo. Las versiones las guarda git, no el nombre del archivo. Un `-v2` en el nombre es una copia manual de algo que el repo ya hace bien, y es el mecanismo por el cual se actualizó el equivocado.

### Y qué cambió el 22 de septiembre

Tres decisiones sobre el modelo de contacto y la pantalla de integraciones. Se tomaron ese día y quedaron registradas en `docs/estado-fase1.md`; se escriben acá el 23 de septiembre, junto con la devolución de los criterios que perdió la conciliación (`docs/auditoria-conciliacion.md`).

**El handle es por canal, no por contacto.** Un contacto puede tener más de un handle, uno por canal, y ya existe dónde guardarlo: `contact_channels.platform_username`. Por eso `instagram_username` salió de `contacts` (F25 y §7.1), y con él las columnas de redes que el documento viejo ponía en el contacto.

**Facebook y X quedan fuera de F24.** La sección de canales se arma leyendo `integration_configs`, así que un canal agregado como fila aparece sin tocar código. Sumarlos después es cargar un registro.

**WhatsApp en F24 se reescribe para Evolution.** F24 muestra la conexión con Evolution. El estado de sesión y la reconexión con código QR se construyen en F32, en la pantalla de canales. Lo que el documento viejo pedía para la API oficial, el nombre para mostrar y su aprobación, es del plan B y no de esta pantalla.

### La objeción a Evolution, y por qué ya no aplica

El documento anterior argumentaba explícitamente **a favor** de la API oficial y **en contra** de Baileys, con dos motivos: que el número disponible era el personal de la dueña, y que la coexistencia apagaría la ubicación en tiempo real que ella usa como protocolo de seguridad.

**Los dos motivos se resolvieron con un número nuevo y dedicado.** No hay coexistencia con la línea personal y no hay conflicto con la ubicación en tiempo real. Queda escrito acá para que la objeción no vuelva a leerse como si estuviera sin responder.

El riesgo que sí se asumió —que WhatsApp bloquee el número— tiene su procedimiento en `docs/contingencia-whatsapp.md`, con tres escenarios, sus disparadores y las citas textuales de la documentación de Meta. Ese documento contiene un hallazgo que cambia el planteo y que hay que conocer antes de tomar cualquier decisión sobre este canal: **Meta sanciona al nivel de la cuenta y no del número**, así que conseguir otro número funciona hoy, cuando no existe ninguna WABA, y deja de funcionar el día que exista una.

## 1. Mapa de ruta de fases

| Etapa | Fase | Contenido | Estado |
|---|---|---|---|
| Etapa 1 | Fase 1 | Foundation, canales y CRM | **Actual.** Bloque 1 cerrado |
| Etapa 1 | Fase 2 | Comunicación y automatizaciones: secuencias, agente de respuesta, difusiones | Siguiente |
| Etapa 1 | Fase 3 | Agente de IA, analíticas y pulido | Después |
| Etapa 2 | | Publicación de contenido, email bidireccional, roles custom, Meta Ads | Propuesta aparte |
| Etapa 3 | | Agente de IA integral, Fathom, conector MCP | Propuesta aparte |
| Etapa 4 | | Agendamiento, ventas, pipeline comercial | Opcional |

**Lo que no se construye ahora pero el diseño ya contempla:**

El motor de secuencias de la Fase 2 va a consumir las reglas de seguridad y el estado de conversación que se definen acá. El agente de IA de la Fase 3 va a leer el historial de mensajes que se empieza a guardar en el Bloque 3. Y el plan B de WhatsApp reutiliza el modelo de ventana y plantillas que queda escrito sin construirse, sin necesidad de rediseñarlo.

---

## 2. Objetivo de esta fase y mapa de bloques

**Objetivo:** que un mensaje de un lead entre por Instagram o WhatsApp, cree o encuentre su contacto sin duplicarlo, quede guardado en la base del negocio, y sea gestionable desde una bandeja con las herramientas mínimas de CRM.

**Qué problema resuelve.** Hoy los mensajes de los leads viven repartidos entre dos aplicaciones distintas, nadie sabe quién atiende a quién, y los que no agendan no reciben seguimiento porque no hay sistema que lo recuerde. Esta fase construye el lugar donde esa información existe.

**Por qué va en este orden.** El Bloque 2 deja la cañería: sin un receptor de mensajes autenticado no hay nada que guardar. El Bloque 3 construye el camino de entrada completo, que es donde vive el riesgo real del proyecto. El Bloque 4 es la capa de uso diario, que solo tiene sentido cuando hay datos que mostrar.

### Bloques de ejecución

| Bloque | Día | Qué se construye | Contexto compartido |
|---|---|---|---|
| Bloque 1: Fork, despliegue y base | **Construido** | Fork y despliegue, migraciones 00017 a 00021, Supabase Vault, scope de leads por RLS, canal de Instagram | `workspaces`, `workspace_members`, `channels`, Vault |
| Bloque 2: Infraestructura de canal, email e integraciones | 1 a 2 | Despliegue de Evolution, receptor de webhook autenticado, email por Resend, pantalla de integraciones y BYOK de IA | `integration_configs`, Vault, Railway, `/settings/integrations` |
| Bloque 3: Modelo de contacto, ingesta y CRM | 3 a 4 | Modelo de contacto, identidad de canal, guardado de mensajes, adjuntos, deduplicación cross-canal, notas, ficha, borrado suave, registro de auditoría, asignación de setter y vendedor | `contacts`, `contact_channels`, `messages`, `conversations`, Supabase Storage |
| Bloque 4: Bandeja, herramientas y reglas de seguridad | 5 a 6 | Bandeja, filtros, respuestas rápidas, no contactar, reglas de seguridad de secuencia, importación CSV, migración desde Pipedrive, estado de sesión | Bandeja, `response_templates`, `channels` |
| Testing de fase | 7 | Testing completo, correcciones y colchón | |

**Nota sobre el tamaño del Bloque 3.** Es el más cargado de los tres. En el Bloque 1 aprendimos que un bloque demasiado grande obliga a partirlo a mitad de camino, con la memoria de la sesión ya gastada justo en el paso más delicado. Conviene planificar el Bloque 3 partido desde el principio. **La partición vigente es en tres sesiones y está en `docs/estado-fase1.md`**, con la línea de base de la medición: la que decía acá, en dos, dejaba afuera F30, F31 y F39.

**Nota sobre el número de WhatsApp.** El número dedicado no está conectado: no hay canal de WhatsApp con cuenta asociada, y eso se comprueba mirando la tabla `channels`, no el calendario. El plano está escrito para que el despliegue de Evolution y toda la ingesta se construyan y se prueben sin el número, con mensajes de prueba. La conexión del canal en vivo es un paso aparte, con su propio checklist, que se ejecuta cuando el número llegue.

---

## 3. Usuarios y roles

Construidos en el Bloque 1 y verificados con `scripts/verify-lead-scope.mjs`, 24 comprobaciones contra la API real (última corrida: 22/09/2026, 24 pasaron, 0 fallaron). Se documentan acá porque las funcionalidades nuevas los usan.

| Rol | Descripción | Puede hacer | No puede hacer |
|---|---|---|---|
| Owner | Dueño del negocio | Todo | |
| Admin | Encargado o socio | Todo lo operativo, configuración, integraciones, invitar, revocar y cambiar roles | Remover miembros, tocar el rol de un Owner, ascender a alguien a Owner |
| Member | Setter o vendedor | Ver y editar solo los contactos y conversaciones donde figura como setter, vendedor o agente asignado. Importar contactos desde una planilla (F37) | Entrar a configuración, integraciones o equipo, y ver cualquier lead ajeno |

**El Member puede importar contactos.** Agregado el 23 de septiembre de 2026: este plano lo omitía. Fuente: el BRD v2, §3, fila Member ("importar CSV"), según Marcos; el BRD no está en el repo. El mismo texto está en la fila Member del §3 del plano en `ebc9702`, y eso sí está verificado. Lo que ve después de importar es un hueco abierto: ver §15.

**Rol por defecto del primer usuario:** el primero que se registra queda como Owner de su propio espacio de trabajo, por un mecanismo automático que ya trae el proyecto base.

**Cómo se suman usuarios nuevos:** por invitación desde la pantalla de equipo. Hoy el link de invitación se copia a mano; con el envío de correo del Bloque 2 pasa a llegar por email.

**Cómo se aplica el alcance por rol.** Un Member solo ve sus leads, y eso se hace cumplir en la base de datos, no con un filtro en la pantalla. En simple: aunque alguien consulte los datos por fuera de la interfaz, la base le devuelve solo lo suyo. Está construido y verificado con `scripts/verify-lead-scope.mjs`: 24 comprobaciones contra la API real, no contra la pantalla (última corrida: 22/09/2026).

---

## 4. Alcance específico de esta fase

### 4.1 Despliegue de Evolution API

**Qué hace:** deja corriendo en Railway el servicio que va a manejar WhatsApp, con su base de datos propia, configurado de forma segura y con la versión fijada.

**Hasta dónde llega:** el servicio desplegado y accesible desde la aplicación, con una instancia creada y sin número vinculado, y con el aviso de mensajes nuevos apuntando a nuestro receptor.

**Qué NO hace en esta fase:** no vincula el número, no escanea ningún código QR, no manda ni recibe mensajes reales.

**Dónde va lo que queda afuera:** la conexión del número es un checklist operativo, ejecutable en cualquier momento después del Bloque 2, cuando el número esté disponible.

### 4.2 Receptor de mensajes entrantes de WhatsApp

**Qué hace:** recibe los avisos que manda Evolution cada vez que llega un mensaje, comprueba que vengan de nuestra instancia y no de un impostor, contesta rápido y deja el trabajo pesado para después.

**Hasta dónde llega:** autenticación, control de duplicados, acuse inmediato y encolado.

**Qué NO hace en esta fase:** no interpreta el contenido del mensaje ni toca los contactos.

**Dónde va lo que queda afuera:** el procesamiento del contenido es del Bloque 3.

### 4.3 Email saliente

**Qué hace:** manda los correos que el sistema necesita enviar, empezando por las invitaciones de equipo, usando [Resend](https://resend.com).

**Hasta dónde llega:** correos transaccionales, es decir, los que salen como consecuencia de una acción puntual.

**Qué NO hace en esta fase:** no manda secuencias ni campañas.

**Dónde va lo que queda afuera:** Fase 2.

### 4.4 Pantalla de configuración de integraciones y claves de IA

**Qué hace:** un solo lugar donde se conectan todos los servicios externos: los canales de mensajería, el correo, y los proveedores de inteligencia artificial.

**Hasta dónde llega:** guardar las claves de forma segura, mostrar el estado de cada conexión, y permitir conectar y desconectar.

**Qué NO hace en esta fase:** no configura TikTok, YouTube ni LinkedIn.

**Dónde va lo que queda afuera:** Etapa 2. La estructura queda preparada para que agregarlos sea cargar un registro, no cambiar la base de datos.

### 4.5 Modelo de contacto extendido

**Qué hace:** agrega al contacto todos los datos que el negocio necesita: teléfono, país, redes, temperatura del lead, fecha del próximo seguimiento, atribución de dónde vino.

**Hasta dónde llega:** los campos, su normalización y sus índices.

**Qué cambia respecto del plano anterior:** el teléfono deja de ser obligatorio. WhatsApp está migrando a un esquema donde el identificador del contacto puede no contener el número, y si el modelo lo exige, esos leads se pierden o entran con datos inventados.

### 4.6 Identidad de canal y reconciliación de teléfonos

**Qué hace:** guarda cómo llegó cada contacto por cada canal, y resuelve después el teléfono de los que entraron sin él.

**Hasta dónde llega:** la marca visible, las tres vías de reconciliación y la fusión con confirmación humana.

**Qué NO hace en esta fase:** no fusiona contactos automáticamente. La fusión siempre la confirma una persona, porque deshacerla es caro.

### 4.7 Guardado de mensajes entrantes

**Qué hace:** cada mensaje que llega queda guardado en la base del negocio, con su archivo adjunto descargado.

**Hasta dónde llega:** guardar lo que entra de ahora en más.

**Qué NO hace en esta fase:** no importa el historial previo del número, porque el número es nuevo y no tiene historial.

**Dónde va lo que queda afuera:** la capacidad de importar historial queda diseñada para poder usarse más adelante, si alguna vez se conecta un número con conversaciones anteriores.

> **Regla dura: el número no se vincula hasta que F27 y F32 estén construidas y probadas.**
>
> No es una recomendación ni una preferencia de orden. El receptor del Bloque 2 autentica el aviso, controla que no esté repetido, responde el acuse y **descarta el contenido**, porque guardarlo es justamente lo que construye F27. Si el número se vincula antes, cada mensaje real que llegue se pierde: el receptor responde que todo salió bien, Evolution da la entrega por exitosa y no reintenta, no se registra ningún error y no se dispara ninguna alerta. El único síntoma serían conversaciones con leads que nunca existieron, descubiertas semanas después.
>
> Queda escrito con el motivo porque dentro de tres semanas, con el número ya en la mano, "probemos que ande" va a sonar razonable. La prueba de que el canal anda se hace con avisos de prueba firmados, que es exactamente lo que verifica el Bloque 2, y no necesita un número real.
>
> **Y F32 es la otra mitad de la compuerta, que faltaba hasta el 22 de septiembre de 2026.**
>
> F27 resuelve que el mensaje se guarde. F32 —estado de sesión y reconexión— resuelve que alguien se entere de que dejó de llegar y pueda volver a vincular. Sin ella queda una ventana con esta forma: la sesión de WhatsApp se cae, **la bandeja se ve exactamente igual que un día tranquilo**, y lo que entró mientras tanto no se recupera de ningún lado, porque Evolution no guarda lo que no pudo entregar.
>
> F39 ayuda y no alcanza: **detectar no es reconectar.** F39 abre una condición cuando el canal se queda callado; sin F32 no hay forma de volver a vincular desde la interfaz, así que la alerta avisa de algo que nadie puede arreglar sin entrar al servidor.
>
> **La consecuencia: F32 está en el Bloque 4, después de F27.** O se adelantaba al Bloque 3, o el número no se vincula hasta que el Bloque 4 cierre.
>
> ### Decidido el 22 de septiembre de 2026: F32 se queda en el Bloque 4
>
> **El número se vincula cuando el Bloque 4 cierre.** Los dos motivos, y el segundo es el que decide:
>
> **Uno. Vincular el número no es prender un interruptor: es migrar el canal vivo del negocio.** Hay leads en curso con el número actual y la pauta apunta a alguno. Eso se hace una vez, y hacia una bandeja donde se pueda trabajar. Al cerrar el Bloque 3 esa bandeja no existe: F34 (no contactar), F35 (bandeja y filtros), F36 (respuestas rápidas) y F40 (ventana de conversación) son **todas del Bloque 4**. Adelantar F32 compraría vincular unos días antes hacia una lista pelada.
>
> **Dos, y este no estaba en ninguna de las dos opciones que se evaluaron: adelantar F32 destruye la medición del Bloque 3.** El Bloque 3 es el que se va a medir para tener un número real de ritmo, en vez de una proyección que hoy se apoya en 1,5 días de avance registrado sobre los 7 de la fase. Ese 1,5 es el progreso hecho, no la duración de ningún bloque: el Bloque 3 está estimado en 2 días, los de la tabla de bloques. No se pueden comparar dos días planificados contra un bloque al que se le acaba de sumar una funcionalidad. El costo de adelantar F32 no es solo el trabajo de F32: es perder la única medición limpia que va a haber en toda la fase.
>
> **El costo aceptado, sin maquillarlo:** Evolution queda desplegado y sin usar durante dos bloques. Es bajo porque Railway factura por consumo de recursos, no por servicio levantado. Lo que se paga es que **el canal esté listo antes que el sistema**, y ese es el orden correcto: lo contrario sería un sistema listo esperando un canal, que es la forma de que alguien vincule el número "para probar".
>
> Lo no negociable sigue siendo la compuerta: con F27 o F32 sin construir, vincular el número es aceptar perder mensajes sin enterarse.
>
> **F33 no entra en esta compuerta, y conviene que quede escrito para que nadie lo "arregle" moviéndola.** Las seis reglas de seguridad de secuencia protegen contra los envíos automáticos salientes, y el motor de secuencias es de la Fase 2, que va después del Bloque 4. Un número vinculado sin F33 no corre riesgo mientras nada mande secuencias. El orden actual ya es el correcto.

### 4.8 Reglas de seguridad de secuencia

**Qué hace:** deja configuradas y aplicadas por el sistema las seis reglas que protegen el número de WhatsApp de un bloqueo.

**Hasta dónde llega:** la configuración y los mecanismos que la hacen cumplir.

**Qué NO hace en esta fase:** no construye las secuencias en sí.

**Dónde va lo que queda afuera:** el motor de secuencias es Fase 2. Acá se construyen las barandas que ese motor va a respetar.

### 4.9 Ventana de conversación

**Instagram:** se construye completa. 24 horas desde el último mensaje del lead, con la excepción de la respuesta privada a un comentario, que llega hasta 7 días y una sola vez por comentario.

**WhatsApp:** no aplica en el camino principal. El modelo queda escrito para el plan B.

### 4.10 Estado de sesión del canal

**Qué hace:** muestra si WhatsApp está realmente conectado, y permite volver a vincularlo.

**Por qué existe:** cuando la sesión se cae, la bandeja deja de recibir mensajes y no hay ningún síntoma. Se ve exactamente igual que un día tranquilo.

### 4.11 Herramientas de CRM en la bandeja

**Qué hace:** filtros, respuestas rápidas reutilizables, marca de "no contactar" e importación de contactos desde una planilla.

**Qué NO hace en esta fase:** no incluye respuestas automáticas ni agente de IA.

**Dónde va lo que queda afuera:** Fases 2 y 3.

---


### 4.12 Base ya construida en el Bloque 1

Este tramo no es alcance por construir: es lo que ya está hecho y no hay que reconstruir. Se conserva acá porque hasta hoy vivía solo en el documento viejo, y sin él el plano no describe la fase completa.

#### 4.12.1 Fork y deploy de ZernFlow

- **Qué hace**: forkear el repositorio, ejecutar las **16 migraciones que trae el fork** en un proyecto de Supabase, desplegar en Railway y verificar que todo funcione.
- **Hasta dónde llega**: app corriendo en Railway con HTTPS, base de datos con las **24 tablas que trae el fork**, autenticación funcional, pantallas cargando.
- **Qué NO hace**: no se modifican las pantallas existentes (eso es de los bloques siguientes). No hay optimizaciones de performance.

#### 4.12.2 Supabase Vault y migración de claves en texto plano

- **Qué hace**: habilitar la extensión Vault para almacenar API keys con AES-256, crear las funciones helper, **y migrar las claves que el fork guarda en texto plano**.
- **Hasta dónde llega**: Vault funcional con `store_secret`, `read_secret` y `delete_secret`. Acceso restringido por RLS. Las columnas `workspaces.late_api_key_encrypted` y `workspaces.ai_api_key` vaciadas y eliminadas, con sus valores movidos a Vault y todas las lecturas del código apuntando a Vault.
- **Por qué es Fase 1 y no Fase 2**: la columna se llama `late_api_key_encrypted` pero el valor **no está encriptado**: el código la lee y la pasa directo al cliente de la API, sin desencriptar. Dejarla así mientras el sistema opera con datos reales es una exposición innecesaria.
- **Qué NO hace**: no hay rotación automática de keys (es manual desde la UI).

#### 4.12.3 Roles, workspaces y scope de leads

- **Qué hace**: verificar que roles y workspaces de ZernFlow funcionan. **Agregar el scope duro de leads por RLS**: un Member solo ve y edita los contactos y conversaciones donde es setter, vendedor o agente asignado.
- **Hasta dónde llega**: roles funcionales, workspace creado al registrarse, invitaciones con expiración de 7 días, RLS de scope aplicada en `contacts` y `conversations`, **y respetada también por las suscripciones de Realtime**.
- **Qué NO hace**: no se crean roles custom configurables ni gestión multi-workspace.

#### 4.12.4 Instagram vía Zernio

- **Qué hace**: verificar y asegurar que la integración existente con Zernio funciona: DMs, comentarios y story replies. Usa la 1ª de las 2 cuentas gratuitas de Zernio.
- **Hasta dónde llega**: mensajes entrantes y salientes funcionando, vinculados al contacto y la conversación correctos.
- **Qué NO hace**: no detecta nuevos seguidores (limitación de la API de Instagram). No implementa lógica proactiva de ventana más allá de mostrar el estado (ver 4.6c).


### 4.12b Modelo de ventana y plantillas de WhatsApp, escrito y sin construir

**Qué es:** el modelo que hace ejecutable el plan B. No se construye en esta fase, porque con Evolution no hay ventana ni plantillas. Se conserva especificado para que migrar sea configurar y no rediseñar.

**Por qué no se borra:** todo el riesgo aceptado al elegir Evolution descansa en que el plan B sea ejecutable. Un plan B sin modelo de datos no es un plan. Y hay una parte que **no se puede postergar**: ver la decisión transversal sobre plantillas en §14, porque si el paso de secuencia de la Fase 2 guarda el cuerpo del mensaje como texto libre, migrar obliga a reescribir el motor de secuencias en vez de agregar una tabla.

**Dónde está la especificación:** §5, apéndice del plan B, al final de las funcionalidades.

## 5. Funcionalidades y criterios de aceptación

### Bloque 1: Fork, deploy y foundation

#### F1: Fork y deploy de ZernFlow

**Descripción**: forkear el repositorio, configurar Railway y Supabase, ejecutar las **16 migraciones del fork** y verificar que la aplicación arranca.

**Estado: construido y publicado** (Bloque 1, 16 de septiembre de 2026).

**Criterios de aceptación**:

- [ ] Repositorio forkeado desde `https://github.com/zernio-dev/zernflow` y clonado
- [ ] Proyecto Railway creado con **un solo servicio**: la app Next.js
- [ ] Proyecto Supabase creado con plan Pro
- [ ] Las **16 migraciones del fork** ejecutadas sin errores, **24 tablas creadas**
- [ ] Variables de entorno configuradas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`
- [ ] **La versión de `@zernio/node` está fijada exacta** (no con `^`): una librería 0.x puede romper compatibilidad entre versiones menores
- [ ] La app carga y permite registrarse
- [ ] Al registrarse se crea un workspace con el usuario como Owner
- [ ] Las pantallas existentes cargan sin errores (dashboard, inbox, contacts, flows, sequences, settings)

#### F2: Supabase Vault y migración de claves

**Descripción**: habilitar Vault, crear las funciones helper, y mover a Vault las claves que hoy están en texto plano.

**Estado: construido y publicado** (Bloque 1, 16 de septiembre de 2026).

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

**Estado: construido y publicado** (Bloque 1, 16 de septiembre de 2026).

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

**Estado: construido y publicado** (Bloque 1, 16 de septiembre de 2026).

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

**Estado: eliminado de la Fase 1** (decidido el 16 de septiembre de 2026). No se construye. El motivo está abajo.

TikTok no se conecta como canal de bandeja. Zernio no entrega sus DMs ni comentarios por webhook, y la API de mensajes de TikTok no permite que el negocio inicie conversaciones. No hay criterios de aceptación de TikTok en esta fase. Entra en Etapa 2 como canal de publicación, usando la **3ª cuenta de Zernio ($6/mes)**, porque la 2ª la ocupa WhatsApp.

### Bloque 2: Infraestructura de canal, email e integraciones

#### F21: Despliegue de Evolution API en Railway

**Descripción:** dejar corriendo el servicio de WhatsApp, configurado de forma segura, sin vincular todavía ningún número.

**Estado: construido y verificado** (17 de septiembre de 2026, Evolution 2.3.7). Instancia `alomercadeo-ventas` creada, webhook registrado y leído de vuelta, **sin ningún número vinculado**. El procedimiento reproducible está en `docs/despliegue-evolution.md`, y `verify-evolution-deploy.mjs` pasa.

**Lo que destrabó marcarla cumplida no fue el despliegue, que estaba hecho desde el 17, sino el criterio del log.** "Ningún log escribe el cuerpo crudo" se cumplía porque alguien lo había leído, y eso es de la misma familia que el secreto de firma de Zernio, que se imprimió en pantalla porque el endpoint lo devuelve sin avisar. Una defensa que depende de que alguien se acuerde ya falló una vez en este proyecto. Ahora lo sostiene `lib/evolution-log-crudo.test.ts`, probado en rojo con un log del cuerpo puesto a propósito.

**Criterios de aceptación:**

- [x] Servicio desplegado con la imagen fijada en `evoapicloud/evolution-api:v2.3.7`, nunca en `latest`. El tag `latest` apunta hoy a una versión cuyo identificador no coincide con ninguna publicación oficial etiquetada
- [x] Dos servicios, no tres: Evolution y su PostgreSQL. Se configura `CACHE_LOCAL_ENABLED=true` y `CACHE_REDIS_ENABLED=false`. Redis es solo caché de rendimiento y no hace falta
- [x] `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false`. **Se pone igual, pero no protege nada: ver el hallazgo abajo.** La protección real del token de la instancia es la regla operativa de nunca registrar el cuerpo crudo de un aviso de Evolution
- [x] **Ningún log escribe el cuerpo crudo de un aviso de Evolution.** No es una recomendación de higiene: es la única defensa que existe para ese token, porque viaja en el cuerpo de cada aviso y no hay forma de apagarlo
- [x] `WEBHOOK_GLOBAL_ENABLED=false`. El aviso global no manda datos de autenticación, así que no se puede verificar
- [x] La clave de la instancia y el secreto de los avisos se guardan en Supabase Vault, nunca en variables de entorno de la aplicación
- [x] Instancia creada con sincronización de historial activada y grupos ignorados
- [x] Aviso de mensajes configurado por instancia, incluyendo el dato de autenticación
- [x] El archivo `.env.example` documenta cada variable nueva, con qué es y dónde se consigue
- [x] La documentación de despliegue queda en `docs/despliegue-evolution.md`, con pasos reproducibles

> **Hallazgo del 17 de septiembre de 2026: `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` no hace lo que este criterio decía.**
>
> El criterio afirmaba que con el valor por defecto Evolution incluye la clave de la instancia en cada aviso, y que ponerla en `false` lo evitaba. **La primera mitad es cierta; la segunda es falsa.**
>
> **Medido contra nuestro propio despliegue, con la variable en `false`:** `GET /instance/fetchInstances` devuelve igual el campo `token` con el valor real. Y en el código de la 2.3.7, `emit()` arma el cuerpo del webhook con `apikey: apiKey` **sin ninguna condición**: no está atado a esta variable ni a ninguna otra. El token viaja en el cuerpo de cada aviso, se ponga lo que se ponga acá.
>
> **Con su control positivo**, porque sin él el resultado no era atribuible: se confirmó en Railway que la variable existe y dice `false`, escrita así. Eso descarta la otra explicación posible, que era que la variable nunca hubiera llegado al contenedor. Se lee en `env.config.ts` y no se consume en ese camino.
>
> **Por qué el criterio se corrige y no se borra.** Poner la variable en `false` cuesta cero, es lo que dice la documentación de Evolution, y una versión futura puede empezar a consumirla. Lo que no se puede es **contarla como defensa**, que es exactamente lo que hacía este criterio.
>
> **Por qué esto importa más que un error de redacción.** F21 está dada por cumplida, y un criterio de aceptación satisfecho sobre una premisa falsa es el que alguien relee el día que redespliega Evolution, para concluir que el token está protegido. El criterio decía la verdad sobre una variable y mentía sobre una defensa.
>
> El detalle completo, con las citas al código de la 2.3.7, está en `docs/despliegue-evolution.md` §3 y en `docs/investigacion-evolution-api.md`.

#### F22: Receptor de mensajes entrantes, autenticado

**Descripción:** la puerta por donde entran los mensajes de WhatsApp al sistema.

**Estado: construido y probado** (16 y 17 de septiembre de 2026). 28 tests.

**Criterios de aceptación:**

- [x] Ruta nueva en `app/api/webhooks/evolution/`
- [x] Verificación del dato de autenticación que manda Evolution, fijando el algoritmo esperado y usando el secreto guardado en Vault. Sin autenticación válida, se rechaza
- [x] Procedimiento de cambio de secreto documentado y soportado: durante el cambio se aceptan el secreto viejo y el nuevo. Un rechazo de autenticación cancela los reintentos de Evolution y el mensaje se pierde para siempre, así que un cambio mal hecho pierde mensajes en silencio
- [x] Alerta ante cualquier rechazo, con lo que significa cada una escrito en la pantalla: en el rechazo de autenticación, cada ocurrencia es un mensaje de un lead que se perdió; en la instancia desconocida todavía no se perdió ninguno, y lo que se muestra es el plazo que queda para corregir
- [x] Nunca se registra en los logs el contenido completo del aviso, porque incluye credenciales
- [x] Control de duplicados reusando el registro de eventos que ya existe
- [ ] La idempotencia por `webhook_events` funciona igual para los dos canales (devuelto el 23/09/2026, auditoría #5)
- [x] Responde con acuse inmediato antes de procesar. El mecanismo de reintentos de Evolution queda bloqueado mientras espera
- [x] Tests: autenticación válida, inválida, ausente, vencida, con algoritmo distinto, y evento repetido

**Criterios que salieron de la revisión del 17 de septiembre**, y que no estaban en la versión original de esta funcionalidad:

- [x] Un aviso para una instancia que no conocemos responde **servicio no disponible**, no un rechazo definitivo. La diferencia son los mensajes de una ventana de unos veinte minutos de reintentos, que es el tiempo que hay para corregir el nombre. El rechazo de autenticación **sí** sigue siendo definitivo, y a propósito: darle reintentos a algo indistinguible de una falsificación sería regalarle diez entregas por evento a quien esté probando
- [x] La condición de instancia desconocida **no se cierra sola**, solo a mano. El motivo está en 7.2 y no es una omisión
- [x] Esa condición no se actualiza más de una vez por minuto, porque se alcanza antes de autenticar y cualquiera puede provocar la escritura
- [x] El nombre de instancia se acota al guardarlo y se muestra delimitado: lo elige quien manda el aviso y termina en el dashboard
- [x] Las alertas sin espacio de trabajo no son legibles por la vía normal de permisos. Las muestra la pantalla comprobando el rol en el servidor
- [x] La versión de Evolution que el código espera vive en el repositorio, y hay una comprobación automática que falla si lo desplegado no coincide. Reemplaza al procedimiento escrito que dependía de que alguien leyera un documento antes de cambiar una versión

#### F23: Email saliente vía Resend

**Descripción:** correo transaccional para invitaciones y notificaciones del sistema.

**Estado: no construido** (verificado el 22 de septiembre de 2026: no hay dependencia de Resend en `package.json` ni código que la use).

**Criterios de aceptación:**

- [ ] La clave de Resend se guarda en Vault desde `/settings/integrations`
- [ ] Se envían las invitaciones de equipo
- [ ] Existe una única función de servidor para mandar notificaciones del sistema por correo, y recibe los destinatarios de forma explícita. Las alertas del sistema, los avisos de `webhook_alerts` y entre ellos el silencio del canal de F39, van a Owner y Admin; los avisos de una acción van a quien la hizo. Su primer uso son los avisos de `webhook_alerts`
- [ ] **Control positivo:** se inserta una alerta en `webhook_alerts` y llega el correo
- [ ] Techo contra el aluvión: como máximo un correo por tipo de aviso por hora. El aviso sigue registrado donde se originó; lo que se limita es el correo. **El valor es un supuesto inicial**, ajustable cuando haya datos de cuántos avisos llegan
- [ ] La lista de notificaciones es cerrada: una notificación nueva se escribe primero como criterio de la funcionalidad que la dispara, y usa la función de F23. Hoy son dos: los avisos de `webhook_alerts`, entre ellos la alerta de silencio de F39, y el fin de una importación en segundo plano de F37
- [ ] El remitente es el dominio verificado por el negocio en Resend
- [ ] Si falla un envío, se registra el error y se reintenta hasta 3 veces
- [ ] Los correos enviados quedan registrados para poder consultarlos
- [ ] Cierra una deuda del Bloque 1: la invitación deja de depender de copiar un link a mano

**Dependencia externa:** el criterio del remitente con dominio verificado, `notificaciones.alomercadeo.com`, no se cumple hasta que se carguen en Cloudflare los tres registros DNS del ticket. Hasta entonces no sale ningún correo con ese remitente, ni invitaciones ni notificaciones.

#### F24: Pantalla de integraciones y claves de IA

**Descripción:** el lugar donde se conectan todos los servicios externos.

**Estado: parcial** (23 de septiembre de 2026). Construida la pantalla, con la RLS y el Realtime de la tabla probados contra la base. Pantalla en `/dashboard/settings/integrations`, con `/settings/integrations` redirigiendo ahí, porque todas las pantallas viven bajo `/dashboard`. La tabla es la migración 00024, aplicada ese día. `scripts/verify-integration-configs.mjs` pasó 5 de 5: un Member no lee la tabla ni recibe el evento de Realtime, y un Admin de prueba sí, que es la contraparte y el canario. **Detección por operación fallida: solo los envíos por Zernio** (bandeja, flujos y secuencias). Resend y la IA no tienen operaciones todavía: su conexión llega con F23 y con la Fase 2. **Falta, y por eso sigue parcial:** el estado del registro del webhook de Zernio en la sección de canales, que no se construyó; y reemplazar la ruta heredada que borra el canal en cascada (el criterio de desconectar sin borrar), para recién ahí volver a habilitar el botón de Canales. Antes decía: parcial, el fork cubría la carga y prueba de la clave de Zernio en `/dashboard/settings`.

**Criterios de aceptación:**

- [ ] Pantalla en `/settings/integrations`, solo para Owner y Admin, con el control de rol hecho en el servidor
- [ ] Pantalla accesible desde el sidebar, solo para Owner y Admin (devuelto el 23/09/2026, auditoría #20a)
- [ ] Sección de canales de mensajería, con Instagram vía Zernio y WhatsApp vía Evolution. El estado de sesión de WhatsApp y la reconexión con código QR son de F32. Facebook y X no van (decidido el 22 de septiembre de 2026, ver §0)
- [ ] Instagram (Zernio): API key, estado, conectar y desconectar (devuelto el 23/09/2026, auditoría #22b y #22c)
- [ ] Desconectar un canal pide confirmación explícita que nombra la cuenta y advierte que los mensajes entrantes dejan de llegar. Motivo: la cuenta conectada es la del negocio y recibe leads reales, y un clic no puede cortar el único canal vivo (agregado el 23/09/2026)
- [ ] Desconectar nunca borra conversaciones ni mensajes: marca el canal como inactivo y conserva el historial. Motivo: es una decisión cerrada del proyecto que el historial viva en la base local, y migrar sin historial no es migrar. La ruta heredada `DELETE /api/v1/channels/[channelId]`, que borra la fila del canal y en cascada sus conversaciones y mensajes, se reemplaza antes de volver a habilitar el botón de la pantalla de Canales, deshabilitado desde `5a9e2af` (agregado el 23/09/2026)
- [ ] Sección de correo, con Resend, su dominio verificado y su estado (devuelto el 23/09/2026, auditoría #27b)
- [ ] Sección de proveedores de IA, con OpenAI, Anthropic y Google, cada uno con su clave y su modelo por defecto
- [ ] Todas las claves van a Vault. Ninguna viaja al navegador: la pantalla muestra "configurada" o "sin configurar" según exista el secreto, nunca su valor
- [ ] Cada integración es un registro con su tipo. Agregar una nueva en la Etapa 2 no requiere cambiar la base de datos
- [ ] Al guardar una clave se valida el formato, con largo mínimo y prefijo esperado donde corresponda
- [ ] El estado de cada integración se actualiza en tiempo real. Se detecta en dos momentos: al abrir la pantalla, cuando el servidor consulta a cada proveedor, y cuando una operación real falla por credenciales o por conexión (un envío por Zernio, un correo por Resend, una llamada a un proveedor de IA) (devuelto el 23/09/2026, auditoría #32)
- [ ] El estado se guarda en `integration_configs`, con estado (conectado, desconectado, sin verificar o sin configurar), `verificado_el` y `ultimo_error`, y llega a la pantalla abierta por Realtime, sin recargar
- [ ] "Sin verificar" significa que no se pudo preguntar, y nunca se muestra como "desconectado"
- [ ] **Control positivo:** con la pantalla abierta, se fuerza un fallo de credenciales y la tarjeta cambia sin recargar
- [ ] **Control negativo:** un Member suscrito a `integration_configs` no recibe el evento. Es la prueba que `scripts/verify-realtime-scope.mjs` hace para `conversations` y `messages`, repetida para esta tabla y con su canario: el mismo evento le tiene que llegar antes a un Owner suscrito, o el resultado es no concluyente
- [ ] **Estado del registro del webhook de Zernio, visible en la sección de canales:** si está registrado, contra qué URL, y cuándo se verificó por última vez. Se lee de `GET /v1/webhooks/settings`, que ya devuelve todo eso
- [ ] Ese estado nunca muestra el secreto de firma, que esa misma respuesta trae en texto plano. A lo sumo longitud y últimos cuatro caracteres, igual que el resto de las claves

> **De dónde sale este criterio, y por qué el arreglo es mostrar y no hacer explotar.**
>
> `ensureWebhookRegistered` corre dentro de un `try/catch` que solo escribe en la consola, en los dos lugares que lo llaman: `app/api/v1/channels/sync/route.ts:141` y `app/api/v1/channels/test-key/route.ts:74`. Los dos comentarios dicen "best-effort: a failure must not block". Verificado leyendo el código, no supuesto.
>
> Esa decisión es correcta y **no hay que revertirla**: que falle el registro del webhook no tiene por qué impedir guardar la clave ni sincronizar los canales. Hacer que el `try/catch` explote cambiaría una falla silenciosa por una pantalla rota, que es peor.
>
> El problema no es que no falle: es que **la pantalla informa que el canal se sincronizó bien mientras el webhook puede no haber quedado registrado**. A partir de ahí la bandeja deja de recibir y el síntoma es, otra vez, el mismo que el de un día tranquilo. El estado real existe y es consultable; simplemente no se muestra en ningún lado.
>
> Por eso el arreglo es mostrarlo. Es el tercer caso de la regla de la sección 14, el de la vigilancia por ausencia, y es el único de los tres que se corrige sin construir ningún mecanismo nuevo: el dato ya está, falta la pantalla.

> **El tiempo real del estado de las integraciones, decidido el 23 de septiembre de 2026.**
>
> **No hay tarea periódica, a propósito.** El estado se detecta cuando alguien mira, al abrir la pantalla, y cuando algo real falla. Detectar una caída cuando nadie mira es trabajo de una alerta, y para eso están F39 y `webhook_alerts`, no esta pantalla. Una tarea periódica además traería su propia prueba de vida, por la regla de §14, para vigilar algo que ya vigila otra funcionalidad. **El costo aceptado:** si una integración cambia en silencio con la pantalla abierta, el cambio no se ve hasta el próximo fallo real o la próxima recarga.
>
> **`integration_configs` no existe todavía** (verificado el 23 de septiembre de 2026: ninguna migración la crea). La crea F24, y para que el estado llegue por Realtime la tabla tiene que estar en la publicación `supabase_realtime`, como `conversations` y `messages`. Le aplica el mismo límite que `scripts/verify-realtime-scope.mjs` documenta para esas dos: los eventos de borrado no los filtra la RLS y le llegan a todo suscriptor, con la clave primaria y sin contenido.
>
> **Fuentes posibles, no verificadas.** Si Zernio o Resend avisan por webhook los cambios de estado de una cuenta o de un dominio, se suman como fuente de detección. **No está verificado que lo hagan:** no se leyó la documentación de ninguno de los dos para esto. Si lo hacen, entran como un tercer momento de detección, sin cambiar lo demás.

---

### Bloque 3: Modelo de contacto, ingesta y CRM

#### F25: Modelo de contacto extendido

**Descripción:** el contacto con todos los datos que el negocio necesita para trabajarlo.

**Estado: no construido** (verificado el 22 de septiembre de 2026: `contacts` solo tiene las columnas del fork más `setter_id` y `vendedor_id` de la 00017).

**Criterios de aceptación:**

- [ ] Se agregan a `contacts`: `phone`, `secondary_email`, `country`, `whatsapp_phone`, `next_followup_date`, `do_not_contact`, `do_not_contact_reason`, `do_not_contact_at`, `ai_conversation_summary`, `lead_temperature`, `attribution`, `deleted_at`, `display_name_source`. Los campos de asignación ya existen desde el Bloque 1. **`instagram_username` estaba en esta lista y se sacó el 22 de septiembre de 2026:** el handle es por canal, no por contacto. Un contacto va a tener más de uno, y ya existe dónde guardarlo: `contact_channels.platform_username`
- [ ] **El teléfono se normaliza a E.164 antes de guardarse**, en el servidor, no solo en el formulario, según la definición de §14. Sin esto, la deduplicación entre WhatsApp e Instagram falla y arreglarlo después implica migrar datos sucios (devuelto el 23/09/2026, auditoría #35b)
- [ ] El teléfono NO es obligatorio. Un contacto de WhatsApp puede existir sin teléfono conocido
- [ ] Campo `phone_resolved` que marca si el teléfono ya se conoce o sigue pendiente
- [ ] Índices en teléfono, correo, `contact_channels.platform_username` y marca de borrado, y compuestos por espacio de trabajo con teléfono y con correo
- [ ] Los campos personalizados que ya existen se conservan sin modificar
- [ ] Después de aplicar la migración de F25, `scripts/verify-lead-scope.mjs` se corre contra la base y da verde. El criterio original, "RLS actualizada con la lógica de scope de leads de F3", se había descartado por estar cumplido en el Bloque 1 con la 00019; eso vale solo mientras la migración nueva no abra un camino alrededor del scope, por ejemplo con una policy permisiva al lado de las de la 00019, y esta corrida es la que lo comprueba (devuelto el 23/09/2026, auditoría #38)

**Criterios del nombre y del handle.** Agregados el 22 de septiembre de 2026, después de medir qué manda Zernio. El razonamiento está en la nota de abajo.

- [ ] `contact_channels.platform_username` se escribe con el handle que trae el proveedor cuando lo trae: `participantUsername` en el listado y en `getInboxConversation`, `sender.username` en el webhook. Si ya tenía un valor, se reemplaza por el que trae el proveedor. **Si no lo trae, queda nulo. Nunca se deduce de la forma de otro campo**, aunque `participantName` tenga pinta de handle: hay nombres reales sin espacio, y un dato decidido por heurística falla en silencio. La identidad del canal no depende de esto: la resuelve F26 con `platformUserId`, y el handle es dato de presentación
- [ ] `contacts.display_name_source` registra de dónde salió el nombre: `provider` o `manual`. **Un nombre de origen `manual` no lo pisa nunca ningún camino automático**: ni la importación, ni el webhook, ni el relleno de F27

> **Por qué, medido el 22 de septiembre de 2026.** Zernio manda el handle en el campo del nombre, tanto en el listado de conversaciones como en el webhook. De las 500 conversaciones reproducidas, solo 2 traían un nombre real, y eran exactamente las 2 que traían `instagramProfile`: el perfil que Zernio completa, en la muestra de ese día, justo después de un mensaje entrante. En nuestra base, los 200 contactos importados quedaron con el handle como nombre y sin `platform_username`, porque la importación no lee `participantUsername` (la interfaz de `lib/inbox-sync.ts:42-51` ni siquiera lo declara). Ningún camino reescribe un nombre existente, así que sin F27 se quedan así para siempre. El relleno está en F27.

**Criterios del campo de atribución.** Venían de F10 del documento anterior y no estaban especificados acá: la columna aparecía en la lista pero sin decir qué guarda ni con qué reglas.

- [ ] `attribution` es `jsonb` con default `'{}'`, con estructura de `first_click` y `last_click`
- [ ] `first_click` se escribe una sola vez y no se modifica nunca más. Es el dato que dice de dónde salió el lead, y se pierde para siempre si se sobreescribe
- [ ] `last_click` se actualiza en cada interacción nueva que traiga parámetros de seguimiento
- [ ] No requiere política de acceso adicional: hereda la de `contacts`
- [ ] Para contactos que lleguen por un anuncio de click-to-WhatsApp se registra el origen. La marca de ventana de 72 horas que eso habilita es del plan B: ver el apéndice

#### F26: Identidad de canal y reconciliación de teléfonos

**Descripción.** WhatsApp está migrando a un esquema donde el identificador del contacto puede ser un código opaco en lugar del número de teléfono. Evolution reemplaza ese código por el número antes de avisarnos, pero solo cuando tiene el dato para hacerlo. Cuando no lo tiene, el mensaje llega sin número por ningún lado, y no existe forma de averiguarlo.

**Estado: no construido** (verificado el 22 de septiembre de 2026: depende de columnas de F25, que no están aplicadas).

Como el número todavía no está conectado, no sabemos con qué frecuencia pasa. El diseño tiene que funcionar bien en los dos escenarios.

**Criterios de aceptación:**

- [ ] `contact_channels` guarda el identificador crudo tal como llegó y el modo de direccionamiento, además del teléfono derivado
- [ ] Cada mensaje guarda el identificador con el que llegó, sin sobrescribirlo
- [ ] Un contacto sin teléfono conocido entra como contacto nuevo, con marca visible de "teléfono sin resolver"
- [ ] Nunca se deduplica por nombre. Un duplicado visible y reconciliable es preferible a una fusión incorrecta, que es destructiva y difícil de deshacer
- [ ] Reconciliación posterior por tres vías, todas con registro en el historial de auditoría:
    1. Un mensaje posterior de la misma conversación que sí traiga el teléfono
    2. El aviso de actualización de contacto que manda Evolution, que aplica el mismo criterio
    3. Carga manual del teléfono por el operador desde la ficha. Esta es la que garantiza que el caso nunca queda trabado, y es barata de construir
- [ ] Al reconciliar, si ya existe otro contacto con ese teléfono, se propone la fusión mostrando los dos lados. La fusión la confirma una persona, nunca es automática
- [ ] Al fusionar se unifican conversaciones, notas, etiquetas y atribución
- [ ] Instrumentación obligatoria: contador de cuántos mensajes entrantes llegan sin teléfono resuelto, visible para el Owner. Es el dato que decide si esto es marginal o si hay que invertir más
- [ ] **La identidad de un canal es la cuenta en la plataforma, no la ranura del proveedor.** `channels` guarda el identificador de la cuenta en la plataforma (`platformUserId` en la respuesta de Zernio), y `late_account_id` queda solo como referencia al proveedor. Si una sincronización encuentra el mismo `late_account_id` con otro `platformUserId`, **no renombra la fila**: la desactiva, crea un canal nuevo para la cuenta nueva, y lo registra en el historial de auditoría. Agregado el 22 de septiembre de 2026, antes de fijar la línea de base del Bloque 3; el motivo está abajo

> **Hallazgo del 22 de septiembre de 2026: el identificador de cuenta de Zernio no identifica una cuenta de Instagram.** Afecta a esta funcionalidad y a F29. **Decidido el mismo día: entra en F26**, como el último criterio de arriba. No es ampliación de alcance: F26 es la funcionalidad de la identidad de canal, y hoy usa como identidad un campo que se midió que no identifica una cuenta. F29 no cambia.
>
> **Lo medido.** Se desconectó `@theconsultour` de Zernio y se conectó `@alomercadeo`, que es otra cuenta de Instagram. Zernio le dio a la nueva **el mismo `_id`** que tenía la vieja, `6aab34cb8d284ffb210b9700`. El objeto de la cuenta conserva el `createdAt` del 17 de septiembre, que es cuando se conectó la vieja, y tiene un `metadata.connectedAt` nuevo, del 22. La documentación de Zernio no dice nada sobre reusar identificadores.
>
> **Qué hizo nuestro código con eso, verificado en `app/api/v1/channels/sync/route.ts`.** Empareja canales por `late_account_id`, encontró la fila existente, y **le cambió el nombre de usuario**. No creó un canal nuevo ni desactivó el viejo. Todo lo que colgaba de esa fila —`contact_channels`, `conversations`— pasó a colgar de la cuenta nueva, sin ningún aviso. Esta vez no hizo daño porque la purga del paso 1 había vaciado la fila justo antes.
>
> **La cara visible del mismo hallazgo.** La tarjeta del canal muestra "@alomercadeo · Active · Connected Sep 16". La cuenta se conectó el 22; el 16 es cuando se conectó `@theconsultour`. La fecha sale de `channels.created_at` (`app/(dashboard)/dashboard/channels/channels-view.tsx:405`), y como la fila se renombró en vez de reemplazarse, se quedó con la fecha de la otra cuenta. **La interfaz afirma que el Instagram del negocio está conectado desde hace seis días, y es falso.** El criterio nuevo lo resuelve solo: al crear una fila por cuenta, `created_at` vuelve a ser la fecha de conexión de esa cuenta.
>
> **Lo que eso significa.** `late_account_id` no identifica una cuenta de Instagram. Identifica otra cosa: por lo que se vio, una ranura de conexión dentro de Zernio, que sobrevive a la desconexión y se reusa. Esto último es **inferencia**; lo medido es solo que el `_id` se repitió. La identidad real de la cuenta viene en otros campos de la misma respuesta: `platformUserId` y `metadata.instagramScopedId`.
>
> **Por qué le toca a F26.** Todo lo que esta funcionalidad construye sobre `contact_channels` da por sentado que "el canal" es una cosa fija. Si la fila del canal puede pasar a ser otra cuenta sin avisar, el identificador del remitente deja de significar lo mismo de un día para el otro. Y probablemente cambie también el valor: el identificador que Meta le da a un remitente de Instagram está atado a la cuenta profesional que recibe, así que la misma persona tendría otro identificador en la cuenta nueva. **Sin verificar:** sale de memoria sobre la documentación de Meta, no de una lectura ni de una medición.

#### F27: Guardado de mensajes entrantes

**Descripción:** que las conversaciones con los leads vivan en la base del negocio y no en un proveedor.

**Estado: no construido** (verificado el 22 de septiembre de 2026: `messages` tiene 0 filas después de 9 entregas de webhook, y nada en el código inserta entrantes).

**Criterios de aceptación:**

- [ ] Los mensajes entrantes se guardan en `messages`. Hoy solo se guardan los salientes
- [ ] Restricción de unicidad sobre la combinación de chat, identificador de mensaje y dirección, no sobre el identificador solo: ese identificador lo genera el teléfono que envía y es único por conversación, no en todo el sistema. La propia base de Evolution no deduplica, así que los duplicados son esperables
- [ ] La fecha del proveedor viene en segundos y se convierte al guardar
- [ ] Se contemplan las dos formas del aviso: el de mensaje individual trae un objeto, el de sincronización trae una lista
- [ ] Se guarda la referencia al mensaje citado, para poder reconstruir hilos, aunque ese mensaje todavía no exista de nuestro lado
- [ ] Tipos soportados: texto, imagen, audio, documento, video, sticker, ubicación y respuesta a otro mensaje
- [ ] La base pasa a ser la fuente de verdad de la bandeja. Después de esta funcionalidad, la bandeja no consulta más al proveedor para mostrar mensajes
- [ ] El camino de entrada es el mismo para Instagram y WhatsApp, sin condicionales por plataforma más allá del adaptador
- [ ] **Importación del historial de Instagram que ya existe.** Ver abajo: sin esto, el criterio anterior hace que la bandeja pierda las conversaciones viejas el día que se migre
- [ ] **Relleno oportunista del nombre y el handle, con techo.** Al procesar un `message.received` de Instagram, si el remitente tiene `contact_channels.profile_status = 'pending'`, se relee esa sola conversación con `zernio.messages.getInboxConversation` (`GET /v1/inbox/conversations/{conversationId}`, con `accountId` obligatorio). Va en el procesamiento en segundo plano, **después** del acuse de recibo, nunca antes. Si la respuesta trae `instagramProfile`:
    - se escribe `platform_username` con `participantUsername`;
    - se escribe `contacts.display_name` con `participantName`, **solo si** `display_name_source` es `provider`;
    - `profile_status` pasa a `complete`.

  Si no lo trae, se suma uno a `profile_attempts`, y **a los 3 intentos `profile_status` pasa a `unavailable` y no se reintenta más**. La señal de "ya tiene nombre real" es que venga `instagramProfile`, **no la forma del nombre**. Rendirse cuesta cero: el contacto se queda con el handle, que es donde está hoy. Sin el techo, cada contacto cuyo perfil nunca se complete dispararía una llamada extra a la API en cada mensaje entrante, para siempre. Con los datos de hoy, eso serían 498 de 500
- [ ] **Control positivo del relleno, determinista.** Se prueba con la respuesta de `getInboxConversation` **simulada**, no contra Zernio en vivo. Tres casos:
    1. Un contacto con nombre de origen `provider` y `profile_status = 'pending'` **recibe** nombre y handle cuando la respuesta simulada trae `instagramProfile`.
    2. **No cambia nada** cuando no lo trae, salvo `profile_attempts`.
    3. Un nombre de origen `manual` no se pisa aunque la respuesta traiga perfil.

  **Probar solo el tercer caso no alcanza:** no distingue entre "está bien hecho" y "está todo congelado". **Y no va contra la API real** porque, en lo medido, el perfil aparece alrededor de un segundo antes de la entrega del webhook. Un test que dependa de ganar esa carrera falla de vez en cuando, y un test así termina desactivado, que es perder el control positivo entero

> **Lo que sostiene el relleno, medido el 22 de septiembre de 2026, y lo que no.** En los dos casos observados, Zernio completó el perfil 2 o 3 segundos después de un mensaje entrante, y alrededor de un segundo antes de entregarnos el webhook: Marcos, entrante a las 14:27:00, perfil a las 14:27:03, entrega a las 14:27:04; otra conversación, entrante a las 15:02:27, perfil a las 15:02:29, entrega a las 15:02:30. El control negativo fue una conversación con actividad a las 15:17 **sin perfil**, y su única actividad era un mensaje **saliente**: el disparador es el mensaje entrante, no cualquier actividad. **Lo que no cubre:** son 2 casos positivos y 1 negativo; no apareció ningún entrante sin perfil después, que sería lo que refuta la inferencia; y no se sabe si Zernio vuelve a buscar el perfil en cada mensaje o solo la primera vez. El techo de 3 intentos es lo que hace que equivocarse en esto no cueste nada.

> **Tarea aparte, no es criterio: los 200 contactos que ya existen.** Quedaron con el handle como nombre, `platform_username` nulo y, cuando exista la columna, `profile_status = 'pending'`. **Un relleno masivo no sirve:** releer el listado hoy le daría nombre real a 2 de 200, que son justo los dos casos de arriba. Lo que los arregla es el uso: cada uno recibe su nombre la próxima vez que escriba, por el criterio del relleno oportunista. Los que no vuelvan a escribir se quedan con el handle. Eso es un límite de Zernio, y la pregunta para levantarlo está en `docs/contingencia-whatsapp.md` §6, pregunta 5.

> **Hallazgo del 16 de septiembre de 2026: no existe ninguna importación de mensajes, y F27 la necesita.**
>
> El backfill que ya trae el proyecto, `backfillInboxConversations`, escribe en `contacts`, `contact_channels` y `conversations`. **Nunca escribe en `messages`.** Verificado leyendo el archivo, no supuesto.
>
> Eso choca de frente con el criterio de que la base pase a ser la fuente de verdad. F27 guarda lo que llega por aviso **de ahí en adelante**, así que el día que la bandeja deje de consultar al proveedor, el historial anterior desaparece de la pantalla. En Instagram eso no es hipotético: hoy hay 33 conversaciones con historial real, y una sola de ellas tiene 111 mensajes que arrancan en junio de 2024.
>
> Dicho de otra forma: migrar al guardado local **sin** una importación previa sería un retroceso visible para el usuario, no una mejora. Es el mismo principio que el CLAUDE.md ya fija para WhatsApp, "migrar sin historial no es migrar", aplicado al canal que ya está conectado.
>
> **El trabajo de paginar la API ya está hecho y es reutilizable.** `lib/zernio-message-map.ts` tiene el bucle contra el endpoint de mensajes de Zernio, con lo que hace falta saber medido contra la API real: el tamaño de página es 100 y está topeado ahí, `offset` no existe, se pagina con `cursor` desde `pagination.nextCursor`, y `sortOrder` acepta `asc` y `desc`. La importación de F27 necesita exactamente ese bucle, recorriendo hacia atrás en vez de traer una sola página.
>
> **Y hay un límite que conviene saber antes de prometer la importación:** el endpoint devuelve `message: ""` para buena parte de los mensajes históricos de Instagram, los que Zernio resume como `[Attachment]` en el listado. Medido: 22 de 24 en las primeras conversaciones revisadas. Ese contenido no está del lado del proveedor, así que ninguna importación lo puede recuperar. El historial que se importe va a tener huecos, y eso hay que decirlo antes y no después.

> **Hallazgo del 22 de septiembre de 2026: la importación de conversaciones que ya existe tiene un techo de 200, y F27 lo tiene que sacar.**
>
> `lib/inbox-sync.ts:15-16` fija 4 páginas de 50, siempre desde las más recientes. Las conversaciones conocidas se saltean pero ocupan su lugar en esas páginas, así que repetir la sincronización no baja nunca de las mismas 200. En la reconexión de `@alomercadeo`, Zernio reprodujo 500 conversaciones (del 3 de agosto al 22 de septiembre) y nuestra base quedó en 200 (del 3 de septiembre en adelante). El registro de esa ejecución está en `docs/purga-y-reconexion-instagram.md`.
>
> **Lo que F27 tiene que hacer distinto:** recorrer la paginación hasta que el proveedor diga que no hay más, con un tope de seguridad que esté **por encima** del máximo documentado del proveedor (500 conversaciones por cuenta) y no por debajo. Y cuando corte por el tope de seguridad en vez de por el final de la paginación, decirlo, porque esos dos cortes se ven igual en el resultado.
>
> Mientras tanto no se tocó, a propósito: el negocio no trabaja todavía desde nuestra bandeja, así que lo que falta no le falta a nadie.

> **Medición del 21 de septiembre de 2026: el webhook y el listado le ponen el mismo identificador al mismo mensaje. La restricción única de F27 funciona.**
>
> Era la pregunta que bloqueaba F27, porque los mensajes entran por dos caminos —el webhook empuja cada uno nuevo, la importación lee el historial del listado— y `platform_message_id` es lo único que impide duplicados. Si los dos caminos usaran identificadores distintos, la restricción no se dispararía nunca y la importación duplicaría el historial entero **sin un solo error a la vista**.
>
> **La pregunta era de tres vías, no de dos**, y así mal planteada no se podía contestar. El webhook trae DOS identificadores y el listado trae UNO: `message.id` es el interno de Zernio y `message.platformMessageId` es el de Meta, mientras que el listado devuelve un solo campo `id`. Lo que había que establecer no era "¿son iguales?" sino **a cuál de los dos equivale el del listado**.
>
> **Resultado: el `id` del listado es el `platformMessageId` del webhook.** Ocho mensajes entrantes, ocho veces la misma cadena. Las dos familias no se confunden ni por casualidad: el interno es un ObjectId de 24 hex y el de plataforma es un blob base64 de Meta de más de 150 caracteres.
>
> **El control positivo, que es lo que hace que esto signifique algo:** antes de comparar identificadores se estableció que se miraba el mismo mensaje, ubicándolo en el listado por marca de tiempo normalizada a epoch en milisegundos. Delta de 0 ms en los ocho. Sin ese paso, dos cadenas distintas de dos mensajes distintos sería el resultado esperado y no un hallazgo.
>
> **Los salientes también, y por otra puerta.** Lo que escribe `platform_message_id` en un saliente no es un aviso entrante sino la respuesta del propio envío, `response.data.data.messageId`, que hoy guardan `lib/flow-engine/engine.ts`, `lib/sequence-processor.ts` y `lib/flow-engine/nodes/ai-response.ts`. Cuatro de cuatro envíos propios guardan exactamente la cadena que devuelve el listado.
>
> **Qué NO cubre, que importa tanto como lo que cubre:**
>
> - **Nada sobre el historial viejo de Instagram.** La medición sale del log de entregas de Zernio, que retiene 30 días. Los mensajes de 2024 nunca pasaron por un webhook, así que por construcción no pueden estar en la muestra. Para ese tramo, que es justamente el que va a leer la importación, la coincidencia está **inferida, no medida**. Es menos peligroso de lo que suena: si esos mensajes no tienen contraparte en el webhook, no hay con qué duplicarlos.
> - **Nada sobre los adjuntos salientes.** Ninguno de los cuatro envíos medidos llevaba adjunto.
> - **Nada sobre WhatsApp.** Evolution es otro proveedor con otro esquema, y F27 ya tiene su propio criterio para eso: unicidad por chat, mensaje y dirección, porque el identificador de Evolution es único por conversación y no global.
> - **Un mensaje entrante con `direction: "outgoing"` no se midió** porque no apareció ninguno en 30 días de entregas.
>
> La medición se repite con `node scripts/verify-id-mensaje-zernio.mjs`, y `--salientes` corre el otro recorrido. Es de solo lectura. `--autoprueba` verifica al verificador: ejercita las cuatro ramas de veredicto con casos fabricados, porque un verde uniforme se ve igual venga de una comparación que discrimina o de una que siempre da verdadero.
>
> **Un hallazgo lateral que conviene tener escrito antes de apoyarse en ese log:** `metadata.messageId` del log de actividad **no es un campo de familia uniforme**. Los envíos con `source=api`, que son los que hace nuestro código, registran el identificador de plataforma; los de `source=platform`, escritos por alguien desde la app de Instagram, registran el interno. Nuestro código nunca manda ni guarda los segundos, así que no afecta a F27, pero cualquier cosa futura que lea ese campo tiene que filtrar por origen o va a comparar peras con manzanas.
>
> **Y cómo apareció ese hallazgo es método, no anécdota, así que va acá.** La primera corrida de los salientes dio dos rojos junto a cuatro verdes. Los dos rojos eran los mensajes escritos desde la app: no eran envíos nuestros, y un mensaje que nuestro código nunca escribe no puede decir nada sobre lo que nuestro código escribe. La población estaba mal, no el resultado.
>
> Recortarla fue correcto, pero **recortar la población después de ver los resultados es exactamente lo que hace un número conveniente**, y la diferencia entre una cosa y la otra no está en el recorte: está en tres condiciones, y las tres tienen que cumplirse.
>
> 1. **El criterio del recorte es anterior a los datos y es independiente del resultado.** "Solo los envíos que hace nuestro código" sale de la pregunta, no de qué filas daban verde. Si el criterio hubiera sido "los que coinciden", sería fraude.
> 2. **Lo recortado no se descarta: se reporta aparte, con su veredicto y su motivo.** Los dos casos ajenos siguen saliendo en la salida del script, en su propia sección. Callarlos habría escondido la única evidencia de que el campo cambia de familia según el origen, que terminó siendo el hallazgo más útil de la corrida.
> 3. **El recorte queda escrito donde vive la medición**, con el razonamiento completo, para que el que lea el verde vea también de qué población salió.
>
> Dicho al revés: un recorte que reduce el número de casos incómodos y además los hace desaparecer del reporte no es un recorte, es un borrado.

> **Los mensajes escritos desde la app de Instagram son alcanzables aunque el webhook no los empuje. Esto acota el problema antes de medirlo, y por eso va escrito ahora.**
>
> El negocio responde desde el celular. Si esos mensajes no produjeran ningún evento, no llegarían a la base en tiempo real y el agente de IA leería conversaciones donde el lead pregunta y nadie contesta. Para un sistema cuya premisa es que la base local es la única fuente de verdad, eso no es un hueco de datos, es un hueco de sentido.
>
> **Pero existen, y ya los vimos.** Son exactamente los dos `source=platform` que produjeron los falsos rojos de la medición de salientes: aparecen en `GET /v1/logs` con su identificador y su conversación, y aparecen también en el listado de mensajes de la conversación. O sea que **hay un camino para traerlos aunque el webhook no los entregue**.
>
> La distinción que importa, porque cambia el tamaño del problema y no solo la respuesta:
>
> - **Si el echo llega por webhook**, F27 los recibe en vivo, por el mismo camino que todo lo demás, y no hay nada especial que construir.
> - **Si no llega**, F27 necesita un sondeo periódico contra el listado o contra el log de actividad para alcanzarlos. Es más trabajo y agrega latencia, pero **no es un agujero: es una funcionalidad más**. Y ese sondeo cae de lleno bajo la regla de vigilancia de la sección 14, así que nace con su marca de última ejecución.
>
> El experimento decide **cómo** los recibe F27, no **si** son alcanzables. Tenerlo escrito de antemano evita que un resultado negativo se lea como una pared cuando es un desvío.
>
> **Medido el 21 de septiembre de 2026: Instagram SÍ manda echo, también para lo que se escribe desde la app.**
>
> Tres mensajes, en este orden: uno entrante desde otra cuenta, uno saliente desde la bandeja, y uno saliente escrito desde la app de Instagram como el negocio.
>
> **El control positivo primero, que es lo que hace atribuible el resultado.** El saliente de la bandeja es origen API, el caso documentado como seguro, y **dejó entrega de `message.sent`**. Sin esa entrega, la ausencia de la otra no se habría podido atribuir a Instagram: habría sido indistinguible de "la suscripción no quedó aplicada" o "la entrega falló", y el veredicto habría sido no concluyente.
>
> **El de la app también dejó entrega.** Las dos con HTTP 200.
>
> **La atribución no se hizo por orden de llegada, que habría sido una suposición**, sino cruzando cada entrega contra el log de actividad, que sí distingue el origen. Y ahí el hallazgo de la heterogeneidad de familias pagó solo: la entrega de la bandeja cruza por `platformMessageId` y la de la app cruza por `message.id`, porque el log de actividad registra una familia distinta según el origen. Cruzar por un solo identificador habría dejado una de las dos sin atribuir.
>
> **De qué familia viene el echo, que era la pregunta abierta porque `source` está ausente en Instagram:** el aviso trae **los dos identificadores**, `message.id` interno y `message.platformMessageId` de plataforma, igual que `message.received`. Y el de plataforma coincide con el `id` del listado, con delta de 0 ms, en las dos entregas. **La clave de idempotencia de F27 sirve para los echos venga el mensaje de donde venga.**
>
> **Consecuencia aplicada:** la suscripción se queda, y `message.sent` pasó a `WEBHOOK_EVENTS` en `lib/zernio-webhook.ts`, una constante única que reemplaza las dos listas que estaban copiadas en los llamadores de `ensureWebhookRegistered`. Esa duplicación era una trampa activa y no una fealdad: esa función **reescribe la lista completa** cuando actualiza, así que un llamador con la lista vieja le borraba eventos a la suscripción sin error y sin aviso. Hay un test que falla si alguna ruta vuelve a armar su propia lista.

> **Por qué el sondeo de mensajes escritos desde la app sigue escrito acá aunque el echo haya llegado.**
>
> El razonamiento que lo justificaba **no dependía de que el echo faltara**, y conviene no borrarlo solo porque esta vez la respuesta fue la cómoda.
>
> **Hoy la bandeja lee del proveedor, así que un mensaje escrito desde la app se ve al refrescar el navegador.** Comprobado en esta misma prueba: apareció al refrescar, y eso no era evidencia sobre el echo, era evidencia de que Zernio lo tenía.
>
> **Cuando F27 haga que la base local sea la fuente de verdad, la bandeja va a leer de la base.** A partir de ahí, todo mensaje que no haya llegado a la base **deja de verse**, y refrescar no lo trae. O sea que cualquier clase de mensaje que F27 no capture **empeora con F27 en vez de mejorar**: hoy se ve tarde, después no se ve nunca.
>
> Esa es la forma exacta de regresión que nadie busca, porque la funcionalidad se presenta como una mejora y en el caso general lo es. La pregunta que hay que hacerse al construir F27 no es "¿qué mejora?" sino **"¿qué se veía antes que deje de verse?"**.
>
> Aplicado a este caso: como el echo llega, los mensajes escritos desde la app entran por el webhook y no hace falta sondeo. **Pero eso ahora es una dependencia, no una comodidad.** Si la suscripción se cae —y se cae sola si alguien vuelve a poner una lista literal en un llamador—, el síntoma no va a ser un error: va a ser que las respuestas del negocio desde el celular desaparecen de la bandeja. Un silencio más, de la familia de la sección 14.

#### F39: Detección de silencio del canal

**Descripción:** que un canal que dejó de recibir mensajes se note, en lugar de parecer un día tranquilo. Va numerada aparte de F27 y no adentro: F27 guarda lo que llega, F39 avisa cuando deja de llegar, y son dos mecanismos con dos formas distintas de fallar.

**Estado: no construido** (verificado el 22 de septiembre de 2026: se especificó el 21 de septiembre de 2026 y no se empezó).

**Criterios de aceptación:**

- [ ] Cada canal guarda la marca de tiempo del último evento entrante recibido, actualizada por el receptor
- [ ] Un trabajo periódico la compara contra un umbral configurable por canal, expresado en horas hábiles según la zona horaria del negocio, y abre una condición en `webhook_alerts` cuando se supera
- [ ] La alerta de silencio del canal se envía por correo vía F23
- [ ] El mismo trabajo escribe su propia marca de última ejecución, visible en la interfaz. Esa marca es el control positivo del chequeo: **sin ella, F39 no se puede dar por verde**
- [ ] Con el canal activo y el receptor detenido a propósito, la condición se abre
- [ ] Con el trabajo periódico detenido a propósito, la marca de última ejecución envejece y se ve en pantalla
- [ ] **El mismo trabajo consulta la lista de eventos registrada en el proveedor y la compara contra la constante esperada** (`WEBHOOK_EVENTS` de `lib/zernio-webhook.ts`). Si difieren, abre una condición en `webhook_alerts` **nombrando qué evento falta**, no un aviso genérico
- [ ] Con un evento sacado a propósito de la suscripción, la condición se abre aunque el canal esté recibiendo mensajes con normalidad

> **Por qué la verificación de la suscripción va acá y no es una funcionalidad aparte: F39, sin esto, no detectaría la falla que ella misma vuelve posible.**
>
> F39 mira la marca del último evento entrante por canal. Eso contesta **"¿llegó algo?"**. Pero la falla que importa acá es otra: **"¿dejó de llegar un tipo de cosa mientras las demás siguen?"**.
>
> El caso concreto, que ya es real desde el 21 de septiembre de 2026: la suscripción incluye `message.sent` porque las respuestas que el negocio escribe desde el celular llegan por ahí. Si ese evento desaparece de la suscripción —un registro que falló dentro del `try/catch` silencioso, un cambio hecho desde el panel de Zernio, un llamador que volvió a armar su propia lista— los leads siguen escribiendo, los `message.received` siguen llegando, **la marca del último entrante sigue fresca y F39 sigue callada**. Mientras tanto desaparece cada respuesta escrita desde el teléfono.
>
> Es una llamada y una comparación, contra una tabla que ya existe. La alternativa —llevar una marca de último evento **por tipo**— cuesta más, obliga a decidir un umbral por tipo, y encima no sirve: un evento que nunca llega no tiene marca que envejecer, tiene una marca que nunca existió.
>
> **El test de `lib/zernio-webhook.test.ts` no cubre esto y está bien que no lo cubra.** Ese test protege que nuestro código no vuelva a armar la lista en dos lugares. No dice nada sobre el estado real en el proveedor, que es lo único que decide qué se entrega.

> **Por qué la marca de última ejecución no es un adorno.** F39 avisa por ausencia, así que su modo de falla es indistinguible de su modo de éxito: un canal sano y un detector muerto se ven exactamente igual desde la pantalla, que en los dos casos no muestra ninguna alerta. La marca de última ejecución es lo único que separa "no hay nada que avisar" de "nadie está mirando". Ver la regla transversal en la sección 14.

**Sobre el modelo de datos.** Son **dos marcas distintas** y conviene no confundirlas, porque una es el dato vigilado y la otra es la prueba de vida del vigilante:

- La **marca del último evento entrante**, por canal, que es lo que el trabajo compara contra el umbral. **No se define todavía:** se agrega junto con las demás columnas de F27, cuando se construya, y recién ahí entra en la sección 7.2.
- La **marca de última ejecución del propio trabajo**, que no depende de F27 y todavía no tiene lugar asignado. Por la regla transversal de la sección 14, esta no puede quedar como un detalle de implementación: es parte de lo que F39 entrega, así que necesita su columna y su criterio, y se define al construir F39.

#### F28: Adjuntos

**Descripción:** que las fotos, audios y documentos que mandan los leads queden guardados.

**Estado: no construido** (verificado el 22 de septiembre de 2026: depende de F27).

**Criterios de aceptación:**

- [ ] El archivo se descarga al recibirlo y se guarda en Supabase Storage. Ninguna dirección que entrega el proveedor sirve a largo plazo: la de WhatsApp está cifrada y la del almacenamiento intermedio caduca a los 7 días
- [ ] Bucket privado, con direcciones firmadas de vida corta para mostrar en la bandeja
- [ ] Estructura de carpetas por espacio de trabajo, conversación y mensaje
- [ ] Validación del tipo de archivo real, no de la extensión. Tamaño máximo configurable
- [ ] Si la descarga falla, el mensaje se guarda igual con marca de "adjunto no disponible" y se reintenta
- [ ] La descarga no bloquea el acuse del aviso

#### F29: Detección de contacto entre canales

**Descripción:** reconocer que el que escribe por WhatsApp es el mismo que ya escribió por Instagram.

**Estado: no construido** (inspeccionado el 22 de septiembre de 2026). `upsertContactForSender` en `lib/inbox-sync.ts` vincula por `platform_sender_id` y **no busca por teléfono ni por correo**. No hay nada de deduplicación entre canales.

**Criterios de aceptación:**

- [ ] Al llegar un mensaje de un canal nuevo, se busca contacto por teléfono normalizado a E.164 según §14, correo o nombre de usuario (devuelto el 23/09/2026, auditoría #13b)
- [ ] Coincidencia exacta de teléfono o correo vincula automáticamente
- [ ] Coincidencia solo por nombre de usuario sugiere la vinculación al operador, no la hace sola
- [ ] Se crea el registro de canal para el contacto
- [ ] Cada conversación queda separada por canal, los hilos no se mezclan
- [ ] La ficha muestra todas las conversaciones agrupadas por canal
- [ ] Las vinculaciones automáticas y manuales quedan en el historial de auditoría

> **Hallazgo del 22 de septiembre de 2026, desarrollado en F26: una fila de canal puede convertirse en silencio en otra cuenta de Instagram**, porque Zernio reusó su identificador de cuenta al conectar una distinta y nuestro código empareja por ese identificador.
>
> **Por qué toca a esta funcionalidad.** El criterio "cada conversación queda separada por canal, los hilos no se mezclan" da por sentado que un canal es siempre la misma cuenta. Si la fila cambia de cuenta, las conversaciones de dos cuentas distintas quedan bajo el mismo canal, y la ficha las agruparía como si fueran de una sola.
>
> **Decidido el mismo día: los criterios de F29 no cambian.** El arreglo va en F26, que devuelve a "un canal es una cuenta" su verdad, y con eso este criterio vuelve a valer. El caso de una misma persona escribiendo a dos cuentas de Instagram del negocio ya lo cubre el criterio de sugerir por nombre de usuario. **Sin verificar:** que Meta le dé a esa persona un identificador de remitente distinto en cada cuenta receptora, lo que impediría cruzar cuentas por ese identificador.

#### F30: Notas, ficha de contacto y borrado suave

**Descripción:** la vista completa del lead y la posibilidad de deshacer un borrado.

**Estado: no construido** (verificado el 22 de septiembre de 2026: la tabla `contact_notes` no existe en la base).

**Criterios de aceptación:**

- [ ] Tabla `contact_notes` con lista cronológica en la ficha. Cualquier miembro con acceso al contacto crea notas; solo el autor, un Admin o el Owner edita o elimina
- [ ] **RLS: `contact_notes` hereda el scope del contacto asociado.** Un Member solo lee, crea o edita notas de los contactos donde es setter, vendedor o asignado, y eso se aplica en la base, no con un filtro en la interfaz. Se prueba con una consulta directa con el token de un Member, que no devuelve notas de contactos ajenos, y con su contraparte: un Owner o un Admin las ve todas. **Venía de F13 en `ebc9702` (`docs/requerimientos-fase1.md`, el plano de fase 1), se perdió en la conciliación de `584226f`, y se devolvió el 22 de septiembre de 2026.** Ver `docs/auditoria-conciliacion.md`
- [ ] Ficha completa con datos, conversaciones por canal, notas, etiquetas, campos personalizados, historial y atribución
- [ ] Muestra todos los datos: nombre, email, teléfono, redes, país, setter, vendedor, temperatura, fecha de seguimiento. Las redes son el handle de cada canal, que vive en `contact_channels` por la decisión del 22 de septiembre (§0) (devuelto el 23/09/2026, auditoría #63a y #63b)
- [ ] Botón para editar todos los datos (devuelto el 23/09/2026, auditoría #67)
- [ ] Clic en una conversación navega al hilo en la bandeja (devuelto el 23/09/2026, auditoría #68)
- [ ] Marca visible si el contacto pidió no ser contactado, y marca si el teléfono está sin resolver
- [ ] Campo `deleted_at` en contactos, notas, conversaciones y respuestas rápidas. Eliminar marca la fecha, no borra
- [ ] Los listados y las reglas de seguridad excluyen lo eliminado
- [ ] Tarea diaria que borra definitivamente lo que lleva más de 30 días eliminado, en cascada
- [ ] El historial de auditoría no se purga nunca

#### F31: Historial de auditoría

**Descripción:** saber quién hizo qué y cuándo.

**Estado: no construido** (verificado el 22 de septiembre de 2026: la tabla `audit_log` no existe en la base).

**Criterios de aceptación:**

- [ ] Tabla `audit_log` con índices por espacio de trabajo, por entidad y por fecha
- [ ] Registran entrada: contacto creado, editado, eliminado, restaurado, asignado, marcado como no contactar y reconciliado por teléfono; canal conectado, desconectado o con error; cambios de configuración; importaciones; movimientos de equipo
- [ ] Owner y Admin ven todo; un Member solo sus propias acciones
- [ ] Nunca se elimina ni tiene borrado suave

> **Nota del 22 de septiembre de 2026:** los cambios hechos en la pantalla de integraciones de F24 (claves guardadas o borradas, modelos por defecto, integraciones agregadas) son "cambios de configuración" y tienen que quedar auditados. Si F24 se construye antes que esta funcionalidad, esa conexión se agrega al construir F31. La dependencia va en este sentido: F31 depende de conocer F24, no al revés.

#### F41: Asignación de setter y vendedor

**Descripción:** asignar a cada contacto quién lo contacta y quién lo cierra, desde la interfaz. El scope de leads de F3 se apoya en esa asignación: sin una forma de escribirla desde la pantalla, un Member no ve ningún lead y nadie puede dárselo sin entrar a la base.

**Estado: no construido** (verificado el 23 de septiembre de 2026). Las columnas `setter_id` y `vendedor_id` existen desde la migración 00017, del Bloque 1. Ninguna pantalla las escribe: fuera de los tipos de `lib/types/database.ts`, no aparecen en `app/`, `components/` ni `lib/`.

**Por qué es una funcionalidad y no un criterio de otra:** el desplegable es una capacidad que el usuario ve por separado. Venía de F11 del documento viejo, y la conciliación de `584226f` la dio por construida con F3. Lo que construyó el Bloque 1 son las columnas y el scope, no la asignación. El detalle está en `docs/auditoria-conciliacion.md`.

**Criterios de aceptación:**

- [ ] `setter_id` y `vendedor_id` aparecen en la ficha del contacto (devuelto el 23/09/2026, auditoría #45)
- [ ] Se asignan desde un dropdown con los miembros del workspace (devuelto el 23/09/2026, auditoría #46)
- [ ] Ambos son opcionales e independientes (devuelto el 23/09/2026, auditoría #47)
- [ ] Los cambios quedan en el audit log: es el evento "asignado" de F31 (cita a F31, auditoría #48)
- [ ] Se puede filtrar la lista de contactos por cada uno (devuelto el 23/09/2026, auditoría #49)
- [ ] **Cambiar una asignación cambia el scope de visibilidad de inmediato** (consecuencia de F3, que lo exige y lo prueba; cita a F3, auditoría #50)
- [ ] **Control positivo:** asignar un contacto a un Member desde el dropdown hace que ese Member lo lea en una consulta directa por API con su token, y quitarle la asignación hace que deje de leerlo. Probar solo que un Member no ve lo ajeno no distingue entre un scope bien aplicado y una asignación que nunca se escribe (agregado el 23/09/2026)

---

### Bloque 4: Bandeja, herramientas y reglas de seguridad

#### F32: Estado de sesión del canal y reconexión

**Descripción:** que se vea cuando WhatsApp dejó de estar conectado.

**Estado: no construido** (inspeccionado el 22 de septiembre de 2026). `channels-view.tsx` no muestra estado de sesión, no tiene QR ni botón de reconectar.

**Criterios de aceptación:**

- [ ] La pantalla de canales muestra el estado de la sesión de WhatsApp
- [ ] Aviso por evento y chequeo periódico, los dos. Ante una caída pasajera Evolution reconecta solo y no avisa, así que el aviso por sí solo no alcanza para mostrar el estado real
- [ ] Un estado desconocido se muestra como "no se pudo verificar", nunca como "desconectado"
- [ ] Se contempla el estado de "se agotaron los intentos de vinculación", que significa empezar de nuevo
- [ ] Botón de reconectar que muestra el código QR cuando corresponde. No siempre puede entregarlo, porque depende del estado actual, y eso se explica en pantalla
- [ ] Si la sesión está caída, la bandeja lo indica de forma visible. Una bandeja silenciosa no puede parecer un día tranquilo

#### F33: Reglas de seguridad de secuencia

**Descripción.** Reemplazan a la ventana de 24 horas en WhatsApp. Son configuración del canal y las hace cumplir el sistema, no el hábito de quien lo usa. Existen porque el seguimiento automático saliente es justamente el comportamiento que Meta busca para bloquear un número.

**Estado: no construido** (inspeccionado el 22 de septiembre de 2026). `lib/sequence-processor.ts` solo cancela la inscripción si la secuencia se pausó o se borró. No hay corte por silencio, ni espaciado aleatorio, ni franja horaria, ni variación de texto: ninguna de las seis reglas existe.

**Criterios de aceptación:**

- [ ] Corte con el silencio: después de una cantidad configurable de seguimientos sin respuesta, por defecto 3, la secuencia se detiene sola y lo registra. Es la protección más importante, porque el que nunca contesta y sigue recibiendo mensajes es el que denuncia
- [ ] Texto variable: el sistema interpola datos del contacto y rota entre variantes. Se advierte si un paso manda texto idéntico a muchos destinatarios, porque eso es una huella de envío masivo
- [ ] Envíos espaciados: separación aleatoria configurable entre mensajes de un mismo grupo. Nunca todo junto
- [ ] Horario comercial: franja horaria configurable, respetando la zona horaria del contacto. Fuera de ella el envío se pospone, no se cancela
- [ ] Opt-out duro: un pedido de no contacto corta para siempre, sin opción de forzarlo desde ninguna pantalla
- [ ] Proporción de respuesta como señal de salud: se calcula y se muestra qué porcentaje de los seguimientos recibe respuesta. Si cae por debajo de un umbral configurable, se avisa. Es mejor que un tope arbitrario de mensajes, porque mide si lo que mandás le sirve a alguien
- [ ] Todo es configuración por canal, no condicionales en el código
- [ ] La Fase 2 construye el motor que las consume

#### F34: Marca de no contactar

**Descripción:** respetar a quien pidió no recibir más mensajes.

**Estado: parcial, y es la más cubierta del Bloque 4** (inspeccionado el 22 de septiembre de 2026). **El fork cubre:** la columna `contacts.is_subscribed`, respetada por el listado de contactos (`/api/v1/contacts`) y por el envío de difusiones. **Falta:** el opt-out duro desde la bandeja, las frases de baja configurables, y que las secuencias lo respeten.

**Criterios de aceptación:**

- [ ] Lista de frases de baja configurable por espacio de trabajo
- [ ] La lista viene cargada con: "no me escribas más", "dejá de mandar mensajes", "no quiero recibir mensajes", "stop", "unsubscribe", "basta", "no me contactes" (devuelto el 23/09/2026, auditoría #92b)
- [ ] Al detectar una: se marca el contacto, se registra el motivo y la fecha, se pausan las secuencias activas y queda en el historial de auditoría
- [ ] Marca roja visible en la bandeja y en la ficha
- [ ] Un Admin o el Owner puede revertirla, con registro
- [ ] Al intentar enviar a un contacto marcado se bloquea el envío, sin opción de forzarlo. Con Evolution una denuncia pesa más que cien mensajes
- [ ] Un contacto marcado nunca entra a una secuencia

#### F35: Bandeja y filtros

**Descripción:** el lugar donde el equipo trabaja todos los días.

**Estado: parcial** (inspeccionado el 22 de septiembre de 2026). **El fork cubre:** `conversation-list.tsx` con búsqueda por texto y filtro por estado. **Falta:** filtros por canal, por asignado y por no leídas, y que el filtrado no sea sobre la página ya cargada en el cliente, que es como está hoy.

**Criterios de aceptación:**

- [ ] La bandeja lee los mensajes de la base, no del proveedor
- [ ] Filtro por etiquetas, por asignación, por canal y por fecha del último mensaje
- [ ] Filtro por tags: multi-select (devuelto el 23/09/2026, auditoría #76b)
- [ ] Filtro por asignación: "Todas", "Sin asignar" y miembros del equipo. La opción "Agente IA" del original pasa a las funcionalidades de fases siguientes, porque esta fase no incluye agente de IA (§4.11) (devuelto el 23/09/2026, auditoría #77b)
- [ ] Filtro por canal: multi-select de canales activos (Instagram, WhatsApp) (devuelto el 23/09/2026, auditoría #78b)
- [ ] Filtro por fecha de último mensaje: presets y rango personalizado (devuelto el 23/09/2026, auditoría #79b)
- [ ] Filtro por estado de ventana solo para Instagram, que es donde la ventana existe
- [ ] Filtro por estado de ventana de Instagram: abierta, cerrada, o por vencer en menos de 2 horas (devuelto el 23/09/2026, auditoría #80b)
- [ ] Filtro por "teléfono sin resolver", para poder trabajar esa cola
- [ ] Filtros combinables, reflejados en la dirección de la página para poder compartirla, con contador y botón de limpiar
- [ ] Búsqueda de texto dentro de los mensajes, que ahora es posible porque están guardados

> **Medido el 22 de septiembre de 2026: la bandeja muestra 50 conversaciones de 200, y el buscador busca solo en esas 50 sin avisar que hay más.** Los criterios no se cambiaron: la propuesta está pendiente de decisión.
>
> **De dónde sale el 50.** Un tope fijo en `app/(dashboard)/dashboard/inbox/page.tsx:12`, `.limit(50)`, ordenado por último mensaje. No es un tamaño de página: no hay paginación ni carga al bajar. La búsqueda y el filtro de estado corren en el cliente sobre esas 50 (`components/inbox/conversation-list.tsx:103-110`), y el contador de arriba (línea 120) cuenta las cargadas, no las que existen. Con los datos de ese día, la conversación número 50 era del 16 de septiembre y la 200 del 2. Las conversaciones nuevas que llegan por Realtime se suman arriba, así que la lista puede crecer durante la sesión, pero nunca hacia abajo.
>
> **Las 150 restantes no se pueden abrir desde la interfaz.** La lista de contactos tiene su propio tope fijo de 100 (`app/(dashboard)/dashboard/contacts/page.tsx:13`, el contacto 100 era del 13 de septiembre), también con búsqueda en el cliente. Y la ficha de contacto lista sus conversaciones, pero el enlace de cada una va a `/dashboard/inbox` a secas (`app/(dashboard)/dashboard/contacts/[contactId]/page.tsx:205`), no a esa conversación. Un contacto del puesto 51 al 100 se ve en contactos pero su conversación no se abre. Uno del 101 al 200 solo es alcanzable escribiendo su dirección a mano.
>
> **La consecuencia que importa:** alguien busca un cliente de agosto, no lo encuentra, y concluye que no existe. El buscador busca en una cuarta parte de las conversaciones y la pantalla no dice que hay más. Es la misma familia que §14, "Un instrumento comparado solo contra sí mismo": una lista que se corta sin avisar se lee como una lista completa.
>
> **Los cinco niveles medidos ese día, y ninguno avisa:** Instagram, todas; Zernio, 500 desde el 3 de agosto; nuestra base, 200 desde el 3 de septiembre; la lista de contactos, 100 desde el 13; la bandeja, 50 desde el 16.

#### F36: Respuestas rápidas

**Descripción:** textos reutilizables que el operador inserta escribiendo una barra.

**Estado: no construido, y la tabla hay que crearla** (verificado el 22 de septiembre de 2026).

> **`response_templates` no es una tabla del fork que el `CLAUDE.md` recordara mal: es un nombre que elegimos nosotros para una tabla que no existe.**
>
> Verificado listando cada `create table` de todas las migraciones, sin distinguir mayúsculas. El conteo vigente está en 14c; las tablas que existen son `analytics_events`, `broadcast_recipients`, `broadcasts`, `channels`, `comment_logs`, `contact_channels`, `contact_custom_fields`, `contact_tags`, `contacts`, `conversations`, `custom_field_definitions`, `flow_sessions`, `flow_versions`, `flows`, `messages`, `scheduled_jobs`, `sequence_enrollments`, `sequences`, `tags`, `triggers`, `webhook_alerts`, `webhook_events`, `workspace_invites`, `workspace_members` y `workspaces`. Ninguna es de respuestas rápidas, **ni con otro nombre**: se buscó también por `quick_repl`, `canned`, `saved_repl` y `snippet`, y los únicos aciertos son un tipo de disparador (`quick_reply`) y una columna de `messages` (`quick_reply_payload`), que son otra cosa.
>
> **Consecuencia para F36:** incluye crear la tabla, con su migración y su RLS. No es "conectar una pantalla a algo que ya está".
>
> **Consecuencia para la regla de nomenclatura de la sección 14:** ninguna. La regla distingue "Respuestas rápidas" de "Plantillas de WhatsApp" para que no se confundan en la interfaz, y sigue en pie. Lo que cambia es que `response_templates` pasa de ser un dato heredado a ser una decisión nuestra, y por eso el nombre se elige acá y no se hereda de nadie.

**Criterios de aceptación:**

- [ ] Tabla `response_templates` con alta, baja y modificación en `/settings/response-templates`
- [ ] Selector con "/" en la bandeja, con búsqueda por nombre o atajo
- [ ] Interpolación de datos del contacto; si un dato falta, queda vacío
- [ ] Al seleccionar, se inserta el contenido con las variables interpoladas: `{{contact.display_name}}`, `{{contact.email}}`, `{{contact.phone}}`, `{{workspace.name}}` (devuelto el 23/09/2026, auditoría #88b)
- [ ] En la interfaz se llaman "respuestas rápidas", nunca "plantillas", para no confundirlas con las plantillas de WhatsApp del plan B

#### F37: Importación de contactos desde planilla

**Descripción:** cargar contactos que ya existen en otro lado.

**Estado: no construido** (inspeccionado el 22 de septiembre de 2026). No existe ninguna pantalla de importación; los únicos usos de "import" en la interfaz son sentencias de JavaScript.

**Criterios de aceptación:**

- [ ] Botón "Importar CSV" en `/contacts` (devuelto el 23/09/2026, auditoría #99)
- [ ] Archivo de hasta 10 MB y 10.000 filas, con vista previa y asignación de columnas
- [ ] Preview con las primeras 5 filas y mapeo de columnas sugerido (devuelto el 23/09/2026, auditoría #101b)
- [ ] El usuario ajusta el mapeo, incluyendo setter, vendedor, tags y custom fields (devuelto el 23/09/2026, auditoría #102)
- [ ] **Cada fila necesita al menos un identificador que permita deduplicar, de los enumerados en la sección 14.** El correo se valida con formato y el teléfono se normaliza a E.164 según §14, pero los dos son ejemplos, no la lista: un identificador único del sistema de origen sirve igual, y de hecho sirve mejor, porque allá ya se garantizó que es único. Una fila sin ningún identificador no se puede deduplicar y se rechaza con su motivo (devuelto el 23/09/2026, auditoría #103c)
- [ ] Deduplicación por cualquiera de los identificadores que traiga la fila: identificador de origen, correo o teléfono, en ese orden de confianza. Si ya existe, actualiza en vez de duplicar. **El importador no decide qué cuenta como identificador:** la lista está en la sección 14 y admitir uno nuevo se escribe ahí primero
- [ ] Más de 500 filas se procesan en segundo plano, no en el momento
- [ ] Cuando una importación corre en segundo plano, quien importó recibe una notificación por correo al terminar, vía F23 (devuelto el 23/09/2026, auditoría #105c)
- [ ] Barra de progreso y resumen final con importados, actualizados y errores con detalle
- [ ] Todo queda en el historial de auditoría

#### F38: Migración desde Pipedrive

**Descripción:** traer al sistema los contactos y el estado comercial que hoy viven en Pipedrive, una sola vez, de forma verificable y repetible. Va después de F37 porque se apoya en el importador de planilla.

**Estado: no construido** (22 de septiembre de 2026). **Inferido, no inspeccionado aparte:** depende de F37, que no existe, y de las columnas de F25, que no están aplicadas.

Los números salen del análisis de los dos exports reales el 17 de septiembre de 2026: 526 personas y 517 tratos. No son estimaciones.

**Qué entra y qué no:**

| Qué | Cuántos | Cómo entra |
|---|---|---|
| Personas de Pipedrive | 526 | Importación de planilla, todas |
| Tratos que no son "IG DM" | 399 | Aplanados en el contacto: etapa, estado, valor, moneda, fecha de cierre |
| Tratos "IG DM" | 118 | **No se migran.** Los trae la conexión de Instagram |
| Los 30 "IG DM" calificados | 30 | Marcado manual en la bandeja, después de conectar el canal |
| Motivo de pérdida | 401 | Como nota en el contacto |

**Por qué los leads de Instagram no se migran.** 118 de los 517 tratos tienen "IG DM" en el título y ninguno corresponde a una persona del CRM: son conversaciones de Instagram anotadas como tratos, y explican 116 de los 119 tratos sin contacto. **Ninguno tiene el usuario de Instagram**: se revisaron los 118 títulos y cero contienen una arroba. La forma es "IG DM - Nombre Apellido", varios con emoji y tipografías decorativas, que es como se ve un nombre para mostrar, no un usuario. El nombre para mostrar no sirve como identificador: se cambia cuando uno quiere y no es único, y el canal de Instagram identifica por usuario.

Al conectar la cuenta, el proveedor reproduce el historial de mensajes directos y esas conversaciones crean los contactos solas, con el usuario real, el nombre real y el hilo completo. Pipedrive tiene un nombre visible y una etapa; Instagram tiene la conversación entera. Se comprobó empíricamente el 16 de septiembre: al conectar una cuenta entraron 33 conversaciones con sus contactos, en segundos.

Lo único que se pierde es la etapa, y vale poco: de los 118, 81 están en "1. Nuevo contacto" o "2. Le escribí", que significan "no hice nada" y "le escribí", y se recuperan abriendo la conversación. Los que tienen criterio propio son unos 30, repartidos en "4. ¿Es mi cliente?" (19), "3. Respondió" (5), "11. Seguimiento intensivo" (3) y "5. Le ofrecí una cita" (2). Esos se marcan a mano en la bandeja, una vez.

**Por qué se migran las 526 personas y no solo las activas:**

| Segmento | Con teléfono o correo | Sin ninguno | Total |
|---|---|---|---|
| Con trato abierto | 2 | 6 | 8 |
| Con trato ganado, o sea clientes | 31 | 13 | 44 |
| Solo con tratos perdidos | 209 | 118 | 327 |
| Sin ningún trato | 139 | 8 | 147 |

Migrar solo los activos dejaría 8 contactos y tiraría 44 clientes. Y sobre todo tiraría los 327 de tratos perdidos, de los cuales 209 son contactables: ese es exactamente el grupo que el sistema existe para trabajar. El negocio ya lo sabe, tiene una etapa llamada "14. Repesca" y otra llamada "11. Seguimiento intensivo".

El argumento decisivo es la asimetría del error: **dejar afuera es irreversible en la práctica, traer de más se corrige mirando.** Si se filtra ahora y en un mes alguien busca un nombre y no aparece, no va a poder distinguir entre "esa persona nunca fue lead" y "la dejamos afuera en la migración". Y 526 filas no cuestan nada. Lo que sí se hace es marcar, no descartar: una etiqueta de origen con la fecha de la migración, más la columna `deal_status`, y con eso la bandeja filtra lo que no quiere ver sin que haya que borrar nada.

**Los dos teléfonos de Pipedrive son un solo campo partido en dos.** Ninguna de las 526 personas tiene los dos cargados, ninguna: no son principal y secundario, la persona que carga usa uno o el otro. "Móvil" tiene 153 valores, limpios, con código de país en 149. "Trabajo" tiene 190, de los cuales 132 son ocho dígitos pelados **sin código de país**. Y hay basura que rompe la normalización en silencio: varios valores traen un apóstrofe inicial, artefacto de planilla de cálculo, y once traen caracteres Unicode invisibles de dirección de texto.

**El campo "Whatsapp chat link" no sirve como fuente de teléfono.** Se verificó contra los teléfonos de las 185 personas que lo tienen: cero coincidencias. Es un identificador interno de la herramienta que lo genera, no un número. Y las 185 que lo tienen ya tienen teléfono, así que tampoco aporta cobertura.

**Criterios de aceptación:**

- [ ] El importador de F37 mapea columnas a `pipeline_stage`, `deal_status`, `deal_value`, `deal_currency`, `deal_closed_at`, `pipedrive_person_id` y `pipedrive_deal_id`. Hoy solo mapea a las columnas centrales del contacto
- [ ] La unión de personas y tratos se hace **fuera del sistema**, en una planilla, produciendo un solo archivo con una fila por contacto. El importador no resuelve la unión
- [ ] Limpieza del teléfono antes de normalizar: se quitan el apóstrofe inicial y los caracteres Unicode invisibles de dirección de texto
- [ ] El teléfono sale de "Móvil" y, si está vacío, de "Trabajo"
- [ ] Los números que ya traen código de país se usan tal como vienen
- [ ] **El código de país por defecto es configuración, no una constante en el código.** Vive como ajuste del espacio de trabajo, y la pantalla de importación permite cambiarlo para esa importación puntual. Hoy el 99 por ciento de los leads es de Costa Rica, pero la pauta puede dirigirse a otros países de la región, y ahí un `+506` cableado convertiría un número panameño de ocho dígitos en un número costarricense **válido y equivocado**, que es peor que un error. Es el mismo criterio que el proyecto ya aplica a las ventanas de mensajería: configuración del canal, no condicionales en el código
- [ ] Cada fila que se normalizó usando el valor por defecto queda marcada en el resumen de la importación, para poder revisar cuáles fueron
- [ ] **La normalización nunca adivina en silencio:** si un número no se puede normalizar, la fila queda con el error en el resumen, no con un valor inventado
- [ ] Todos los contactos migrados reciben una etiqueta de origen con la fecha
- [ ] `pipeline_stage` y `deal_status` rechazan cualquier valor fuera de su lista, en la base de datos
- [ ] **Control de la migración, afirmativo:** la cantidad de filas con `pipedrive_deal_id` no nulo coincide con la cantidad de tratos no "IG DM" del export. Si no coinciden, falta algo y se sabe cuánto. Sin esta comprobación, "el importador dijo 399 filas" no distingue entre 399 de 399 y 399 de 412
- [ ] La importación es repetible: correrla dos veces actualiza en vez de duplicar, y el conteo de control da lo mismo
- [ ] Cada motivo de pérdida entra como una nota en `contact_notes`, con una marca de que vino de la migración. Son 401 tratos con 78 valores distintos de texto libre: **no se crea una columna para esto**, porque 78 valores de texto libre no son un vocabulario. Es la única fuente que el negocio tiene de *por qué* los leads no convierten, y es justo lo que el agente de IA de la Fase 3 va a querer leer
- [ ] **Se escribe explícito y se prueba:** un contacto sin ningún canal no puede darse de alta en una secuencia. Son 145 de las 526, que no tienen ni teléfono ni correo: nunca van a corresponder con un mensaje entrante y no se les puede escribir. Estructuralmente ya no debería poder, porque una secuencia necesita un canal, pero eso es una suposición sobre el motor y el requerimiento no se apoya en suposiciones
- [ ] La prueba lleva su control afirmativo al lado: un contacto **con** canal sí se da de alta

> **Las 145 personas sin correo ni teléfono entran por `pipedrive_person_id`, y no hace falta ninguna excepción.**
>
> Son parte de los 526 que se decidió traer enteros, y traen el identificador de persona de Pipedrive, que es un identificador de deduplicación como cualquier otro: único en el sistema del que vienen, estable, y mejor que un correo escrito a mano. La regla de F37 pide **al menos un identificador que permita deduplicar**, no correo o teléfono en particular, así que estas filas la cumplen sin que nadie tenga que marcar nada.
>
> Que la regla se enuncie así y no como "correo o teléfono" no es una preferencia de redacción. Una casilla que apaga una validación se termina marcando siempre, y "esto es una migración" es una afirmación de quien importa, no un hecho que el sistema pueda verificar.
>
> **Y el modo de falla que esto evita es de los invisibles.** Con la regla mal enunciada, la migración perdería esas 145 filas y el control de conteo daría bien igual, porque cuenta tratos con `pipedrive_deal_id` y estas personas en su mayoría no tienen trato. Un control que dice "si falta algo, se sabe cuánto" y no lo sabe es peor que no tenerlo.


#### F40: Ventana de conversación de Instagram

**Descripción:** calcular, mostrar y respetar la ventana de mensajería de Instagram, que es una regla real de Meta y aplica hoy.

**Estado: no construido** (inspeccionado el 22 de septiembre de 2026). `lib/channel-rules.ts` no tiene ninguna lógica de ventana de conversación.

**Por qué es alcance actual y no plan B:** el canal de Instagram está conectado y operando. Sin esto, un operador escribe una respuesta fuera de la ventana, la envía, y falla con un error genérico. Es el error más común al operar cualquier canal de Meta, y el §0 de este documento ya promete que la ventana de Instagram se conserva completa.

**Criterios de aceptación:**

- [ ] Campos `window_expires_at` y `window_source` agregados a `conversations`
- [ ] `window_expires_at` se recalcula con cada mensaje entrante: 24 horas desde el mensaje
- [ ] En la bandeja, cada conversación muestra un indicador del estado de la ventana: abierta con el tiempo restante, o cerrada
- [ ] La ficha del contacto muestra cada conversación de Instagram con su propio estado de ventana (devuelto el 23/09/2026, auditoría #56b y #64b)
- [ ] Con la ventana abierta, el campo de respuesta acepta texto libre normalmente
- [ ] Con la ventana cerrada, el campo se deshabilita y se explica por qué, sin ofrecer alternativa, porque en Instagram no hay plantillas
- [ ] Un mensaje que falla por ventana expirada muestra un error claro en la interfaz, no un error genérico
- [ ] La respuesta privada a un comentario se permite hasta 7 días desde el comentario, una sola vez por comentario, y el sistema lo controla con `comment_logs`
- [ ] **Control positivo:** con una conversación cuya ventana está abierta, el envío funciona. Probar solo el bloqueo no distingue entre estar bien implementado y estar todo deshabilitado
- [ ] Los campos se agregan igual para WhatsApp aunque no se usen, porque son los mismos que necesita el plan B. Ver el apéndice del plan B


### Apéndice: plan B, escrito y sin construir

Nada de lo que sigue se construye en esta fase. Se conserva especificado porque es lo que hace que la migración a la API oficial sea configuración y no rediseño. El procedimiento de migración, con sus disparadores y sus fuentes, está en `docs/contingencia-whatsapp.md`.

Las funcionalidades conservan la numeración del documento original, F6, F6b y F6c, para que se las reconozca como lo que son: especificación heredada que quedó en suspenso, no funcionalidades nuevas. F6 se sumó el 23 de septiembre de 2026, con los criterios de conexión que la conciliación había perdido.

#### F6: WhatsApp por API oficial vía Zernio

**Descripción**: conectar WhatsApp por la API oficial de Meta a través de Zernio. Acá está solo lo que la conexión le pide al sistema; el alta del número en Meta, con la cuenta de WhatsApp Business, el PIN y el nombre para mostrar, está en `docs/anexo-whatsapp.md`.

**Estado: escrito y sin construir** (decidido el 16 de septiembre de 2026; devuelto al apéndice el 23 de septiembre de 2026). Vive en el apéndice del plan B.

**Criterios de aceptación**:

- [ ] `integration_configs` soporta un registro `type='channel', provider='whatsapp_zernio'` (devuelto el 23/09/2026, auditoría #3)
- [ ] Desde la UI se puede conectar el canal con la API key de Zernio (devuelto el 23/09/2026, auditoría #10)
- [ ] El estado de la conexión es visible en `/settings/integrations` (devuelto el 23/09/2026, auditoría #129)

#### F6b: Plantillas de WhatsApp

**Descripción**: modelar las plantillas de Meta como entidad, con su ciclo de vida.

**Estado: escrito y sin construir** (decidido el 16 de septiembre de 2026). Vive en el apéndice del plan B.

**Criterios de aceptación**:

- [ ] Nueva tabla `whatsapp_templates` (ver 7.3)
- [ ] Pantalla de gestión en `/settings/whatsapp-templates` con listado, estado y categoría
- [ ] El estado de cada plantilla se sincroniza desde Zernio: borrador, enviada, aprobada, rechazada, pausada
- [ ] Cuando Meta rechaza una plantilla, el motivo queda visible en el sistema
- [ ] La calificación de calidad de la plantilla, cuando Zernio la expone, se muestra en el listado
- [ ] Editar una plantilla aprobada crea una versión nueva que vuelve a estado "enviada"
- [ ] **El modelo está listo para que un paso de secuencia referencie una plantilla por ID**, aunque las secuencias se construyan en Fase 2
- [ ] La categoría (marketing, utility, authentication) es obligatoria y visible, porque determina el costo
- [ ] Generan entrada en el historial de auditoría: plantilla de WhatsApp enviada a aprobación, aprobada o rechazada (devuelto el 23/09/2026, auditoría #110b)

*Si Zernio no expone la gestión de plantillas por API (pendiente de confirmar), la creación se hace desde Meta Business Manager y el sistema solo refleja el estado. Los criterios de sincronización se mantienen; los de creación se pasan a Fase 2.*

#### F6c: Ventana de conversación

**Descripción**: calcular, mostrar y respetar la ventana de mensajería de cada conversación.

**Estado: escrito y sin construir** (decidido el 16 de septiembre de 2026). Vive en el apéndice del plan B.

**Criterios de aceptación**:

- [ ] Campos `window_expires_at` y `window_source` agregados a `conversations` (ver 7.2)
- [ ] `window_expires_at` se recalcula con cada mensaje entrante: 24 horas desde el mensaje, o 72 si `window_source = 'ctwa'` (click-to-WhatsApp)
- [ ] En la bandeja, cada conversación muestra un indicador del estado de la ventana: abierta con tiempo restante, o cerrada
- [ ] La ficha del contacto muestra cada conversación con su propio estado de ventana (devuelto el 23/09/2026, auditoría #56b y #64b)
- [ ] Con la ventana **abierta**, el campo de respuesta acepta texto libre normalmente
- [ ] Con la ventana **cerrada en WhatsApp**, el campo de texto libre se deshabilita y se ofrece un selector de plantillas aprobadas, indicando el costo estimado
- [ ] Con la ventana **cerrada en Instagram**, el campo se deshabilita y se explica por qué, sin ofrecer alternativa
- [ ] Un mensaje que falla por ventana expirada muestra un error claro en la interfaz, no un error genérico
- [ ] La respuesta privada a un comentario de Instagram se permite hasta 7 días desde el comentario, una sola vez por comentario, y el sistema lo controla con `comment_logs`

### Funcionalidades de fases siguientes, que no se construyen ahora

| Funcionalidad | Destino |
|---|---|
| Motor de secuencias de seguimiento | Fase 2 |
| Agente de respuesta automática | Fase 2 |
| Filtro de la bandeja por asignación al agente de IA, la opción "Agente IA" que F35 no incluye (devuelto el 23/09/2026, auditoría #77b) | Fase 2, con el agente de respuesta automática |
| Difusiones y envíos masivos | Fase 2 |
| Integración de solo lectura con Calendly: estado de agenda en el contacto y condición en las secuencias | Fase 2 |
| Email bidireccional | Etapa 2 |
| Agente de IA integral con base de conocimiento | Fase 3 |
| Analíticas y tablero de métricas | Fase 3 |
| Publicación de contenido en redes | Etapa 2 |
| TikTok, YouTube y LinkedIn como canales | Etapa 2 |
| Roles personalizados con permisos granulares | Etapa 2 |
| Plantillas de WhatsApp aprobadas por Meta | Plan B, sin fecha |

---

## 6. Flujos principales

### Flujo 1: Mensaje entrante de WhatsApp

**Descripción:** el camino completo desde que un lead escribe hasta que aparece en la bandeja.

1. El lead escribe al número del negocio.
2. Evolution recibe el mensaje y avisa a nuestro receptor, con un dato de autenticación firmado.
3. El receptor verifica ese dato. Si no es válido, rechaza y dispara una alerta, porque ese mensaje se pierde.
4. Verifica que no sea un aviso repetido. Si lo es, acusa y descarta.
5. Responde el acuse de inmediato y encola el procesamiento.
6. El procesamiento busca el contacto: primero por el identificador de canal, después por teléfono normalizado. Si el identificador es opaco y no hay teléfono, crea el contacto con la marca de "sin resolver".
7. Guarda el mensaje con su control de duplicados.
8. Si hay adjunto, lo descarga y lo sube al almacenamiento. Si falla, lo marca y reintenta.
9. Actualiza la conversación y avisa a las pantallas abiertas, respetando el alcance por rol.

**Resultado exitoso:** el mensaje aparece en la bandeja de quien corresponde, con su adjunto, asociado al contacto correcto.

**Casos de error:** si la autenticación falla, se alerta y el mensaje se pierde, por eso el cambio de secreto tiene procedimiento. Si la descarga del adjunto falla, el mensaje igual queda guardado con el texto y una marca. Si el procesamiento falla después del acuse, queda en la cola para reintentar.

### Flujo 2: Reconciliación de un contacto sin teléfono

**Descripción:** cómo se resuelve un lead que entró sin número identificable.

1. Existe un contacto con la marca de "teléfono sin resolver".
2. Llega un mensaje posterior que sí trae el teléfono, o el operador lo carga a mano desde la ficha.
3. El sistema busca si ya existe otro contacto con ese teléfono.
4. Si existe, propone la fusión mostrando los dos lados con sus datos.
5. Una persona confirma. Al confirmar se unifican conversaciones, notas, etiquetas y atribución.
6. Si no existe otro contacto, simplemente se completa el teléfono y se saca la marca.

**Resultado exitoso:** un solo contacto con todo su historial junto, y el registro de la fusión en la auditoría.

**Casos de error:** si la fusión se confirma por equivocación, el historial de auditoría permite reconstruir qué se unió. Por eso la fusión nunca es automática.

### Flujo 3: La sesión de WhatsApp se cae

**Descripción:** qué pasa y cómo se detecta cuando el número se desconecta.

1. La sesión expira o WhatsApp cierra el vínculo.
2. Si la caída es definitiva, Evolution avisa y el sistema marca el canal como caído.
3. Si es pasajera, Evolution reconecta solo y no avisa: el chequeo periódico es el que lo detecta.
4. La pantalla de canales muestra el estado, y la bandeja indica que WhatsApp no está recibiendo.
5. El Owner o un Admin pide reconectar y escanea el código.
6. Todo el ciclo queda en el historial de auditoría.

**Resultado exitoso:** el canal vuelve a recibir y nadie pasó días creyendo que no había mensajes.

**Casos de error:** si se agotaron los intentos de vinculación, el botón de reconectar no puede entregar un código y la pantalla explica que hay que empezar de nuevo.

### Flujo 4: Primer setup de WhatsApp, cuando llegue el número

**Descripción:** el orden correcto para conectar el canal.

1. Desplegar Evolution, si no está desplegado.
2. Crear la instancia y guardar sus credenciales en Vault.
3. Configurar el aviso de mensajes con el secreto.
4. Verificar que el receptor acepta un aviso de prueba firmado, **antes** de vincular el número.
5. **Confirmar que F27 y F32 están construidas y probadas.** Si falta cualquiera de las dos, el checklist se detiene acá. Ver la regla dura en 4.7.
6. Vincular el número escaneando el código.
7. Mandar un mensaje de prueba desde otro teléfono y confirmar que aparece en la bandeja y en la base.

**Resultado exitoso:** el canal queda conectado y el primer mensaje real queda guardado.

**Casos de error, y son tres puertas distintas que se cierran en silencio.** Si se invierte el orden y se vincula el número antes de verificar el receptor, los primeros mensajes reales se **rechazan** y se pierden sin dejar rastro: ese es el motivo del paso 4. Si se vincula antes de que exista F27, los mensajes se **aceptan** y se descartan igual, que es peor todavía, porque el receptor responde que todo salió bien: ese es el motivo del paso 5. Y si se vincula con F27 pero sin F32, los mensajes se guardan bien hasta que la sesión se cae, y a partir de ahí no llega nada y **la bandeja se ve igual que un día tranquilo**: ese es el otro motivo del paso 5, y F39 no lo tapa, porque detectar el silencio no es poder reconectar. En los tres casos el resultado es el mismo, conversaciones perdidas sin ningún síntoma, y por eso los pasos son obligatorios y no intercambiables.

### Flujo 5: Mensaje entrante de Instagram

**Descripción:** el mismo camino que WhatsApp, por otro proveedor.

1. El lead escribe o responde una historia.
2. Zernio avisa a nuestro receptor con firma criptográfica.
3. Se verifica la firma, se controla el duplicado, se acusa y se encola.
4. Se resuelve el contacto y se guarda el mensaje.
5. Se recalcula la ventana de 24 horas de la conversación.

**Resultado exitoso:** el mensaje aparece en la misma bandeja que los de WhatsApp, con su estado de ventana visible.

**Casos de error:** sin firma válida se rechaza. Fuera de la ventana, la bandeja no deja escribir texto libre y lo explica.

### Flujo 6: Migración desde Pipedrive

**Descripción:** el camino completo de la migración, una sola vez. Corresponde a F38.

1. El negocio exporta desde Pipedrive dos archivos, personas y tratos.
2. Fuera del sistema, en una planilla, se unen por identificador de persona y se descartan los tratos con "IG DM" en el título. Queda un solo archivo con una fila por contacto.
3. Se revisa esa planilla con los ojos antes de tocar la base de datos.
4. Se importa con el flujo de F37, mapeando también las columnas comerciales.
5. El sistema normaliza teléfonos, deduplica por teléfono o correo, y crea o actualiza.
6. Se corre el control de la migración: cantidad de filas con identificador de trato contra cantidad de tratos del export.
7. Se conecta el canal de Instagram. El proveedor reproduce el historial y crea los contactos de los leads de Instagram, con su usuario real.
8. El negocio marca a mano en la bandeja los treinta leads de Instagram que estaban calificados.

**Resultado exitoso:** los 526 contactos con su estado comercial, los leads de Instagram con su conversación completa, y los conteos que cuadran.

**Casos de error:** si el conteo del paso 6 no cuadra, la migración no se da por buena y se revisa la planilla del paso 2. Si un teléfono no se puede normalizar, la fila entra con el error listado, no con un número inventado.

---

## 7. Modelo de datos

### 7.1 Extensiones a tablas existentes

| Entidad | Campo | Tipo | Requerido | Descripción |
|---|---|---|---|---|
| contacts | phone | text | No | Teléfono en E.164, normalizado en servidor según la definición de §14. Puede no existir |
| contacts | phone_resolved | boolean | Sí | Marca si el teléfono ya se conoce |
| contacts | secondary_email | text | No | Correo alternativo |
| contacts | country | text | No | País del lead |
| contacts | display_name_source | text | Sí | `provider` o `manual`, con restricción de valores. Un nombre `manual` no lo pisa ningún camino automático. Ver F25. **Acá había una fila `instagram_username`, que se sacó el 22 de septiembre de 2026:** el handle es por canal y va en `contact_channels.platform_username`, que ya existe |
| contacts | whatsapp_phone | text | No | Teléfono de WhatsApp si difiere del principal |
| contacts | next_followup_date | date | No | Próximo seguimiento programado |
| contacts | do_not_contact | boolean | Sí | Pidió no ser contactado |
| contacts | do_not_contact_reason | text | No | Motivo registrado |
| contacts | do_not_contact_at | timestamptz | No | Cuándo lo pidió |
| contacts | lead_temperature | text | No | Frío, tibio o caliente |
| contacts | ai_conversation_summary | text | No | Resumen generado, se usa en Fase 3 |
| contacts | attribution | jsonb | Sí | Primer y último clic de origen |
| contacts | deleted_at | timestamptz | No | Marca de borrado suave |
| contacts | pipeline_stage | text | No | Etapa del embudo heredado, con restricción de valores. Solo se llena en contactos migrados |
| contacts | deal_status | text | No | `abierto`, `ganado` o `perdido`, con restricción de valores |
| contacts | deal_value | numeric | No | Valor del trato |
| contacts | deal_currency | text | No | Moneda del valor: en los datos migrados, `USD` o `CRC`. Sin esto el valor no significa nada |
| contacts | deal_closed_at | date | No | Fecha de cierre, ganado o perdido |
| contacts | pipedrive_person_id | text | No | Identificador de origen. Es el control de la migración, ver F38 |
| contacts | pipedrive_deal_id | text | No | Identificador del trato de origen |
| contacts | booking_status | text | No | `sin_agendar`, `agendada`, `asistio`, `no_asistio`, `cancelada`. Lo escribe la Fase 2 |
| contacts | booking_at | timestamptz | No | Fecha y hora de la reunión agendada. Lo escribe la Fase 2 |
| contacts | booking_external_id | text | No | Identificador de la reserva en el proveedor de agenda. Lo escribe la Fase 2 |
| contact_channels | raw_jid | text | Sí | Identificador tal como llegó, sin transformar |
| contact_channels | addressing_mode | text | No | Cómo se direccionó el mensaje |
| contact_channels | profile_status | text | Sí | `pending`, `complete` o `unavailable`, con restricción de valores y default `pending`. Si el proveedor ya completó el perfil del remitente en ese canal. Ver F27 |
| contact_channels | profile_attempts | smallint | Sí | Intentos de completar el perfil, default 0. A los 3 sin perfil, `profile_status` pasa a `unavailable` y no se reintenta más. Ver F27 |
| messages | platform_message_id | text | Sí | Identificador del proveedor |
| messages | remote_jid | text | Sí | Conversación a la que pertenece |
| messages | from_me | boolean | Sí | Dirección del mensaje |
| messages | message_type | text | Sí | Texto, imagen, audio, documento, video, sticker o ubicación |
| messages | quoted_message_id | text | No | Mensaje citado, para reconstruir hilos |
| messages | media_path | text | No | Ruta del archivo en el almacenamiento |
| messages | media_status | text | Sí | Pendiente, descargado, fallido o no disponible |
| channels | provider | text | Sí | `zernio` o `evolution` |
| channels | instance_name | text | No | Nombre de la instancia de Evolution |
| channels | late_account_id | text | **Pasa a No** | Identificador de cuenta de Zernio. Era obligatorio; ahora es opcional. **No identifica una cuenta de Instagram:** Zernio lo reusó para otra cuenta el 22 de septiembre de 2026. Ver F26 |
| channels | platform_account_id | text | No | Identificador de la cuenta en la plataforma (`platformUserId` en Zernio). Es la identidad del canal, según el criterio de F26 agregado el 22 de septiembre de 2026. Vacío en los canales de Evolution |
| channels | session_state | text | No | Estado de conexión conocido |
| channels | session_checked_at | timestamptz | No | Última verificación |
| channels | safety_config | jsonb | Sí | Las seis reglas de seguridad de secuencia |

**Restricción de unicidad en `messages`:** la combinación de `remote_jid`, `platform_message_id` y `from_me`.

**`channels.instance_name` lleva un índice único global, no por espacio de trabajo.** La búsqueda va de nombre de instancia a canal a espacio de trabajo, y está en el camino que autentica cada mensaje entrante: si dos canales pudieran compartir nombre, esa búsqueda sería ambigua. Además los nombres de instancia son globales del lado de Evolution.

**Por qué `late_account_id` pasa a opcional.** Un canal de Evolution no tiene cuenta de Zernio. El valor correcto es vacío, no el nombre de la instancia metido en una columna que dice otra cosa: esa clase de atajo es la que produjo `late_api_key_encrypted`, una columna que decía "encrypted" y guardaba texto plano, y costó dos sesiones deshacerla.

Sacarle el `NOT NULL` destapó un error que ya estaba latente en el código heredado. El bucle que desactiva canales cuyas cuentas de Zernio dejaron de existir compara contra un conjunto de identificadores: con el valor en nulo la comparación da negativa siempre, así que **cada vez que alguien apretara "Sincronizar" en la pantalla de canales, el canal de WhatsApp quedaría desactivado**, y a partir de ahí todos los mensajes entrantes se rechazarían sin síntoma. Se corrige salteando los canales que no son de Zernio en ese bucle, con su prueba afirmativa al lado: un canal de Zernio cuya cuenta ya no existe **tiene** que seguir desactivándose, porque si la guarda queda mal escrita la sincronización deja de limpiar y nadie se entera.

**Alcance de lo que se construye en el Bloque 2:** del bloque de columnas de `channels` de esta tabla, el Bloque 2 agrega solamente `provider`, `instance_name` y el cambio de `late_account_id`, que es lo mínimo para resolver instancia → canal → espacio de trabajo y poder leer el secreto. `session_state`, `session_checked_at` y `safety_config` van en el Bloque 4, con las funcionalidades que las usan.

#### El estado comercial heredado: por qué son columnas y no campos personalizados

Las siete columnas que van de `pipeline_stage` a `pipedrive_deal_id` guardan el estado comercial que hoy vive en Pipedrive, el CRM actual del negocio. Se llenan solo en los contactos que entran por la migración de F38.

**La etapa es una columna con restricción de valores, no un campo personalizado ni una etiqueta.** Los campos personalizados del sistema tienen seis tipos (texto, número, booleano, fecha, url, correo) y **ninguno es de lista**: la etapa quedaría como texto libre y en dos semanas habría "Negociación", "negociacion" y "En negociación" como tres etapas distintas. Las etiquetas tampoco sirven, porque permiten dos etapas a la vez y un contacto está en exactamente una. Con una columna y su restricción, la exclusividad y el vocabulario los garantiza la base de datos, no la disciplina de nadie.

**Los trece valores de `pipeline_stage`**, tal como los escribe el negocio:

```
1. Nuevo contacto
2. Le escribí
3. Respondió
4. ¿Es mi cliente?
5. Le ofrecí una cita
6. Agendó
7. Confirmó asistencia
8. No llegó
9. Reagendó
11. Seguimiento intensivo
12. En espera de pago
13. ¡Cerrada!
14. Repesca
```

La numeración salta del 9 al 11: el embudo no tiene etapa 10. Se transcribe como está, con la numeración adentro del texto, para que coincida carácter por carácter con el export y la importación no falle por una tilde.

**La etapa y el estado son dos cosas independientes, y por eso son dos columnas.** El cruce de los 517 tratos del export lo muestra sin lugar a dudas: **253 están en "1. Nuevo contacto" y a la vez perdidos.** La etapa dice dónde quedó la conversación; el estado dice qué pasó con el trato. Con una sola columna, esos 253 contactos parecerían leads nuevos sin trabajar.

**`deal_currency` no es opcional en la práctica.** De los 517 tratos, 363 están en dólares y 154 en colones. Un valor sin moneda es un número sin significado. El 87 por ciento de los tratos tiene valor cero, así que la columna va a venir casi vacía de todos modos: se agrega para que los 68 que sí tienen valor sean legibles. **No lleva restricción de valores en la base**, a diferencia de `pipeline_stage` y `deal_status`, y la diferencia no es de rigor sino de qué clase de vocabulario es cada uno. Las etapas son un vocabulario **arbitrario y propio del negocio**: los inventó alguien, no existen fuera de acá, y por eso la base tiene que ser la que garantice que nadie escriba una decimocuarta. Los códigos de moneda son un **estándar**, definido afuera y completo desde antes que este proyecto. Enumerar los dos que hay hoy en los datos no protege de nada y garantiza una sola cosa: que el día que haya una campaña en México, la importación se caiga por algo que no es un error.

Esto no contradice la regla de que una normalización nunca adivina en silencio. Un valor por defecto adivina; una restricción rechaza a los gritos, y rechazar a los gritos es seguro. Lo que se evita acá no es el rechazo, es rechazar un dato correcto.

**No se agrega fecha esperada de cierre:** solo 3 de los 517 tratos la tienen.

#### Las tres columnas de agenda se agregan ahora y las escribe la Fase 2

`booking_status`, `booking_at` y `booking_external_id` no las escribe nada de esta fase. Se agregan igual, por la misma razón que `ai_conversation_summary` y `lead_temperature`: el modelo contempla lo que viene para no migrar datos después. Las llena la integración de solo lectura con Calendly de la Fase 2, y el día que exista el agendador propio de la Etapa 4 las escribe él, sin cambio de esquema. El detalle está en la sección 13.

#### Estas columnas van en una migración nueva

Ninguna de las columnas de `contacts` de esta sección está aplicada todavía: hoy la tabla tiene las del fork más `setter_id` y `vendedor_id` de la 00017. Las diez columnas nuevas de este bloque se aplican **en el mismo lote que el resto de las extensiones de `contacts` del Bloque 3**, en una migración numerada propia, idempotente, sin tocar ninguna migración ya aplicada.

### 7.2 Tablas nuevas

| Tabla | Para qué |
|---|---|
| contact_notes | Notas internas sobre el contacto |
| response_templates | Respuestas rápidas reutilizables |
| audit_log | Quién hizo qué y cuándo |
| integration_configs | Configuración de cada servicio externo conectado |
| csv_imports | Registro de cada importación de planilla |
| webhook_alerts | Condiciones abiertas del receptor de avisos: rechazos de autenticación e instancias desconocidas |

**Columnas, tal como quedaron en las migraciones 00022 y 00023 ya aplicadas.** Los nombres son los reales del esquema, no los del borrador:

| Columna | Para qué |
|---|---|
| `workspace_id`, `channel_id` | A quién le pasa. **Las dos pueden ser nulas** |
| `source` | El proveedor del aviso. Hoy solo `evolution` |
| `alert_condition` | `webhook_auth_failed` o `webhook_unknown_instance` |
| `detail` | Motivo corto, acotado a 200 caracteres. Nunca el cuerpo del aviso ni credenciales |
| `occurrences`, `first_seen_at`, `last_seen_at` | El contador y las dos marcas de tiempo |
| `resolved_at` | Nulo mientras la condición está abierta |

Se llama `alert_condition` y no `condition` porque `CONDITION` es una palabra reservada del lenguaje de procedimientos de PostgreSQL, y las funciones que escriben esta tabla están escritas en ese lenguaje. El nombre feo evita una ambigüedad que no se ve al leer y que rompería al aplicar.

**Agrupa por condición, no por evento.** Un rechazo nunca viene solo: los tres escenarios donde ocurre (un cambio de secreto mal hecho, el mecanismo de autenticación que desaparece en una actualización de Evolution, una configuración equivocada) hacen que fallen **todos** los avisos hasta que alguien intervenga. Si entran quinientos en una hora, eso es una fila con un contador en quinientos, no quinientas filas ni quinientos avisos.

**Dos condiciones distintas, y no se comportan igual en nada.** La tabla de abajo es el resumen, y cada diferencia tiene su motivo:

| | Rechazo de autenticación | Instancia desconocida |
|---|---|---|
| Qué responde el receptor | Rechazo definitivo | **Servicio no disponible**, que sí se reintenta |
| ¿Se perdió el mensaje? | **Sí**, el proveedor no reintenta | **Todavía no**: hay unos 20 minutos de reintentos |
| Qué cuenta el contador | Mensajes perdidos | Intentos de entrega, con un tope de uno por minuto |
| Espacio de trabajo | Sí, sabe de qué canal viene | **No**, no hay canal al que atribuirlo |
| Cómo se cierra | Sola, con el primer aviso válido | **Solo a mano** |

**Por qué la instancia desconocida no responde un rechazo definitivo.** El caso que importa no es una sonda de internet: es que alguien renombre la instancia en Evolution, o que se edite la fila del canal. A partir de ese momento cada mensaje real cae ahí. Si se respondiera un rechazo definitivo, el proveedor cancelaría los reintentos y se perderían todos; respondiendo "servicio no disponible" los reintenta durante unos veinte minutos, así que corregir el nombre dentro de esa ventana los recupera. El rechazo de autenticación **no** se trata igual, y a propósito: un dato de autenticación que no verifica es indistinguible de una falsificación, y darle reintentos sería regalarle diez entregas por evento a quien esté probando.

**Por qué la instancia desconocida no se cierra sola.** Se intentó y se descartó, porque se contradecía con la propia decisión de agrupación. La idea era cerrarla cuando llegara un aviso válido de la instancia que figura en el detalle, pero el detalle guarda el nombre de la **última** instancia desconocida, no el de la que causó el problema: con tres nombres distintos, arreglar el que rompía de verdad no cerraría nada. Y peor, cualquier nombre inventado posterior al arreglo pisa el detalle y desactiva el cierre para siempre; como ese nombre lo elige quien manda el aviso, eso queda al alcance de cualquiera que conozca la dirección. Una alerta que a veces se limpia sola y a veces no enseña a no creerle.

**Por qué el nombre de la instancia no entra en la agrupación, y por qué se acota.** Lo controla quien llama. Si se agrupara por él, cualquiera llenaría la tabla mandando nombres al azar; por eso **todas** las instancias desconocidas van a una sola condición, con el nombre únicamente en el detalle de la última. Y como ese texto se muestra en el dashboard, se corta a 200 caracteres al guardarlo y se muestra delimitado, para que no pueda romper la pantalla ni hacerse pasar por un mensaje del sistema.

**El tope de escritura.** La condición de instancia desconocida se alcanza **antes** de verificar la autenticación, porque para verificarla hay que saber de qué canal se trata. Eso significa que cualquiera puede provocar una escritura mandando un aviso bien formado con un nombre inventado. Por eso esa condición no se actualiza más de una vez por minuto. El contador pierde precisión y no importa, porque ahí ya no cuenta mensajes.

**Quién puede leerlas.** Las condiciones que tienen espacio de trabajo las leen su Owner y sus Admin, y eso lo decide la base de datos. La condición de instancia desconocida **no la lee nadie por esa vía**: no es atribuible a ningún espacio de trabajo, así que su permiso no puede colgarse de pertenecer a uno. La lee la pantalla de canales, en el servidor, comprobando el rol antes de consultarla. Es la misma decisión que el resto del sistema toma al revés, y la excepción está justificada: una regla que dijera "cualquier Owner de cualquier espacio de trabajo" mostraría a un negocio el nombre de la instancia de otro.

**Por qué no se reusa el historial de auditoría,** que es la alternativa obvia: ese historial responde *quién hizo qué*, y un rechazo de autenticación no tiene autor. Y además nunca se purga, así que un cambio de secreto mal hecho lo llenaría para siempre con el mismo evento repetido.

**Una alerta que nadie consulta es un diario.** La pantalla de canales muestra un indicador de condiciones sin resolver, que es donde alguien va a mirar cuando sospeche que algo no está entrando. Incluye el botón de cierre manual, que para la condición de instancia desconocida es el único cierre que existe.

### 7.3 Notas de optimización

**Tablas que se evitaron.** No se crea una tabla separada para el estado de sesión del canal: es un campo en `channels`, porque siempre hay exactamente un estado por canal y no hace falta historial. No se crea tabla de adjuntos: el archivo es un campo del mensaje, porque un mensaje tiene como máximo un adjunto en estos canales. No se crea tabla de reglas de seguridad: son configuración de un canal y viven como un campo estructurado.

**Campos agregados para etapas futuras.** `ai_conversation_summary` se agrega ahora aunque el agente de IA es Fase 3, para no migrar datos después. `lead_temperature` y `next_followup_date` se agregan ahora aunque el pipeline comercial es Etapa 4. El campo `provider` en `channels` existe para que agregar un canal de otro proveedor no requiera cambios de esquema.

**Lo que queda especificado y sin construir.** La tabla de plantillas de WhatsApp y los campos de ventana de conversación para WhatsApp quedan escritos para el plan B. Si alguna vez se migra a la API oficial, esa parte se activa sin rediseñarla.

### 7.4 Políticas de datos

| Política | Definición |
|---|---|
| Borrado suave | Contactos, notas, conversaciones y respuestas rápidas. Retención de 30 días y después purga |
| Auditoría | Todas las entidades principales registran quién y cuándo. El historial de auditoría nunca se borra |
| Snapshot | No aplica todavía: los precios son de la Etapa 4 |
| Deduplicación | Por un identificador único y estable, nunca solo por nombre ni por nombre de usuario. Cuáles califican está enumerado en la sección 14, y la lista es cerrada: sumar uno es una decisión que se escribe |

---

## 8. Arquitectura del sistema

**Frontend.** [Next.js](https://nextjs.org) 16 con React 19 y App Router. Componentes de servidor más hooks, sin almacén global de estado. Estilos con [Tailwind CSS](https://tailwindcss.com) v4.

**Backend.** Rutas de API dentro de la misma aplicación para recibir los avisos de los proveedores, y acciones de servidor para las operaciones de la interfaz.

**Base de datos.** [Supabase](https://supabase.com) con seguridad por filas activada en todas las tablas. En simple: la base decide qué puede ver cada persona, no la pantalla.

**Integraciones externas.**

| Servicio | Para qué | Cómo se conecta |
|---|---|---|
| Zernio | Instagram | API oficial de Meta, con firma criptográfica en los avisos |
| Evolution API | WhatsApp | Servicio propio en Railway, con aviso autenticado |
| Resend | Correo saliente | Clave guardada en Vault |
| OpenAI, Anthropic, Google | IA | Claves del propio negocio, guardadas en Vault |

**Autenticación.** Supabase Auth con cookies seguras del lado del servidor.

**Almacenamiento de archivos.** Supabase Storage, bucket privado.

### Despliegue

Un proyecto de Railway con tres servicios:

| Servicio | Qué es | Dominio público |
|---|---|---|
| Aplicación Next.js | Dashboard y receptores de avisos | Sí |
| Evolution API | Motor de WhatsApp, versión fijada | No |
| PostgreSQL de Evolution | Estado interno de Evolution, incluida la sesión | No |

Railway factura por consumo de recursos, no por cantidad de servicios.

**Dos bases de datos PostgreSQL, y no son intercambiables.** Supabase guarda los datos del negocio. La de Railway guarda el estado interno de Evolution. Ninguna consulta de la aplicación toca la segunda.

**Una aclaración de seguridad que conviene dejar escrita.** La red privada de Railway no es una capa de defensa en esta arquitectura. El receptor de avisos es una ruta de la aplicación, y la aplicación tiene dominio público porque es el dashboard. Que Evolution entre por la puerta privada no cierra la pública. Para que lo fuera habría que sacar el receptor a un servicio sin dominio propio, y eso es un cambio de arquitectura que hoy no está presupuestado.

---

## 9. Almacenamiento de archivos

| Aspecto | Definición |
|---|---|
| Dónde | Supabase Storage, plan Pro, 100 GB incluidos |
| Bucket | `message-media`, privado, con direcciones firmadas de vida corta |
| Estructura | Por espacio de trabajo, conversación y mensaje |
| Límites | Tamaño máximo configurable. Validación del tipo real de archivo en el servidor, no de la extensión |
| Temporales | La descarga ocurre en segundo plano; si falla, el mensaje queda marcado y se reintenta |
| Retención | Los adjuntos siguen la retención del mensaje. Si el contacto se purga a los 30 días de eliminado, sus archivos también |
| Cuándo revisar | Si el volumen mensual de archivos supera unos pocos gigabytes, evaluar un almacenamiento de objetos más barato. No es una preocupación de esta fase |

---

## 10. Stack y decisiones técnicas

| Componente | Tecnología | Justificación |
|---|---|---|
| Base del proyecto | Fork de [ZernFlow](https://github.com/zernio-dev/zernflow), licencia MIT | Resuelve bandeja, CRM básico, motor de flujos y conexión con Zernio. Construir eso de cero eran semanas |
| Frontend | Next.js 16.1.6 con React 19.2.4 | Viene del fork. Cambiarlo implicaría reescribirlo entero |
| Estilos | Tailwind CSS 4.1.18 | Viene del fork. Atención: es v4, no v3, y la sintaxis difiere |
| Base de datos y auth | Supabase, plan Pro | Constante del método. El plan Pro hace falta por el almacenamiento y por Vault |
| Secretos | Supabase Vault | Las claves de terceros nunca en variables de entorno de la aplicación ni en texto plano |
| Instagram | Zernio sobre API oficial de Meta | Es el único de los dos proveedores que soporta Instagram |
| WhatsApp | Evolution API autoalojado | El seguimiento del negocio es semanal y cae fuera de la ventana de Meta. En la API oficial cada seguimiento sería un mensaje de plantilla con costo |
| Correo | Resend | Constante del método |
| IA | Vercel AI SDK v6 con claves del propio negocio | El negocio paga su propio uso; el sistema no cobra por intermediar |
| Hosting | Railway | Control total, costos por consumo, y Evolution necesita un servicio propio de todos modos |
| Versionado | GitHub | Constante del método |
| Testing | Vitest | Viene del fork |

**Una decisión técnica que conviene explicar.** El fork no usa [Zod](https://zod.dev) para validar datos. Si en algún momento hace falta validación de estructuras, se adopta Zod 4, no la versión 3, para evitar mezclar dos formas distintas de escribir lo mismo.

---

## 11. Pantallas principales

### 11.1 Convenciones globales

**Navegación.** Barra lateral fija en escritorio con las secciones principales: bandeja, contactos, canales, flujos, secuencias y configuración. En móvil la barra se colapsa en un menú.

**Sistema visual.** Tipografía del sistema, espaciado consistente, y los componentes reutilizables que ya trae el fork: botones, campos, tarjetas, tablas y ventanas modales. No se introduce una librería de componentes nueva.

**Estados estándar, obligatorios en todas las pantallas.**

| Estado | Qué se muestra |
|---|---|
| Vacío | Explicación de qué va a aparecer ahí y un botón que lleva a la acción que lo llena. Nunca una pantalla en blanco |
| Cargando | Esqueleto de la estructura, no un círculo girando sobre la nada |
| Error | Mensaje en lenguaje claro y una acción sugerida. Nunca el error técnico crudo |
| Éxito | Confirmación breve que desaparece sola |

**Responsive.** Todas las pantallas funcionan en teléfono. La bandeja en móvil muestra la lista de conversaciones o el hilo, no las dos cosas a la vez.

### 11.2 Detalle por pantalla

#### Bloque 2

##### Pantalla: Configuración de integraciones

- **Propósito:** conectar los servicios externos en un solo lugar.
- **URL:** `/settings/integrations`
- **Layout:** una columna con secciones plegables, una por tipo de servicio.
- **Componentes:**
    - Sección de canales, con una tarjeta por canal: nombre, estado, campos de conexión y botones de conectar y desconectar. La tarjeta de WhatsApp muestra la conexión con Evolution; el estado de sesión y el botón de reconectar con el código QR están en la pantalla de canales, que es F32 (decidido el 22 de septiembre de 2026, ver §0).
    - Sección de correo, con la clave de Resend y el dominio verificado.
    - Sección de IA, con una fila por proveedor: clave y modelo por defecto.
- **Estados:** con servicios conectados se ve el estado de cada uno; sin nada conectado, cada tarjeta explica para qué sirve ese servicio y qué se gana conectándolo.
- **Interacciones:** al guardar una clave se valida el formato y se prueba la conexión. El campo de clave nunca muestra el valor guardado, solo si está configurada o no.
- **Reglas:** solo Owner y Admin. Un Member que intente entrar es redirigido, y el control está en el servidor, no en la pantalla.
- **Responsive:** las secciones se apilan.

#### Bloque 3

##### Pantalla: Ficha de contacto

- **Propósito:** la vista completa de un lead.
- **URL:** `/contacts/[id]`
- **Layout:** dos columnas en escritorio. Izquierda con los datos, derecha con conversaciones y notas.
- **Componentes:** datos personales y de contacto, asignaciones de setter y vendedor, temperatura, próximo seguimiento, atribución de origen, etiquetas, campos personalizados, lista de conversaciones por canal, notas cronológicas e historial de cambios.
- **Estados:** si el teléfono está sin resolver, se muestra una marca con un campo para cargarlo a mano. Si el contacto pidió no ser contactado, se muestra una marca roja.
- **Interacciones:** al cargar un teléfono a mano, si ya existe otro contacto con ese número, se abre la propuesta de fusión mostrando los dos lados. La fusión la confirma la persona.
- **Reglas:** un Member solo abre la ficha de sus propios leads. Si le sacan la asignación mientras la tiene abierta, ve un mensaje claro, no un error de permisos.
- **Responsive:** las columnas se apilan, con los datos arriba.

#### Bloque 4

##### Pantalla: Bandeja

- **Propósito:** donde el equipo trabaja todos los días.
- **URL:** `/inbox`
- **Layout:** tres zonas en escritorio: filtros y lista de conversaciones a la izquierda, hilo en el centro, datos del contacto a la derecha.
- **Componentes:** barra de filtros con contador de filtros activos, lista de conversaciones con vista previa y canal, hilo de mensajes con sus adjuntos, campo de respuesta con selector de respuestas rápidas.
- **Estados:** sin conversaciones, explica que ahí van a aparecer los mensajes cuando se conecte un canal. Si un canal está caído, un aviso visible lo indica, porque si no una bandeja sin mensajes parece un día tranquilo.
- **Interacciones:** escribir "/" abre el selector de respuestas rápidas. En Instagram, con la ventana cerrada, el campo se deshabilita y explica por qué. Con un contacto marcado como no contactar, el envío se bloquea.
- **Reglas:** un Member ve solo sus conversaciones, y eso lo garantiza la base.
- **Responsive:** en móvil se ve la lista o el hilo, con navegación entre los dos.

##### Pantalla: Canales

- **Propósito:** ver y administrar el estado de las conexiones.
- **URL:** `/dashboard/channels`
- **Layout:** una tarjeta por canal.
- **Componentes:** nombre del canal, cuenta conectada, estado de sesión con su fecha de verificación, y botón de reconectar con el código QR cuando corresponde.
- **Estados:** conectado, caído, sin verificar y "se agotaron los intentos", cada uno con su explicación en lenguaje claro.
- **Interacciones:** el botón de reconectar no siempre puede entregar un código, y cuando no puede lo dice en lugar de fallar en silencio.
- **Reglas:** solo Owner y Admin.

##### Pantalla: Configuración del canal de WhatsApp

- **Propósito:** ajustar las seis reglas que protegen el número.
- **URL:** `/settings/channels/whatsapp`
- **Componentes:** un control por regla, con su valor por defecto y una explicación de una línea de para qué sirve y qué pasa si se desactiva.
- **Reglas:** solo Owner y Admin. La regla de opt-out no se puede desactivar.

---

## 12. Guías de interfaz, marca y diseño

El negocio tiene identidad visual propia, pero el sistema es una herramienta interna, no una pieza de marca. Se usa el diseño neutro y profesional que trae el fork, con estas pautas:

- **Tono de los textos:** claro y directo, sin jerga técnica. Un mensaje de error dice qué pasó y qué hacer, no un código.
- **Prioridad a las acciones de un clic.** Lo que se hace todos los días, como responder o asignar, no debería requerir abrir una ventana.
- **Nada de ventanas modales para formularios largos.** La ficha de contacto se edita en su propia pantalla.
- **Densidad de información alta en la bandeja.** Es una herramienta de trabajo, no una página de marketing: más conversaciones visibles sin desplazarse es mejor.
- **Colores con significado consistente.** El rojo se reserva para bloqueos y advertencias reales, como "no contactar" o "canal caído". Si todo es rojo, nada lo es.

La personalización de marca del negocio, si en algún momento hace falta, se configura desde la interfaz, no tocando código.

---

## 13. Fuera del alcance de esta fase

### Para fases siguientes de esta etapa

| Funcionalidad | Fase destino | Nota |
|---|---|---|
| Motor de secuencias de seguimiento | Fase 2 | Consume las reglas de seguridad que se definen acá |
| Agente de respuesta automática | Fase 2 | |
| Difusiones y envíos masivos | Fase 2 | La tabla ya existe en el fork y se conserva |
| Agente de IA integral | Fase 3 | Lee el historial que se empieza a guardar en el Bloque 3 |
| Analíticas y tablero de métricas | Fase 3 | Solo son posibles porque los mensajes se guardan |
| Integración de solo lectura con Calendly | Fase 2 | Escribe las tres columnas de agenda que esta fase agrega al contacto. Ver abajo: una de sus decisiones se toma ahora |

### Para etapas futuras

| Funcionalidad | Etapa destino | Nota |
|---|---|---|
| Publicación de contenido en redes | Etapa 2 | |
| TikTok, YouTube y LinkedIn como canales | Etapa 2 | La estructura de integraciones ya lo contempla |
| Email bidireccional | Etapa 2 | Acá solo sale correo, no entra |
| Roles personalizados con permisos granulares | Etapa 2 | Hoy son tres roles fijos |
| Meta Ads | Etapa 2 | |
| Fathom y conector MCP | Etapa 3 | |
| Agendamiento y pipeline comercial | Etapa 4 | Opcional |

### Lo que la migración desde Pipedrive deja afuera

| Funcionalidad | Destino | Nota |
|---|---|---|
| Los 118 tratos "IG DM" de Pipedrive | No se migran nunca | Los trae la conexión de Instagram, con mejores datos. Ver F38 |
| El historial de tratos cerrados más allá del último | Fuera del proyecto | 15 personas tienen más de un trato, todos cerrados. El modelo aplanado guarda el último; el resto queda en Pipedrive como archivo |
| Reemplazo de Calendly por un agendador propio | Etapa 4, Fase 1 | La integración de la Fase 2 es de solo lectura y no lo adelanta |

### Calendly: se construye en la Fase 2, pero una decisión se toma ahora

**El problema no es de integración, es de secuencia.** La descripción del proyecto dice que el sistema da seguimiento automático *a los leads que no agendan*. Para saber quién no agendó, el sistema tiene que saber quién sí. Y agendar pasa en Calendly, que el brief lista explícitamente como "sin integración al CRM".

El agendador propio es Etapa 4. Las secuencias de seguimiento son Fase 2. Entre esos dos momentos hay meses donde las secuencias correrían sin saber quién agendó, y el modo de falla es concreto: un lead agenda por Calendly y no responde el mensaje. Las secuencias se pausan cuando el contacto **responde**, no cuando agenda. La secuencia sigue y el sistema le manda "¿querés que agendemos?" a alguien que tiene la reunión confirmada para el martes.

**La decisión: se construye una integración de solo lectura con Calendly en la Fase 2.** No reemplaza nada, y el agendador propio sigue siendo Etapa 4 sin cambios. Su alcance son tres cosas: un receptor de avisos para reserva creada y reserva cancelada, la escritura de `booking_status` y `booking_at` en el contacto, y una condición en las secuencias que excluya a los contactos con reunión agendada.

**El 80 por ciento de ese trabajo sobrevive a la Etapa 4.** Las columnas de estado de agenda y la condición de las secuencias son exactamente lo que el agendador propio va a escribir y leer cuando exista. Lo único que se borra el día de la migración es el receptor de avisos.

> #### Lo que no se puede postergar, aunque la integración sea de Fase 2
>
> **El enlace de Calendly que manda el flujo tiene que generarse por contacto, con el identificador del contacto en un parámetro de seguimiento.** El receptor lo lee de vuelta y hace la correspondencia por ahí.
>
> El motivo: Calendly entrega correo, y teléfono si el formulario lo pide. La deduplicación del sistema es por teléfono normalizado o correo. **Un lead que llegó por Instagram no tiene ninguno de los dos** hasta que los da. Una reserva de ese lead no corresponde con ningún contacto: crea uno nuevo, duplicado, y el contacto de Instagram sigue marcado como que no agendó.
>
> Esto define cómo se arma el nodo del flujo en la Fase 2, así que se decide ahora o se rehace después.

### Especificado pero no construido, para el plan B

| Funcionalidad | Motivo |
|---|---|
| Plantillas de WhatsApp aprobadas por Meta | Solo aplican en la API oficial |
| Ventana de 24 y 72 horas para WhatsApp | Solo aplica en la API oficial |
| Alta de cuenta de WhatsApp Business en Meta | Solo si se migra |
| Conexión del canal por la API oficial vía Zernio (F6 del apéndice) | Solo si se migra |

### Deuda que se arrastra del Bloque 1

| Tema | Nota |
|---|---|
| `comment_logs` sin alcance por lead | Se correlaciona con un lead por el usuario del autor. Exige decidir antes si un comentario pertenece a un lead o al espacio de trabajo |
| Medición de rendimiento de la bandeja | Solo tiene sentido con datos reales |
| Políticas de escritura de `broadcast_recipients` | Siguen autorizando por membresía |
| Los verificadores corren contra la base de producción | Tolerable mientras está vacía |

### Deuda que abre el Bloque 2

| Tema | Nota |
|---|---|
| Las conversaciones existen en dos bases | Evolution se despliega con el guardado de historial activado, así que copia cada mensaje a su propio PostgreSQL de Railway, además de Supabase, que es la fuente de verdad. Hoy se justifica por dos motivos: habilita el endpoint de historial, que es la vía limpia para una importación inicial, y mientras F27 no exista es la única red de contención si el receptor falla. **Punto de revisión: cuando F27 esté construido y probado, esa copia deja de ser red de contención y pasa a ser redundancia.** Ahí se decide si se apaga el guardado o si se le define una retención a la base de Evolution. Son conversaciones con clientes creciendo en un lugar donde nadie definió por cuánto tiempo, y eso no puede quedar sin decidir por omisión |

### Una decisión operativa que queda abierta, fuera del sistema

**La automatización que alimenta Pipedrive desde Instagram queda redundante y conviene apagarla.** Hoy hay una automatización por API que crea un trato por cada conversación nueva de Instagram, con el nombre para mostrar. Una vez conectado el canal, el sistema recibe esas mismas conversaciones por su propia vía, con el usuario real y el hilo completo.

Si esa automatización sigue corriendo después de la migración, Pipedrive se sigue llenando de tratos que nadie va a leer, y aparece la duda de cuál de los dos sistemas tiene el dato bueno. Apagarla es parte de dar por terminada la migración, no un detalle posterior.

---

## 14. Decisiones transversales

| Decisión | Definición para este proyecto |
|---|---|
| Historial y auditoría | Todas las entidades principales registran quién, qué y cuándo. El historial nunca se borra |
| Borrado suave | Contactos, notas, conversaciones y respuestas rápidas. Retención de 30 días, después purga por tarea programada |
| Deduplicación de contactos | Por un identificador único y estable, nunca solo por nombre. **Cuáles califican está enumerado abajo, y sumar uno nuevo es una decisión que se escribe acá**, no algo que cada importador o cada canal resuelva por su cuenta. Un contacto sin teléfono resuelto no se deduplica: se marca y se reconcilia después, con confirmación humana |
| Snapshot de precios | No aplica en esta etapa. Se contempla en Etapa 4 |
| Estados y ciclo de vida | Conversación: abierta, archivada. Contacto: activo, no contactar, eliminado. Canal: conectado, caído, sin verificar, agotado. Mensaje: pendiente, enviado, fallido |
| Casos borde | Si el operador cierra la ventana a mitad de una importación, el trabajo sigue en segundo plano. Si le sacan un lead que tenía abierto, ve un mensaje claro y no un error. Si la sesión de WhatsApp se cae, la bandeja lo indica en lugar de parecer vacía |
| Zona horaria e idioma | Español rioplatense en toda la interfaz. La zona horaria del negocio es la de Costa Rica. Los envíos de secuencia respetan la zona horaria del contacto cuando se conoce |
| Motor de automatización | El fork trae un motor de flujos visual que se conserva. Las secuencias de la Fase 2 se apoyan en él |
| Precios variables | No aplica en esta etapa |
| Modelo de asignación | Doble asignación independiente: setter, quien contacta, y vendedor, quien cierra. Asignación manual. La conversación además tiene un agente asignado |
| Contacto entre canales | El identificador principal es el teléfono normalizado, después el correo, después el nombre de usuario de la red. Coincidencia exacta de los dos primeros vincula sola; por nombre de usuario solo sugiere. Al unificar, el historial de los dos contactos se junta y queda registrado |
| Formato de teléfono | **E.164, y esta es la única definición del documento.** Signo más, código de país y número, solo dígitos, sin espacios ni separadores, hasta 15 dígitos en total. Se normaliza en el servidor antes de guardarse, no solo en el formulario: sin esto la deduplicación entre WhatsApp e Instagram falla, y arreglarlo después implica migrar datos sucios. Un número que no se puede normalizar no se guarda con un valor inventado, y el código de país por defecto es configuración (F38). F25, §7.1, F29 y F37 citan esta fila en vez de repetirla (devuelto el 23/09/2026, auditoría #13b, #35b, #103c y #119) |
| Claves de terceros | Supabase Vault. Rotación manual desde la interfaz. Si una clave vence, el sistema avisa y degrada esa integración sin romper el resto |
| Patrón de avisos entrantes | Control de duplicados con registro de eventos, acuse inmediato antes de procesar, procesamiento en segundo plano, y verificación de autenticidad obligatoria. En Zernio es firma criptográfica; en Evolution es un dato firmado que caduca |
| Patrón de envíos masivos y límites | Lotes con separación aleatoria, cola de envío, corte automático ante silencio, y franja horaria. Se construye como configuración en el Bloque 4 y lo usa el motor de la Fase 2 |
| Estado comercial heredado | Un solo par etapa y estado por contacto, en columnas con restricción de valores. Se verificó en los datos: ninguna persona tiene un trato abierto y además uno cerrado. El pipeline comercial completo es Etapa 4 |
| Vigilancia por ausencia | Todo mecanismo que avisa porque algo **dejó** de pasar lleva su propia prueba de vida, visible en la interfaz. **Está desarrollado abajo**, y aplica a cualquier detector que se sume después, no solo a los que ya están escritos |
| Una plantilla de WhatsApp es una entidad, no un texto | **Está desarrollado abajo.** Es la única parte del plan B que no se puede postergar, porque lo que compromete no es una tabla: es la forma del paso de secuencia que se diseña en la Fase 2 |

### Los identificadores que califican para deduplicar

**La lista es esta y es cerrada.** Agregar uno es una decisión que se escribe acá, con su motivo, no un criterio que cada importador o cada canal nuevo resuelva por su cuenta. **"Estable" es un juicio, y ahí es donde se cuelan los errores:** todo identificador le parece estable a quien lo está mirando en el momento.

| Identificador | Dónde vive | Vincula |
|---|---|---|
| Teléfono normalizado a E.164 | `contacts.phone` | Solo con coincidencia exacta |
| Correo | `contacts.email` | Solo con coincidencia exacta |
| Identificador opaco del remitente que entrega el proveedor | `contact_channels.platform_sender_id`, con el valor crudo en `raw_jid` | Es la identidad del contacto en ese canal |
| Identificador único del sistema de origen de una importación | La columna que corresponda, hoy `contacts.pipedrive_person_id` | Solo con coincidencia exacta |

**Lo que NO califica, y el caso concreto está a la vuelta de la esquina.** Para Instagram el identificador estable es el **identificador opaco del remitente**, no el nombre de usuario y mucho menos el nombre para mostrar. El nombre de usuario se cambia cuando uno quiere, y el nombre visible todavía más. Por eso F29 vincula solo *sugiriendo* cuando la única coincidencia es el nombre de usuario, y por eso F26 dice que nunca se deduplica por nombre.

No es una precaución teórica: **es exactamente lo que encontramos en los 118 tratos "IG DM" de Pipedrive.** Traen el nombre visible del lead y nada más, ninguno tiene el usuario, y por eso no sirven para identificar a nadie y no se migran. Un identificador que parecía suficiente cuando alguien armó esa automatización dejó 118 registros que no corresponden con ninguna persona.

### Un mecanismo que avisa por ausencia necesita su propia prueba de vida

**La regla, y se aplica sola.** **Todo trabajo periódico del que dependa algo que se muestre en pantalla escribe su marca de última ejecución y la muestra.** No hace falta decidirlo funcionalidad por funcionalidad: si algo de la interfaz depende de que un trabajo haya corrido, ese trabajo trae su marca, y punto. F32 la hereda, F39 la hereda, y el próximo trabajo periódico que alguien escriba también.

**Por qué se redactó así y no como un criterio a evaluar caso por caso.** Una regla que necesita una decisión en cada caso es una regla que se va a saltear en el cuarto caso. Los tres primeros los discute alguien que se acuerda de por qué existe; el cuarto lo escribe otra persona, con apuro, y la pregunta "¿esto necesita marca de vida?" no se le ocurre porque nada se la hace. Aplicada sola, la pregunta no hay que acordarse de hacerla: la respuesta ya está.

**Lo que la regla obliga a exponer.** Una señal propia de que el mecanismo sí está funcionando, visible en la interfaz. Sin esa señal, el mecanismo no se puede dar por verde: no hay forma de distinguir "no hay nada que avisar" de "nadie está mirando".

**Por qué.** Un detector de silencio que depende de un trabajo periódico **falla igual que lo que vigila**. Si el trabajo muere, deja de abrir alertas, que es exactamente lo que hace cuando todo anda bien. El síntoma de la falla y el síntoma de la salud son el mismo símbolo en la misma pantalla: nada. Todo lo demás del sistema falla hacia afuera —una firma rechazada deja un rechazo, un envío fallido deja un mensaje en estado fallido—, y por eso un detector de ausencia es la única pieza que hay que verificar al revés, preguntando por su propia actividad en vez de por sus hallazgos.

**Esta es una familia distinta de las dos reglas de verificación del CLAUDE.md, y por eso se escribe.** El control positivo dice cómo *probar* una comprobación negativa mientras uno la escribe. Esta dice qué tiene que traer *construido* el mecanismo para que alguien pueda confiar en él seis meses después, cuando ya nadie recuerda que existe.

**Y de ahí sale la consecuencia práctica, que es la parte que se pierde si esto se lee como una recomendación.** Por ser funcionalidad y no verificación, la prueba de vida **tiene que aparecer en los criterios de aceptación y en el modelo de datos de la funcionalidad que la necesita**: una columna donde se escribe la marca, y un criterio que diga que se ve en pantalla. Si en cambio queda escrita como paso de un plan de pruebas, se corre una vez el día que se construye, nadie la vuelve a mirar, y desaparece sin dejar rastro justo en el momento en que empezaría a servir.

### Los tres casos donde aplica

**Uno, F39, por diseño.** La marca de última ejecución del trabajo periódico. Es el caso que originó la regla.

**Dos, el chequeo periódico de sesión de F32, por herencia.** F32 pide explícitamente "aviso por evento y chequeo periódico, los dos", así que hay un sondeo del que depende lo que muestra la pantalla de canales, y todo sondeo puede morirse sin avisar. Una sesión que la pantalla muestra como "conectada" porque así quedó guardada, y que en realidad nadie verificó desde hace dos días, es una pantalla mintiendo con confianza. **No hace falta agregarle nada a la entrada de F32: la regla lo alcanza sola**, que es justamente para lo que está escrita de esta forma.

**Tres, el re-registro del webhook de Zernio, y este está verificado en el código.** `ensureWebhookRegistered` corre dentro de un `try/catch` que solo escribe en la consola, en los dos lugares que lo llaman: `app/api/v1/channels/sync/route.ts:141` y `app/api/v1/channels/test-key/route.ts:74`. Los dos comentarios dicen lo mismo, "best-effort: a failure must not block". Es una decisión razonable —que falle el registro no tiene por qué impedir guardar la clave— con una consecuencia que nadie eligió: **la pantalla informa que el canal se sincronizó bien mientras el webhook puede no haber quedado registrado**. A partir de ahí la bandeja deja de recibir y el síntoma es, otra vez, exactamente el mismo que el de un día tranquilo. El estado real del registro existe y es consultable —`GET /v1/webhooks/settings` lo devuelve— pero no se muestra en ningún lado.

Este tercer caso es el que convierte la regla en transversal en vez de en una nota al pie de F39: no salió de diseñar una funcionalidad nueva, salió de leer código heredado que ya está corriendo en producción.

### Deriva de configuración y silencio de tráfico son dos fallas distintas con el mismo aspecto

**La distinción.** Un vigilante puede preguntar dos cosas que parecen la misma:

- **¿Está llegando tráfico?** Mide actividad. Detecta que algo se cortó del todo.
- **¿La configuración sigue siendo la que pedimos?** Mide estado. Detecta que algo se cambió.

**Por qué no son intercambiables, y por qué la primera sola es una trampa.** Una deriva de configuración casi nunca corta todo: saca una pieza. El tráfico que queda **disimula la falla**, y el vigilante que solo mide actividad ve movimiento y calla. Peor: cuanto más sano está el resto del sistema, más eficaz es el disimulo. Un canal muy activo esconde mejor una suscripción rota que uno muerto.

Dicho de la forma más corta posible: **un vigilante que solo mide tráfico da por sana una configuración rota mientras el tráfico que sí queda la disimula.**

**El caso que la produjo.** La suscripción del webhook de Zernio tiene tres eventos. Si pierde `message.sent`, los mensajes entrantes siguen llegando, el detector de silencio sigue en verde, y lo que desaparece son las respuestas que el negocio escribe desde el celular. Nadie lo ve hasta que alguien nota que una conversación no tiene las respuestas que recuerda haber escrito.

**La consecuencia práctica.** Todo vigilante de un mecanismo que depende de una configuración externa —una suscripción de webhook, una lista de eventos, un conjunto de permisos, una regla de reenvío, una clave con alcance— tiene que **leer esa configuración y compararla contra lo que el código espera**, no solo medir si pasa tráfico. La comparación es casi siempre una llamada y un `every`, y es la diferencia entre un vigilante y un adorno.

Y el corolario que conecta con la regla de arriba: esa comparación es a su vez un trabajo periódico, así que **también le corresponde su marca de última ejecución**. Un verificador de configuración muerto y una configuración correcta se ven igual.

### Un test escrito con el supuesto equivocado del código es un espejo, no una red

**El caso, del 21 de septiembre de 2026.** El receptor de Zernio descartaba los mensajes salientes comparando `direction === "outbound"`. El proveedor no manda nunca ese literal: los suyos son `"incoming"` y `"outgoing"`. La comparación no dio verdadero jamás, así que el guard no filtró nada desde el día que se escribió.

Había un test que cubría exactamente eso, y estaba en verde. Mandaba `direction: "outbound"` — **el mismo literal inventado que comparaba el código**— y comprobaba que el mensaje se descartara. Como el fixture y el código compartían el error, el test confirmaba el bug en vez de atraparlo.

**Es la cuarta aparición del mismo error de literal en el proyecto**, y la primera adentro de la red que tenía que detectarlo. Las tres anteriores están documentadas en `lib/zernio-message-map.ts`.

**Por qué ningún control positivo lo habría encontrado.** El test tenía su contraparte afirmativa y las dos pasaban, porque las dos usaban el fixture equivocado. Un control positivo prueba que el camino de éxito funciona; no prueba que el dato de entrada se parezca al real. Cuando el fixture es ficción, el test entero mide una conversación entre el código y sí mismo.

**La regla que sale de acá:** **los fixtures salen de una respuesta real del proveedor, no de lo que el código espera.** Copiada de un payload observado, con la fecha y el origen anotados al lado. Cuando no hay forma de conseguir una respuesta real, el fixture se marca como inventado, con esas palabras, para que el que venga sepa que esa parte no está verificada.

El corolario incómodo, que conviene aceptar de entrada: **un test verde sobre un fixture inventado vale menos que no tener test**, porque ocupa el lugar donde alguien habría mirado.

### Un instrumento comparado solo contra sí mismo no puede revelar su propio techo

**El caso, del 22 de septiembre de 2026, en la primera ejecución de `docs/purga-y-reconexion-instagram.md`.** El paso 2.1 decide cuándo terminó la reproducción del historial de Instagram con tres lecturas iguales del conteo de `conversations`. Antes de ejecutarlo ya se le había encontrado un defecto: sin una sincronización antes de cada lectura, el conteo no puede subir y las tres lecturas salen iguales por construcción. Se arregló.

**Y con el arreglo aplicado, el conteo se habría estancado igual.** Quedó en 200, porque la importación lee como máximo 4 páginas de 50 (`lib/inbox-sync.ts:15-16`). Las tres lecturas iguales habrían salido, las dos horas habrían pasado, y el procedimiento se habría cerrado **con 300 conversaciones faltando y todo en verde**. Arreglar el instrumento no tocó el problema, porque el problema era el techo del instrumento.

**Lo que reveló la verdad no fue arreglarlo sino contar del otro lado.** Del lado de Zernio había 500. Recién comparando las dos cifras apareció que la nuestra no estaba midiendo la reproducción: estaba midiendo su propio tope.

**La regla:** **un instrumento comparado solo contra sí mismo no puede revelar su propio techo, y por eso una medición que importa necesita una segunda fuente, y no solo un control positivo.**

**Por qué es una familia distinta de las dos reglas de verificación del `CLAUDE.md`.** El control positivo prueba que el instrumento *responde*: que la cañería entrega, que el camino de éxito funciona. Acá respondía perfecto. Las primeras 200 entraron bien, y cualquier control positivo que se le hubiera puesto habría dado verde. Lo que un control positivo no puede decir es **hasta dónde** mide el instrumento, porque para saber dónde está el techo hace falta ver algo que esté por encima, y el instrumento por definición no lo ve. Una segunda fuente independiente sí.

**Qué implica en concreto:**

- **Toda condición de "terminó" o "está completo" se contrasta contra una fuente que no dependa del mismo código.** Si la única cifra disponible sale del instrumento que se está evaluando, el resultado es **no concluyente**, dicho con esas palabras.
- **Un número redondo es una pista, no una prueba.** El 200 exacto fue lo que hizo sospechar. Pero un techo puede caer en cualquier número, y la sospecha no reemplaza a la segunda fuente.
- **Cuando la segunda fuente también tiene techo, se dice.** El 500 de Zernio es a su vez el máximo que el proveedor documenta. Que las dos cifras coincidieran con dos topes distintos no prueba que la reproducción esté completa: prueba dónde está cada techo.

---

### Una plantilla de WhatsApp es una entidad, no un texto

**La regla.** Un paso de secuencia **referencia una plantilla por identificador**. Nunca guarda el cuerpo del mensaje como texto libre. Vale desde el momento en que se diseñe el paso de secuencia, en la Fase 2, aunque en esta fase no exista ninguna plantilla y con Evolution no haga falta ninguna.

**Por qué no se puede postergar, aunque todo lo demás del plan B sí.** Con Evolution se escribe texto libre, así que guardar el cuerpo en el paso de secuencia es lo natural y lo correcto. El problema aparece el día de la migración: si el paso contiene un texto, migrar no es agregar la tabla `whatsapp_templates` y llenarla, es **reescribir el motor de secuencias** para que el paso apunte a una entidad en vez de contenerla. Eso convierte una migración de configuración en una migración de arquitectura, con el canal de WhatsApp caído mientras pasa.

Dicho al revés: el resto del modelo del plan B se puede construir el día que se necesite. Esta parte no, porque no es una funcionalidad que falte sino una decisión de forma que ya se habrá tomado.

**Qué implica en concreto para la Fase 2.** El paso de secuencia guarda una referencia y un conjunto de variables para interpolar. En Evolution la referencia apunta a un texto propio del sistema; en el plan B apunta a una plantilla aprobada por Meta. El motor no cambia: cambia a qué apunta la referencia.

**Y la nomenclatura es obligatoria, porque son dos cosas distintas que se llamarían igual.** "Respuestas rápidas" son los textos internos reutilizables que el operador inserta con "/" dentro de la ventana, en `response_templates`. "Plantillas de WhatsApp" son los mensajes aprobados por Meta para escribir fuera de la ventana, en `whatsapp_templates`. Nunca usar "plantilla" a secas en la interfaz.

---

## 14b. Seguridad

| Área | Definición para este proyecto |
|---|---|
| Autenticación | Supabase Auth con correo y contraseña, cookies seguras del lado del servidor. El registro público debe estar desactivado: los usuarios entran por invitación |
| Seguridad por filas | Activada en **todas las tablas de hoy**: las 24 del fork, `webhook_alerts` de la 00022 e `integration_configs` de la 00024. Ver el conteo vigente en 14c. Un Member solo accede a los contactos y conversaciones donde figura asignado, y eso lo decide la base de datos. Verificado con `scripts/verify-lead-scope.mjs`, 24 comprobaciones contra la API (última corrida: 22/09/2026) |
| Validación de datos | En el servidor siempre, no solo en el formulario. Teléfonos normalizados en servidor. Tipo real de archivo validado en servidor |
| Protección de rutas de API | Sesión verificada en todas las rutas. Control de rol en el servidor para las pantallas y rutas de configuración |
| Datos sensibles | Todas las claves de terceros en Vault. Ninguna clave viaja al navegador. Los logs nunca incluyen el contenido completo de un aviso entrante, porque incluye credenciales |
| Protección contra ataques comunes | Las direcciones de redirección se validan comparando el origen, no con una lista de prohibiciones. Un test estático impide que una columna con nombre de secreto llegue al navegador |
| Comunicaciones | HTTPS en producción. Avisos entrantes verificados antes de procesar, en los dos proveedores |

### Checklist para la IA constructora

- [ ] Seguridad por filas activada en todas las tablas de Supabase
- [ ] Políticas escritas y probadas para cada tabla nueva
- [ ] Sesión verificada en todas las rutas de API
- [ ] Control de rol en el servidor, no solo escondiendo botones
- [ ] Validación de datos en el servidor, no solo en el cliente
- [ ] Secretos en Vault, no en variables de entorno de la aplicación
- [ ] Los logs no incluyen credenciales ni cuerpos completos de avisos entrantes
- [ ] Verificación de autenticidad en los dos receptores de avisos
- [ ] Alerta configurada ante rechazos del receptor de Evolution
- [ ] Bucket de archivos privado, con direcciones firmadas de vida corta
- [ ] `npm run verify:security` en verde antes de cerrar cada bloque
- [ ] JWT verificado en todas las Server Actions, además de las rutas de API (devuelto el 23/09/2026, auditoría #116b)
- [ ] Rate limiting en webhooks (devuelto el 23/09/2026, auditoría #117)
- [ ] CORS con dominio específico (devuelto el 23/09/2026, auditoría #120)
- [ ] Headers de seguridad en `next.config.ts`. El criterio original decía `next.config.js`, pero el archivo del proyecto es `.ts` (devuelto el 23/09/2026, auditoría #121)
- [ ] Service Role Key solo en servidor (devuelto el 23/09/2026, auditoría #123)
- [ ] HTTPS en producción (devuelto el 23/09/2026, auditoría #124)
- [ ] `.env` en `.gitignore` (devuelto el 23/09/2026, auditoría #126)

---

## 14c. Base técnica heredada

| Aspecto | Detalle |
|---|---|
| Proyecto base | [ZernFlow](https://github.com/zernio-dev/zernflow), licencia MIT |
| Framework | Next.js 16.1.6, React 19.2.4, Tailwind CSS 4.1.18. Atención: Tailwind es v4, no v3 |
| Tablas existentes | **Conteo vigente, y es el único lugar donde vive: 26 tablas y 24 migraciones aplicadas.** El fork trae 24 tablas en 16 migraciones; las propias van de la 00017 a la 00024, ocho en total, y agregan dos tablas, `webhook_alerts` e `integration_configs`. La 00024 se aplicó a producción el 23 de septiembre de 2026, con `supabase db push` y la aprobación de Marcos; el `--dry-run` previo listaba solo esa. Si este número aparece en otro lado del documento sin la palabra "fork" al lado, está mal |
| Ya implementado, no reconstruir | Autenticación, motor de flujos visual, bandeja básica, CRM con etiquetas y campos personalizados, secuencias con pausa automática, gestión de equipo, difusiones, control de duplicados de avisos, versionado de flujos, actualización en vivo, cliente de Zernio con sus adaptadores |
| Patrones a respetar | Componentes de servidor más hooks, sin almacén global. Avisos en rutas de API, mutaciones en acciones de servidor. Clave de servicio solo en servidor. Estilos con clases de Tailwind, sin módulos de CSS |
| Dependencias críticas | `@zernio/node` fijado en versión exacta, sin prefijo, porque es una librería en versión 0.x y puede romper entre versiones menores |
| Lo que el README dice mal | El README habla de 23 tablas y de 17 o 18 tipos de nodo. En el código del fork son **24 tablas** (*contra `supabase/migrations/00001` a `00016`, 22/09/2026*) y **18 tipos de nodo** (*contra el tipo `NodeType` de `lib/types/database.ts`, 22/09/2026*). **Corregido el 22/09/2026: acá decía 16 tipos, y era el README el que tenía razón.** El dato falso venía del `CLAUDE.md` y se había copiado a este plano sin volver a mirarlo |

---

## 14d. Proyecto como template clonable

El proyecto va a servir de base para clonar y personalizar, así que estas reglas aplican.

### Migraciones

- Numeradas secuencialmente. Las del fork van de la 00001 a la 00016; las propias desde la 00017.
- Las del fork no son idempotentes y se aplican una sola vez sobre una base limpia, con el CLI de Supabase, que lleva su propio registro de qué aplicó.
- Las propias, de la 00017 en adelante, sí son idempotentes: se pueden correr dos veces sin romper nada.
- El archivo consolidado `ALL_MIGRATIONS.sql` se mantiene sincronizado, y hay un test que falla si alguien agrega una migración y se olvida de sumarla.

### Variables de entorno

`.env.example` con todas las variables agrupadas por servicio, cada una con su comentario de qué es y dónde se consigue. Ninguna clave de terceros va ahí: las de Zernio, Evolution, Resend e IA se cargan desde la interfaz y se guardan en Vault.

### README de setup

1. Forkear el repositorio
2. Crear proyecto en Supabase
3. Aplicar las migraciones con el CLI
4. Copiar `.env.example` a `.env` y completar
5. Instalar dependencias y correr en desarrollo
6. Desplegar en Railway, incluyendo el servicio de Evolution

Con su sección de problemas frecuentes.

### Separación de datos

El sistema funciona con la base vacía. Los datos de ejemplo, si se agregan, van en archivos separados de las migraciones de estructura.

### Personalización

| Qué se personaliza | Desde dónde | Requiere código |
|---|---|---|
| Nombre y datos del negocio | Interfaz | No |
| Canales conectados | Interfaz | No |
| Reglas de seguridad de secuencia | Interfaz | No |
| Respuestas rápidas y frases de baja | Interfaz | No |
| Flujos y automatizaciones | Interfaz | No |
| Agregar funcionalidades nuevas | Código | Sí |
| Cambiar o agregar integraciones | Código | Sí |

---

## 15. Notas y pendientes

### Pendientes que solo se resuelven midiendo

No se deciden leyendo documentación. Se instrumentan y se miran.

| Pendiente | Cómo se resuelve | Cuándo |
|---|---|---|
| Con qué frecuencia llega un mensaje sin teléfono resuelto | Contador en el sistema, primera semana con el número conectado | Después del Bloque 3 |
| Qué tan completo viene el historial al vincular el número | Comparar con lo que se ve en el teléfono | Al conectar |
| Cómo se comporta la reconexión en caídas largas | Registro del chequeo periódico | Primeras semanas |
| Si el mecanismo de autenticación del aviso sigue existiendo en versiones nuevas de Evolution | Volver a verificar contra el código en cada actualización | En cada actualización |
| Consumo real de Railway con los servicios nuevos | Mirar el medidor la primera semana | Después del Bloque 2 |

### Preguntas que ya se cerraron con el análisis de los datos

- **El usuario de Instagram no está en Pipedrive, confirmado con el negocio.** Los contactos los importó una automatización por API que trajo únicamente el nombre para mostrar. No está en una nota ni en un campo sin exportar: no está. Eso cierra la pregunta y confirma la decisión de no migrar los 118 tratos "IG DM".
- **Los 52 tratos abiertos sin persona son leads de Instagram.** No hay que "arreglarlos" en Pipedrive vinculándolos a una persona: no existe la persona porque no hay teléfono, correo ni usuario. Crear fichas con un nombre para mostrar sería fabricar registros que tampoco corresponderían con nada.
- **El código de país por defecto queda como configuración**, con Costa Rica como valor inicial. Ver los criterios de F38.

### Lo que se necesita antes de construir

- **Deuda, sin resolver (anotada el 23/09/2026): el registro del webhook de Zernio puede apuntar a localhost.** `test-key`, `connect` y `sync` registran contra `NEXT_PUBLIC_APP_URL`, y sin ella caen en `http://localhost:3000`. Un servidor de desarrollo conectado a la base y a la cuenta de producción puede entonces redirigir el webhook de Zernio a una dirección que no recibe nada, y la bandeja deja de recibir sin ningún síntoma. **Propuesta a evaluar:** que el registro se niegue con una dirección que no sea `https` o que sea `localhost`. Mientras tanto, en desarrollo no se aprietan los botones que llaman a esas rutas.
- **Resuelto el 23/09/2026: "las notificaciones del sistema" de F23.** Estaban sin definir, con tres candidatos: las invitaciones al equipo, los avisos de `webhook_alerts` y la alerta de silencio de F39. Ahora las invitaciones son un criterio aparte, y las notificaciones son una función única de F23 que recibe los destinatarios de forma explícita: las alertas del sistema van a Owner y Admin, y los avisos de una acción a quien la hizo. Tiene techo contra el aluvión y lista cerrada. La alerta de F39 y el fin de importación de F37 la citan. El detalle está en F23.
- **Resuelto el 23/09/2026: el mecanismo del tiempo real del estado de las integraciones, para F24.** Se detecta al abrir la pantalla y cuando una operación real falla, se guarda en `integration_configs` y llega por Realtime. No hay tarea periódica: detectar una caída cuando nadie mira es de F39. La definición, los controles y el costo aceptado están en F24. Este hueco se había anotado acá cuando el criterio volvió sin mecanismo (auditoría #32).
- **La pantalla de importación no está especificada, ni para F37 ni para F38.** La sección 11 no la tiene: el Bloque 4 documenta bandeja, canales y configuración del canal de WhatsApp, y ninguna pantalla de importación. El hueco es anterior a F38, pero F38 lo vuelve urgente, porque pide que esa pantalla permita cambiar el código de país por defecto para una importación puntual. **Hay que especificarla antes de construir el Bloque 4**, o esa decisión se va a tomar mientras se escribe el código, que es exactamente donde termina siendo una constante cableada.
- **Otro hueco de la pantalla de importación, sin resolver (anotado el 23/09/2026).** Un Member puede importar (§3), pero un Member que importa contactos sin asignarse no los ve después: los contactos sin asignar los ven solo Owner y Admin, que es el valor por defecto de la configuración del espacio de trabajo en F3. Se decide al especificar la pantalla.
- El número dedicado de WhatsApp, todavía en trámite. No bloquea el Bloque 2 ni el 3, pero sí la conexión en vivo.
- Verificación del negocio en Meta: **no hecha**. No bloquea nada del camino principal; sirve para el plan B, donde levanta el tope de 250 contactos únicos cada 24 horas. Se comprueba en Business Manager.

### Cambios que convendría reflejar en documentos anteriores

El documento de **alcance** todavía tiene la Decisión 29 escrita a favor de la API oficial de WhatsApp, y el **anexo de integración de WhatsApp** sigue redactado como si fuera el camino principal en lugar del manual del plan B. Ninguno bloquea la construcción, pero los dos se leen distinto ahora, y si en algún momento se arma la propuesta comercial con `06-propuesta`, esos sí llegan al cliente.

Mi recomendación es actualizarlos recién cuando se arme la propuesta: mientras el destinatario sea el equipo que construye, no cambian ninguna decisión, y el esfuerzo rinde más cuando el destinatario es alguien de afuera del proyecto.

El análisis de los exports de Pipedrive agregó dos más, y el segundo pesa:

- **La tabla de herramientas del brief** debería listar Pipedrive como CRM actual y Calendly como agendador, que son las dos herramientas reales del negocio.
- **El brief y el alcance describen una agencia de diez a quince personas**, con 330.000 leads en otra plataforma, equipo de setters y closers, director comercial y un tablero para el CEO. El negocio real es bastante más chico: **un solo embudo, una sola persona en el CRM, 526 contactos**. El modelo de roles ya está construido y no cuesta nada dejarlo, pero la propuesta comercial no puede seguir hablando de ese tamaño de negocio. Se corrige al correr `06-propuesta`.


---

## 16. Correspondencia de números jubilados

Este documento usa F1 a F4 para el Bloque 1 y F21 a F41 para los bloques 2 a 4. El documento anterior usaba F1 a F20 para toda la fase. La tabla dice dónde fue cada una, para que una referencia vieja se pueda resolver sin adivinar.

**La lista es cerrada.** Si aparece una F del documento viejo que no está acá, es un hueco de la conciliación y hay que tratarlo como tal, no como una funcionalidad olvidada a propósito.

| Número viejo | Qué era | Dónde está ahora |
|---|---|---|
| F1 | Fork y deploy de ZernFlow | F1, sin cambios. Bloque 1, construido |
| F2 | Supabase Vault y migración de claves | F2, sin cambios. Bloque 1, construido |
| F3 | Roles, workspaces y scope de leads | F3, sin cambios. Bloque 1, construido |
| F4 | Instagram vía Zernio | F4, sin cambios. Bloque 1, construido |
| F5 | TikTok | Eliminado de la Fase 1. Etapa 2 |
| F6 | WhatsApp por API oficial vía Zernio | Reemplazado por F21 y F22, sobre Evolution. El modelo oficial pasa al apéndice del plan B |
| F6b | Plantillas de WhatsApp | Apéndice del plan B, sin construir |
| F6c | Ventana de conversación | Partida en dos: **F40** para Instagram, que es alcance actual, y el apéndice del plan B para WhatsApp |
| F7 | Email saliente vía Resend | F23 |
| F8 | Configuración de integraciones y BYOK IA | F24 |
| F9 | Modelo de contacto extendido | F25 |
| F10 | Datos de atribución | Absorbida en F25, con sus criterios |
| F11 | Asignación setter y vendedor | **F41**, Bloque 3. Corregido el 23 de septiembre de 2026: esta fila decía "Construida en el Bloque 1 como parte de F3. Las columnas ya existen", y lo construido son las columnas (00017) y el scope, no la asignación desde la interfaz. Ver `docs/auditoria-conciliacion.md`, #45 a #50 |
| F12 | Detección cross-canal | F29, con F26 agregando la identidad de canal |
| F13 | Notas en el contacto | F30 |
| F14 | Ficha de contacto completa | F30 |
| F15 | Soft delete | F30 |
| F16 | Filtros de inbox | F35 |
| F17 | Templates de respuesta rápida | F36. Nombre en la interfaz: "respuestas rápidas" |
| F18 | Marca "no contactar" | F34 |
| F19 | Importación CSV | F37 |
| F20 | Audit log global | F31 |

**Funcionalidades que no existían en el documento viejo:** F26 identidad de canal, F27 guardado de mensajes entrantes, F28 adjuntos, F32 estado de sesión, F33 reglas de seguridad de secuencia, F38 migración desde Pipedrive, F39 detección de silencio del canal, F40 ventana de Instagram.
