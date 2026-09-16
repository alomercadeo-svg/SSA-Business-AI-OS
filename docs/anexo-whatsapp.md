# Anexo — Integración de WhatsApp

**Proyecto:** Sistema Operativo para Negocios de Servicios Digitales
**Documento complementario del Alcance (v5)**
**Fecha:** 15 de septiembre de 2026

---

## Para qué sirve este documento

WhatsApp es el canal que resuelve el problema más caro del proyecto: los leads que no agendan y se enfrían. Es también el canal con más trámites, más reglas de plataforma y más formas de descubrir tarde que algo no se podía hacer.

Este anexo separa lo que hay que **tramitar** (tiene plazo y no depende del desarrollo), lo que hay que **construir** (se puede hacer desde hoy, sin el número), y lo que hay que **ejecutar el día que llegue el número**.

---

## 1. Lo primero, porque es lo que se arruina fácil

> [Cierta] **Cuando llegue el número nuevo, no instales WhatsApp ni WhatsApp Business en él.**

Un número **libre** se registra directo en la Cloud API sin complicaciones. Un número que **ya tiene cuenta de WhatsApp** hay que darlo de baja primero desde la app, y recién después registrarlo. Es tiempo perdido y un paso extra que se puede evitar sin hacer nada.

**Lo único que el número tiene que poder hacer** es recibir un SMS o una llamada de voz, una vez, para la verificación.

Tres cosas más sobre el número, para decidir bien al comprarlo:

| Punto | Qué conviene |
| --- | --- |
| Tipo de línea | Una eSIM o SIM normal sirve. Evitar números virtuales de servicios de SMS descartables: Meta los rechaza con frecuencia |
| País del número | El mismo país donde opera el negocio. El país del número aparece en el perfil y afecta la percepción del cliente |
| Permanencia | Que sea un número que el negocio pueda conservar años. Cambiar el número de WhatsApp después significa perder las conversaciones y empezar de cero con los límites |

---

## 2. Trámites: qué hay que hacer, en qué orden, y cuánto tarda

Los trámites son secuenciales: cada uno habilita al siguiente. Arrancar lo antes posible con los que no dependen del número.

| # | Trámite | Depende de | Plazo | Se puede arrancar ahora |
| --- | --- | --- | --- | --- |
| 1 | Cuenta de Meta Business Manager del negocio | Nada | Horas | **Sí** |
| 2 | Verificación de negocio con Meta (documentos legales, identificación fiscal) | Paso 1 | 3 a 5 días | **Sí.** A confirmar si Zernio lo absorbe |
| 3 | Cuenta en Zernio y alta del perfil | Nada | Minutos | **Sí** |
| 4 | Conseguir el número dedicado | Nada | En trámite | En curso |
| 5 | Alta del número en la cuenta de WhatsApp Business (WABA) y verificación de propiedad | Pasos 1 y 4 | Minutos | No |
| 6 | Registro del número en Cloud API, con PIN de verificación en dos pasos de 6 dígitos | Paso 5 | Minutos | No |
| 7 | Aprobación del **nombre para mostrar** (display name) por Meta | Paso 5 | Horas a días | No |
| 8 | Envío y aprobación de las **plantillas de seguimiento** | Paso 7 | **24 a 48 horas por plantilla** | Los textos sí: se pueden escribir ya |

**El que más sorprende es el 8.** Cada plantilla se revisa por separado, y una rechazada hay que corregirla y volver a enviarla, con otro ciclo de 24 a 48 horas. Por eso los textos de las plantillas conviene escribirlos ahora, mientras se espera el número.

**Guardá el PIN de dos pasos en un lugar seguro.** Se pide para operaciones futuras sobre el número y recuperarlo es un trámite.

---

## 3. Límites de mensajería: qué significan y si afectan a este negocio

[Cierta] El límite de mensajería es **la cantidad de números únicos de WhatsApp a los que el negocio puede escribir fuera de la ventana de atención, en una ventana móvil de 24 horas.**

Dos precisiones que suelen confundirse:

- **No limita las respuestas.** Contestarle a alguien que escribió primero es gratis e ilimitado, siempre que esté dentro de la ventana de 24 horas.
- **Cuenta contactos únicos, no mensajes.** Escribirle tres veces a la misma persona cuenta como uno.

| Nivel | Contactos únicos por día | Cómo se llega |
| --- | --- | --- |
| Inicial | **250** | Al crear la cuenta |
| Siguiente | **2.000** | Completando los pasos de escalado de Meta |
| Superiores | Automático | Meta sube el límite solo si se cumplen sus criterios y las plantillas mantienen buena calidad |

**¿Alcanza para este negocio?** Sí, con margen. El brief estima unos 700 leads al mes que no agendan y necesitan seguimiento. Repartidos en el mes son unos **23 contactos por día**, contra un límite inicial de 250. El límite no es un problema ni siquiera al arrancar.

**Lo que sí hay que cuidar es la calidad.** Si mucha gente bloquea o reporta el número, Meta baja la calificación y con ella el límite. Las plantillas mal escritas o demasiado promocionales son la causa habitual. Conviene arrancar conservador.

---

## 4. La ventana de 24 horas, que es la regla que gobierna todo el módulo

Cuando un lead escribe, se abre una **ventana de 24 horas**. Dentro de esa ventana:

- Se responde lo que sea: texto libre, imágenes, archivos, audio, botones
- **No cuesta nada**
- Cada mensaje nuevo del lead reinicia la ventana

Fuera de la ventana:

- **Solo se pueden enviar plantillas pre-aprobadas por Meta**
- Cada plantilla enviada tiene costo según su categoría
- Cuando el lead responde a la plantilla, se abre una ventana nueva de 24 horas y se vuelve a conversar gratis

| Categoría de plantilla | Costo aproximado en LATAM | Para qué se usa |
| --- | --- | --- |
| **Marketing** | ~$0.010 a $0.015 | Reactivación, promociones, seguimiento comercial |
| **Utility** | ~$0.003 a $0.005 | Confirmaciones, recordatorios de cita, actualizaciones de estado |
| **Authentication** | ~$0.003 a $0.005 | Códigos de verificación |
| **Service** (dentro de ventana) | **Gratis** | Cualquier respuesta dentro de las 24 horas |

**Dato que baja el costo:** si el lead llega por un anuncio de click-to-WhatsApp, la ventana gratis es de **72 horas**, no 24.

**Consecuencia de diseño:** conviene clasificar bien cada plantilla. Un recordatorio de cita agendada es **utility** y cuesta un tercio que uno de **marketing**. Clasificar todo como marketing por comodidad triplica la factura sin motivo.

---

## 5. Lo que hay que construir, y se puede hacer sin el número

### 5.1 Modelo de datos: plantillas como entidad

Esto es lo más importante del anexo desde el punto de vista técnico. **Una plantilla no es un texto: es un recurso con ciclo de vida propio.**

| Campo | Para qué |
| --- | --- |
| Nombre interno | Cómo la llama el equipo |
| Nombre en Meta | El identificador con el que se envía |
| Categoría | marketing, utility o authentication. Define el costo |
| Idioma | Meta las aprueba por idioma |
| Cuerpo con variables | El texto, con marcadores tipo `{{nombre}}` |
| Estado | borrador, enviada, aprobada, rechazada, pausada por calidad |
| Motivo de rechazo | Lo que devuelve Meta cuando no aprueba |
| Versión | Editar una plantilla aprobada exige volver a aprobarla |
| Calificación de calidad | Meta la califica según cómo reacciona la gente |

**Y el paso de secuencia referencia una plantilla, no guarda el texto.** Si el paso guarda el texto como string libre, el día que haya que usar plantillas hay que rehacer el módulo de secuencias entero.

### 5.2 Ventanas como configuración del canal

Cada canal guarda su propia regla, como dato y no cableada en condicionales:

| Canal | Ventana | Cómo se reabre |
| --- | --- | --- |
| Instagram | 24 horas desde el último mensaje del lead | No se reabre. Salvo respuesta privada a un comentario, hasta 7 días, una vez |
| WhatsApp | 24 horas, o 72 si vino de un anuncio click-to-WhatsApp | Con una plantilla aprobada, que cuesta |

Esto es lo que después alimenta las guardas del flow builder y la validación de secuencias.

### 5.3 Validación de secuencias al dar de alta, no al enviar

**Regla obligatoria.** Cuando alguien arma una secuencia, el sistema calcula si cada paso va a caer dentro o fuera de la ventana del canal, y lo muestra en el momento:

- Paso dentro de la ventana: verde, texto libre, gratis
- Paso fuera de la ventana en WhatsApp: amarillo, exige elegir una plantilla aprobada, muestra el costo estimado
- Paso fuera de la ventana en Instagram: **rojo, no se puede publicar**

Sin esto, alguien arma la secuencia de 24 horas, 3 días y una semana que describe el brief, la publica, y descubre semanas después que la mitad de los mensajes nunca salieron.

### 5.4 Adaptador de canal

La plataforma `whatsapp` ya está habilitada en la tabla `channels` del fork desde la migración 00016, y el cliente de Zernio ya está escrito y con tests. El adaptador se construye y se prueba contra Instagram; el día que llegue el número solo se ejecuta el alta.

---

## 6. Las plantillas que hay que escribir ahora

Mientras se espera el número, escribir estos textos y enviarlos a aprobación apenas se pueda. Son los mínimos para que las secuencias del brief funcionen.

| # | Propósito | Categoría | Cuándo se dispara |
| --- | --- | --- | --- |
| 1 | Primer seguimiento al lead que no agendó | Marketing | 24 horas después de la conversación |
| 2 | Segundo seguimiento, ángulo distinto | Marketing | 3 días después |
| 3 | Último intento, con cierre o despedida | Marketing | 7 días después |
| 4 | Confirmación de cita agendada | **Utility** | Al agendar |
| 5 | Recordatorio de cita | **Utility** | 24 horas antes |
| 6 | Reactivación de lead frío | Marketing | Manual o por campaña |

**Tres reglas para que Meta las apruebe a la primera:**

1. **Sin promesas exageradas ni lenguaje de venta agresivo.** Es la causa más común de rechazo.
2. **Con una salida clara.** Que la persona pueda decir que no quiere más mensajes.
3. **Las variables tienen que tener sentido sin contexto.** Meta revisa la plantilla con valores de ejemplo: si queda una frase rara, la rechaza.

**Empezar con las de utility (4 y 5).** Son más fáciles de aprobar, cuestan menos, y sirven para verificar que todo el circuito funciona antes de jugarse con las de marketing.

---

## 7. Checklist del día que llegue el número

1. **No instalar WhatsApp en el número.** Si ya se instaló, dar de baja la cuenta desde la app primero
2. Verificar que el número puede recibir SMS o llamada
3. Agregar el número a la cuenta de WhatsApp Business en Meta Business Manager
4. Verificar la propiedad del número con el código que llega por SMS o llamada
5. Definir el **PIN de verificación en dos pasos** de 6 dígitos y guardarlo en un lugar seguro
6. Registrar el número en Cloud API a través de Zernio
7. Configurar el **nombre para mostrar** y esperar la aprobación de Meta
8. Configurar el perfil del negocio: foto, descripción, horario, sitio web
9. Enviar las plantillas de utility a aprobación (24 a 48 horas)
10. Conectar el canal en el sistema y verificar que el webhook entrega mensajes
11. **Prueba de punta a punta:** escribir desde un teléfono propio, verificar que el mensaje aparece en la bandeja, que crea el contacto, que el bot responde y que la respuesta llega
12. Enviar las plantillas de marketing a aprobación
13. Recién entonces, activar las secuencias de seguimiento

**Los pasos 1 a 8 son de una tarde.** El tiempo real lo ponen las aprobaciones de Meta: el nombre para mostrar y las plantillas.

---

## 8. Casos raros que hay que resolver en el diseño

| Caso | Qué hacer |
| --- | --- |
| El paso de secuencia cae fuera de la ventana y la plantilla todavía no está aprobada | El paso queda en espera, no se descarta. Alerta al admin. Cuando la plantilla se aprueba, se reanuda |
| Meta rechaza una plantilla que ya está en uso en una secuencia activa | Pausar la secuencia, avisar al admin con el motivo del rechazo, y no dejar que se publique hasta reemplazarla |
| El lead responde a una plantilla | Se abre ventana nueva de 24 horas: el bot puede conversar libre y gratis. **La secuencia se pausa automáticamente**, como en todos los canales |
| El mismo lead escribe por Instagram y por WhatsApp | Se unifica en un solo contacto por teléfono normalizado o email, pero **cada conversación mantiene su hilo y su ventana por separado**. La detección de colisión de secuencias se evalúa por canal |
| El lead pide no recibir más mensajes | Se marca "no contactar", se pausan todas sus secuencias en todos los canales, y **nunca más se le envía una plantilla**. Esto no es opcional: es lo que protege la calificación de calidad del número |
| La calificación de calidad del número baja | Alerta al admin. Pausar las secuencias de marketing hasta entender la causa. No seguir enviando |
| Se agota el límite de contactos únicos del día | Los envíos se encolan para el día siguiente en vez de fallar |

---

## 9. Lo que queda por confirmar

| # | Qué falta | Con quién | Impacto |
| --- | --- | --- | --- |
| 1 | ¿Zernio absorbe la verificación de negocio con Meta? | Zernio, por escrito | Si no, son de 3 a 5 días de trámite antes de poder enviar plantillas |
| 2 | ¿Zernio expone la gestión de plantillas por API (alta, estado, calificación) o hay que hacerlo desde Meta Business Manager a mano? | Zernio | Define si el módulo de plantillas del sistema es completo o es solo un espejo de lectura |
| 3 | ¿Los webhooks de WhatsApp de Zernio son en tiempo real? | Zernio | Su documentación dice que Meta, Telegram y Slack son en tiempo real. WhatsApp es de Meta, así que debería serlo, pero conviene confirmarlo |
| 4 | País y tipo de línea del número dedicado | Marcos | Afecta las tarifas de plantillas y la percepción del cliente |

---

**Siguiente paso:** con el alcance cerrado y este anexo como guía de la integración, corresponde el documento de requerimientos de la Fase 1 de la Etapa 1. Usá `05-requerimientos` para avanzar.
