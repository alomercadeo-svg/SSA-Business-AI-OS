# Auditoría de la conciliación de `584226f`

**Qué se audita.** El commit `584226f` (21/09/2026 21:37, "docs: un solo plano, con F1 a F39
conciliadas en requerimientos-fase1.md") juntó los dos planos en uno. El 22/09/2026 se encontró que en
esa conciliación la pantalla de integraciones había perdido un criterio completo, "El estado de cada
integración se actualiza en tiempo real", y varios detalles. Esta auditoría busca si pasó lo mismo en
las demás funcionalidades.

**Fuentes, y la condición para no confundir un criterio perdido con uno que nunca existió.** Todo
criterio de esta lista sale de uno de estos dos documentos, en el commit **`ebc9702`** (21/09 18:28), el
padre inmediato de `584226f`:

- `docs/requerimientos-fase1.md` en `ebc9702`: 182 criterios, numeración vieja (F1 a F20).
- `docs/requerimientos-bloques-2-3-4.md` en `ebc9702`: 140 criterios, numeración F21 a F39. Ese
  archivo se borró en `584226f`.

Se comparan contra `docs/requerimientos-fase1.md` actual, con 208 criterios.

**Estado: lista completa y clasificada el 22/09/2026, de forma provisoria, con destino asignado el
23/09/2026. El plano no se corrigió, salvo #62, que se devolvió aparte por ser la restricción dura
del proyecto.** La lista de trabajo son las 128 líneas que da la comparación por texto exacto (sección
de abajo), que pasó su control positivo: contiene las seis pérdidas conocidas de F24. El 23/09 se
verificó que estuviera completa contando duplicados y mudanzas, y apareció una más, el #129. La
primera pasada, por similitud y cortada a las 19:57, quedó como registro del método.

---

## Método

`node scripts/auditar-criterios.mjs <commit> <archivo> [regex de encabezado]`. Toma cada criterio
(`- [ ]` y sus sub-viñetas) y busca en el plano actual el criterio que más palabras con contenido le
comparte. **El umbral se fijó antes de ver resultados: 0,75.** Si ninguno llega, el criterio va a
revisión. El script no decide si algo se perdió: lo decide una persona.

## Control positivo, sobre F8, sin usar lo que ya se sabía

Comando: `node scripts/auditar-criterios.mjs ebc9702 docs/requerimientos-fase1.md "^F8:"`.

**Resultado: el método sirve para encontrar y no sirve todavía para descartar.**

- **Sensibilidad: 6 de 6.** Reencontró todas las pérdidas conocidas, sin que se le indicaran.
- **Discriminación: mala.** Marcó 13 de 14 criterios. Por lo menos 4 están presentes y solo
  cambiaron de palabras ("API key" pasó a "clave", "longitud" a "largo", "API keys" a "claves"). Con
  este umbral, las 38 restantes van a dar una lista larga con mucho ruido.

**Decisión pendiente antes de seguir:** si se agrega una tabla de sinónimos, se tiene que fijar
**antes** de correr las otras 38 y no ajustarse mirando resultados. Si no, la revisión humana absorbe
el ruido. Ninguna de las dos cosas se hizo esta noche.

## La lista de F8, con clasificación provisoria

Origen de todos: `docs/requerimientos-fase1.md` en `ebc9702`, sección "F8: Pantalla de configuración
de integraciones y BYOK IA". Los tres primeros se revisan juntos para calibrar la clasificación antes
de seguir.

| # | Criterio viejo | Puntaje | Clasificación provisoria |
|---|---|---|---|
| 1 | Pantalla accesible **desde el sidebar**, solo para Owner y Admin | 0,57 | **Perdido**, el detalle del sidebar |
| 2 | Instagram (Zernio): API key, estado, **conectar y desconectar** | 0,71 | **Perdido**, el detalle |
| 3 | El estado de cada integración se actualiza **en tiempo real** | 0,40 | **Perdido**, completo |
| 4 | WhatsApp (Zernio, API oficial): API key, número, estado, nombre para mostrar y aprobación | 0,27 | **Descartado con motivo**: la decisión del 16/09 pasa WhatsApp a Evolution. Se reescribe en F24 según lo decidido el 22/09 |
| 5 | Facebook (Zernio, opcional): API key, **nota "$6/mes extra"** | 0,33 | **Perdido**, la nota |
| 6 | X/Twitter (Zernio, opcional): API key, **nota "$6/mes extra"** | 0,33 | **Perdido**, la nota |
| 7 | *(TikTok, YouTube y LinkedIn en Etapa 2; la estructura es extensible)* | 0,14 | **Reescrito**: el sentido está en el criterio "agregar una integración sin cambiar la base" |
| 8 | Sección "Email": Resend con API key, dominio verificado **y estado** | 0,50 | **Perdido**, el "estado" |
| 9 | Proveedores de IA: OpenAI, Anthropic y Google, con API key y modelo | 0,73 | **Presente**. Falso candidato por sinónimo |
| 10 | Todas las API keys en Supabase Vault, nunca en texto plano | 0,44 | **Presente** en F24 ("Todas las claves van a Vault"). Falso candidato |
| 11 | Al guardar una key se valida el formato | 0,60 | **Presente**. Falso candidato |
| 12 | Cada integración es un registro en **`integration_configs`** con su `type` | 0,40 | **Reescrito**: se perdió el nombre de la tabla |
| 13 | Agregar una integración en Etapa 2 no requiere cambios en la tabla | 0,67 | **Presente**. Falso candidato |

El único criterio de F8 que el método dio por presente fue "Pantalla en `/settings/integrations`…",
contenido en el 1.

## Una fuente mejor para la lista, encontrada al construir la foto

La foto de criterios (`scripts/foto-criterios.mjs`, 22/09/2026 después de las 20:00) compara por
**texto exacto**. Corrida con la foto de `ebc9702` contra el plano de `584226f`:

```bash
node scripts/foto-criterios.mjs --foto-de ebc9702 --plano-de 584226f
```

da **128 líneas de criterio que la conciliación sacó o cambió**, con el criterio de tiempo real entre
ellas, y **13 líneas nuevas**. Es la lista exacta de lo que tocó `584226f`, sin umbral y sin ruido de
sinónimos. **Hay que tomar en cuenta un sesgo:** los dos planos viejos se superponían (dos numeraciones
para funcionalidades que se repetían), así que parte de las 128 son duplicados que la conciliación
unificó a propósito. Eso lo decide la revisión. **Propuesta, sin decidir:** usar estas 128 como lista
de trabajo de la auditoría, y dejar el script por similitud solo para sugerir a qué criterio actual
corresponde cada una.

## Alcance: la auditoría está completa cuando se clasifican F1 a F20 del plano de fase 1

Las 128 líneas vienen **todas** de `docs/requerimientos-fase1.md` en `ebc9702`, secciones F6 a F20 y el
checklist. **Ninguna** viene de `docs/requerimientos-bloques-2-3-4.md`: la conciliación conservó ese
texto tal cual. Así que la auditoría no termina cuando se acaba la lista, sino cuando cada obligación
de F1 a F20 quedó clasificada. F1 a F5 no aportan líneas porque sobrevivieron textuales.

## Verificación de que la lista está completa (23/09/2026, `8d69af7`)

La comparación que dio las 128 armaba un conjunto de textos, así que no veía dos cosas: la copia
borrada de un texto que estaba duplicado, y una línea que conserva su texto pero cambia de lugar.
`node scripts/ubicacion-criterios.mjs --foto-de ebc9702 --plano-de 584226f` cuenta apariciones y
compara la ruta completa de encabezados. Resultado:

- **Control de lectura:** el plano de bloques da 143 líneas en `ebc9702` y el de fase 1, 187. Que
  ninguna de las 128 venga del de bloques es un resultado, no un plano que no se leyó.
- **1 duplicado perdido**, que pasa a ser el **#129**: "El estado de la conexión es visible en
  `/settings/integrations`" estaba en F4 y en F6; quedó solo el de F4, que tapaba la pérdida del de F6.
- **15 mudanzas al apéndice del plan B:** las 8 líneas de F6b y 7 de las 8 de F6c pasaron, con el
  mismo texto, del Bloque 1 al apéndice. **Están documentadas en §16**, que manda F6b al apéndice y
  parte F6c entre F40 y el apéndice. La octava línea de F6c quedó en los dos lugares.
- **Verificado contra el plano actual:** cada línea de F6c que aplica a Instagram tiene su versión en
  F40 (campos de ventana, recálculo a 24 horas, indicador en la bandeja, texto libre con la ventana
  abierta, ventana cerrada, error claro y respuesta privada a comentarios). La única que queda solo
  en el apéndice es "cerrada en WhatsApp", que es del plan B.

Desde `aec638a` la guardia del plano (`docs/plano-criterios.test.ts`) compara de la misma forma, así
que de acá en adelante una copia borrada o una mudanza sin explicar ponen la suite en rojo.

## Las cuatro reglas de clasificación, fijadas el 22/09/2026 antes de clasificar las 125 restantes

1. **Se clasifica por lo que el criterio obliga, no por las palabras.** Es "reescrito" solo si el
   criterio actual obliga a lo mismo. Si obliga a menos, la parte que falta está perdida.
2. **Un mecanismo es obligación si ninguna comprobación puede reemplazarlo sin notarlo.** RLS contra
   un filtro en la interfaz, o Vault contra una variable de entorno, se distinguen con una
   comprobación: son obligación. `scheduled_jobs` contra otra cola, o el nombre de una tabla, no se
   distinguen: son implementación, y se pueden descartar con motivo.
3. **Un duplicado unificado se revisa línea por línea.** La unificación es legítima solo si cada
   línea de la versión descartada queda cubierta por la que sobrevivió.
4. **La unidad es la obligación, no la línea.** Una línea con dos obligaciones puede recibir dos
   clasificaciones (#105a, #105b).

## La lista completa, clasificada (provisoria, sin corregir el plano)

Origen de todas: `docs/requerimientos-fase1.md` en `ebc9702`, en la sección indicada. **R** es
reescrito o presente, **P** perdido y **D** descartado con motivo. **R\*** significa que la obligación
sigue viva, pero en prosa (§14, §14b) o en el `CLAUDE.md`, no como criterio. Eso implica que la foto
**no la protege**, y por eso cada R\* recibe un destino igual que una perdida.

### Destinos, fijados el 23/09/2026

Cada obligación perdida y cada R\* tiene uno de tres destinos, en la columna **Destino**:

- **A. Vuelve a la Fase 1 tal cual**, en la funcionalidad o sección que se indica.
- **B. Vuelve reescrita o en otra sección**, y la fila dice cuál.
- **C. Se saca, con el motivo escrito.** No confundir con **D** de la clasificación: D es un
  descarte que ya estaba decidido antes de esta auditoría; C es una perdida que se decide no devolver.

**La regla para ubicar lo que vuelve:** una obligación vuelve como **criterio de una funcionalidad
existente** si describe cómo se comporta esa funcionalidad. Vuelve como **funcionalidad nueva** si
tiene pantalla propia o es una capacidad que el usuario ve por separado.

Aparte, **#12 y #43b pasan de R a B**. No están en la Fase 1 sino en el apéndice del plan B, que es
su destino, así que no hay nada que devolver. Por eso no entran en los totales del resumen.

**F6, WhatsApp por la API oficial (plan B desde el 16/09; el apéndice conservó solo F6b y F6c)**

| # | Obligación | | Dónde está hoy, o por qué se descarta | Destino |
|---|---|---|---|---|
| 1 | El adaptador de WhatsApp usa el mismo contrato de canal, sin condicionales | R | F27, camino de entrada único | |
| 2 | "whatsapp ya está en el CHECK de `channels`, no hace falta migración" | D | Es un hecho del esquema, no una obligación. Con Evolution el canal entró en 00022 | |
| 3 | Registro `whatsapp_zernio` en `integration_configs` | P | El apéndice del plan B no conserva el canal, solo plantillas y ventana. Poco peso | B, apéndice del plan B |
| 4 | El webhook procesa WhatsApp por la misma ruta que Instagram | R | F27 | |
| 5 | Idempotencia igual para los dos canales | R\* | §14, "Patrón de avisos entrantes". F22 no tiene criterio propio | A, F22 |
| 6–9 | Número sin cuenta previa, alta en WABA, PIN, nombre para mostrar aprobado | R | Pasos del alta en `docs/anexo-whatsapp.md` | |
| 10 | Conectar el canal del plan B desde la interfaz | P | Mismo caso que el 3. Poco peso | B, apéndice del plan B |
| 11 | Entrantes por webhook, guardados en `messages` | R | F27 | |
| 12 | Texto libre con la ventana abierta | B | F6c, en el apéndice | B, ya en el apéndice |
| 13a | Vincular el contacto por teléfono normalizado | R | F29 | |
| 13b | …**en E.164** | P | F29 dice "normalizado". Ver la familia E.164 abajo | B, definición E.164 única en §14 |
| 129 | El estado de la conexión de WhatsApp visible en `/settings/integrations` | P | Encontrada por duplicados en `8d69af7`: el mismo texto estaba en F4 y en F6, y la copia de F4 tapaba la pérdida de la de F6 | B, apéndice del plan B |

**F7, correo por Resend (hoy F23)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 14–18 | Clave en Vault desde integraciones, invitaciones y notificaciones, remitente con dominio verificado, reintentos, registro | R | F23 | |
| 19 | "La infraestructura queda lista para que la Fase 2 la use en secuencias" | D | Por la regla 2: no hay comprobación posible en esta fase. **Provisoria** | |

**F8, pantalla de integraciones (hoy F24)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 20a | Accesible **desde el sidebar** | P | | A, F24 |
| 20b | Solo Owner y Admin | R | F24 | |
| 21 | Sección de canales | R | F24 | |
| 22a | Conectar Instagram con la clave de Zernio | R | F4 | |
| 22b | **Desconectar** Instagram | P | | A, F24 |
| 22c | **Estado** de Instagram | P | Va con el 32 | A, F24 |
| 23 | WhatsApp por la API oficial en la pantalla | D | Decisión del 16/09; reescritura decidida el 22/09 | |
| 24a, 25a | Facebook y X opcionales | R | F24; quedan afuera por decisión del 22/09 | |
| 24b, 25b | La nota "$6/mes extra" | P | Poco peso | C: Facebook y X quedan fuera de F24 por la decisión del 22/09, así que no hay dónde poner su nota de precio |
| 26 | Estructura extensible para Etapa 2 | R | F24, "agregar una sin cambiar la base" | |
| 27a | Resend con clave y dominio verificado | R | F24 | |
| 27b | **Estado** del correo | P | | A, F24 |
| 28–30 | IA con tres proveedores, claves en Vault, validación de formato | R | F24 | |
| 31a | Cada integración es un registro con tipo | R | F24 | |
| 31b | Que la tabla se llame `integration_configs` | D | Regla 2: el nombre no lo distingue ninguna comprobación | |
| 32 | **El estado de cada integración se actualiza en tiempo real** | P | | A, F24 |
| 33 | Agregar una integración sin cambiar la tabla | R | F24 | |

**F9 y F10, modelo de contacto y atribución (hoy F25)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 34a | Columnas de contacto que siguen | R | F25 | |
| 34b | Columnas de redes: `instagram_username`, `tiktok_username`, `youtube_channel_id`, `linkedin_profile_url`, `twitter_username`, `facebook_id` | D | Decisión del 22/09: el handle es por canal, en `contact_channels` | |
| 34c | `setter_id` y `vendedor_id` | D | Construidas en 00017 | |
| 35a | Normalizar el teléfono en el servidor | R | F25 | |
| 35b | …**a E.164** | P | F25 dice "formato internacional" | B, definición E.164 única en §14 |
| 36a | Índices de teléfono, correo y marca de borrado | R | F25 | |
| 36b | Índices de `whatsapp_phone`, `setter_id` y `vendedor_id` | D | Regla 2: un índice no lo distingue ninguna comprobación. Los de asignación existen en 00017 | |
| 37 | Índices compuestos por workspace con teléfono y con correo | R | F25 | |
| 38 | RLS actualizada con el scope de leads | D | Cumplido en el Bloque 1 (00019), sostenido por F3 | |
| 39 | Los campos personalizados se conservan | R | F25 | |
| 40–42, 43a, 44 | Atribución, primer y último clic, origen de click-to-WhatsApp, sin RLS adicional | R | F25 | |
| 43b | `window_source = 'ctwa'` | B | F6c, en el apéndice | B, ya en el apéndice |

**F11, asignación de setter y vendedor (hoy sin funcionalidad propia; destino F41)**

Vuelve como **F41, funcionalidad nueva en el Bloque 3**, porque el desplegable es una capacidad que
el usuario ve por separado. **La fila F11 de §16 ("Construida en el Bloque 1 como parte de F3. Las
columnas ya existen") se corrige en el mismo commit que cree F41.** Lo que construyó el Bloque 1 son
las columnas y el scope, no la asignación desde la interfaz.

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 45 | Setter y vendedor visibles en la ficha | **P** | §11.2, "Ficha de contacto", la conserva en prosa entre los componentes; no hay criterio | A, F41 |
| 46 | **Se asignan desde un desplegable con los miembros** | **P** | **Grave.** No hay pantalla en el código ni criterio en el plano. Sin esto nadie asigna leads, y el scope de leads se apoya en esa asignación | A, F41 |
| 47 | Opcionales e independientes | R\* | §14, "Modelo de asignación" | A, F41 |
| 48 | Los cambios quedan en la auditoría | R | F31, "asignado" | |
| 49 | Filtrar la lista de contactos por cada uno | **P** | F35 filtra la bandeja, no los contactos | A, F41 |
| 50 | Cambiar una asignación cambia la visibilidad de inmediato | R | F3 | |

**F12, F13, F14 y F15, detección, notas, ficha y borrado suave (hoy F29 y F30)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 51–55, 56a, 57 | Detección entre canales, vinculación, registro de canal, hilos separados, sugerencia por usuario, agrupación por canal, auditoría | R | F29 | |
| 56b, 64b | **Cada conversación de la ficha con su estado de ventana** | P | F40 lo pone en la bandeja, no en la ficha | B: F40 para Instagram, apéndice del plan B para WhatsApp |
| 58–61 | Notas: tabla, lista, quién crea y quién edita | R | F30 | |
| 62 | RLS de las notas | P → **devuelto** | `0875ded`, el 22/09 | Ya devuelto |
| 63 | La ficha muestra **qué datos**: nombre, correo, teléfono, redes, país, setter, vendedor, temperatura, seguimiento | P | F30 dice "datos" sin enumerar | A, F30 |
| 64a, 65, 66 | Conversaciones por canal, secciones de la ficha, marca de no contactar | R | F30 | |
| 67 | **Botón para editar los datos** | P | | A, F30 |
| 68 | **Clic en una conversación lleva a ese hilo** | P | Hoy el enlace va a `/dashboard/inbox` a secas (medido el 22/09, ver F35) | A, F30 |
| 69–72, 73a, 74, 75 | Borrado suave, listados y reglas que lo excluyen, purga a 30 días en cascada, auditoría que no se purga | R | F30 | |
| 73b | La ruta `/api/cron/purge-deleted` | D | Regla 2: implementación | |

**F16, filtros de la bandeja (hoy F35)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 76a, 77a, 78a, 79a, 80a, 81–83 | Filtros por etiquetas, asignación, canal, fecha y ventana; combinables, en la dirección de la página, contador y limpiar | R | F35 | |
| 76b, 78b | Etiquetas y canal **con selección múltiple** | P | | A, F35 |
| 77b | Opciones de asignación: **"Sin asignar"** y **"Agente IA"** | P | | "Sin asignar": A, F35. "Agente IA": B, funcionalidades de fases siguientes |
| 79b | Fecha con **presets y rango personalizado** | P | | A, F35 |
| 80b | Ventana **"por vencer en menos de 2 horas"** | P | | A, F35 |

**F17, F18 y F19, respuestas rápidas, no contactar e importación (hoy F36, F34 y F37)**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 84–87, 88a, 89–91 | Respuestas rápidas completas, con aislamiento por workspace (F3) | R | F36 | |
| 88b | Variable **`{{workspace.name}}`**: datos del negocio, no solo del contacto | P | F36 dice "datos del contacto" | A, F36 |
| 92a, 93–95, 97, 98 | No contactar: lista configurable, detección, marca, reversión, bloqueo, fuera de secuencias | R | F34 | |
| 92b | **Las frases por defecto** ("stop", "basta", "no me escribas más"…) | P | Una comprobación lo nota: "stop" no se detecta | A, F34 |
| 96 | Advertencia con confirmación al escribir a un contacto marcado | D | Reemplazada por un bloqueo duro sin forzar, más estricto (F34) | |
| 99 | Botón "Importar CSV" en `/contacts` | P | Poco peso | A, F37 |
| 100, 101a, 103a, 103b, 104, 105a, 106, 107 | Tamaño, vista previa, identificador obligatorio, deduplicación, segundo plano, progreso, auditoría y `csv_imports` | R | F37 y el modelo de datos | |
| 101b | Vista previa de **5 filas** con **mapeo sugerido** | P | | A, F37 |
| 102 | Mapear a **setter, vendedor, etiquetas y campos personalizados** | P | | A, F37 |
| 103c | Teléfono **en E.164** | P | | B, definición E.164 única en §14 |
| 105b | `scheduled_jobs` | D | Regla 2 | |
| 105c | **Notificación al terminar** | P | Es una "notificación del sistema" concreta para el hueco de F23 | A, F37 |

**F20, auditoría (hoy F31), y checklist**

| # | Obligación | | | Destino |
|---|---|---|---|---|
| 108, 109, 110a, 111, 112 | Tabla, índices, eventos, quién ve qué, nunca se borra | R | F31 | |
| 110b | Auditar el envío y la aprobación de plantillas de WhatsApp | P | Del apéndice del plan B. Poco peso | B, apéndice del plan B |
| 113–115, 118, 122, 125, 127, 128 | RLS en todo, políticas probadas por API, Realtime con scope, validación en servidor, Vault, logs, firmas, versión de Zernio | R | Checklist actual, F1, F2 y F3 | |
| 116a | Sesión verificada en las rutas de API | R | Checklist | |
| 116b | **…y en las Server Actions** | **P** | El `CLAUDE.md` pone las mutaciones de la interfaz en Server Actions | A, checklist de §14b |
| 117 | **Rate limiting en los webhooks** | **P** | Ni en el plano ni en el `CLAUDE.md` | A, checklist de §14b |
| 119 | **Teléfonos en E.164** | P | Familia E.164 | B, definición E.164 única en §14 |
| 120 | **CORS con dominio específico** | **P** | Ni en el plano ni en el `CLAUDE.md` | A, checklist de §14b |
| 121 | **Headers de seguridad en la config de Next** | **P** | Ni en el plano ni en el `CLAUDE.md` | A, checklist de §14b |
| 123, 124, 126 | Service Role solo en el servidor, HTTPS, `.env` fuera de git | R\* | §14b y el `CLAUDE.md` | A, checklist de §14b |

**La familia E.164 (#13b, #35b, #103c, #119)** vuelve como una sola definición en §14, citada desde
F25, §7.1, F29 y F37. No cuatro copias que puedan divergir.

### Resumen

- **39 obligaciones perdidas**: las 38 de la clasificación del 22/09 más el #129. Una ya se devolvió
  (#62). Hay 11 descartadas con motivo (#2, #19, #23, #31b, #34b, #34c, #36b, #38, #73b, #96, #105b)
  y 5 que siguen vivas solo en prosa o en el `CLAUDE.md` (R\*: #5, #47, #123, #124, #126). El resto
  está reescrito o presente.
- **Destinos: 31 A, 11 B y 2 C**, para las 38 perdidas pendientes y las 5 R\*. Suman 44 y no 43
  porque #77b se parte en dos destinos. #12 y #43b, que ya son B cumplidas, no entran en la cuenta.
  - **A (31):** F24 5 (#20a, #22b, #22c, #27b, #32); F41 4 (#45, #46, #49 y R\* #47); F30 3 (#63,
    #67, #68); F35 5 (#76b, #78b, #79b, #80b y #77b "Sin asignar"); F36 1 (#88b); F34 1 (#92b);
    F37 4 (#99, #101b, #102, #105c); checklist de §14b 7 (#116b, #117, #120, #121 y R\* #123,
    #124, #126); F22 1 (R\* #5).
  - **B (11):** #56b y #64b; #13b, #35b, #103c y #119; #77b "Agente IA"; #3, #10, #110b y #129.
  - **C (2):** #24b y #25b.
- **Por peso, las que no deberían esperar:**
  1. **La asignación de setter y vendedor (#45, #46, #49).** No desapareció entera: §11.2 conserva
     en prosa la visibilidad en la ficha. Lo perdido es el desplegable para asignar y el filtro de
     contactos, y el scope de leads depende de que alguien pueda asignar.
  2. **Seguridad del checklist (#116b, #117, #120, #121):** Server Actions, rate limiting, CORS y
     headers.
  3. **La familia E.164 (#13b, #35b, #103c, #119).** El plano dice "formato internacional" y el
     `CLAUDE.md` dice E.164.
  4. **La ficha (#63, #67, #68, #56b):** qué datos muestra, que se pueda editar, que el clic lleve al
     hilo, y el estado de ventana.
  5. **La pantalla de integraciones (#32, #22b, #22c, #27b):** tiempo real, desconectar y estados.
- **Detalles de interfaz, de poco peso:** filtros (#76b a #80b), mapeo de la importación (#101b,
  #102), variable del negocio (#88b), frases por defecto (#92b), notificación al importar (#105c),
  sidebar (#20a), notas de precio (#24b, #25b), botón de importar (#99), y lo del plan B (#3, #10,
  #110b).
- **Descartes provisorios que conviene mirar:** el #19 (sin comprobación posible hoy) y el #38
  (cumplido en el Bloque 1: ¿alcanza con F3, o F25 tiene que repetirlo?).

## Cómo seguir

1. ~~Calibrar con tres casos y fijar las reglas.~~ Hecho: son las cuatro reglas de arriba.
2. ~~Lo de los sinónimos.~~ Ya no bloquea: la lista sale de la comparación por texto exacto, y la
   similitud solo sugiere.
3. ~~Clasificar.~~ Hecho, de forma provisoria.
4. ~~Revisar la lista entera juntos, y decidir si R\* cuenta como presente.~~ Hecho el 23/09: cada
   perdida y cada R\* tiene destino A, B o C (ver "Destinos").
5. Recién ahí corregir el plano. El commit que cree F41 corrige también la fila F11 de §16. Cada corrección pasa por la foto de criterios. Las bajas deliberadas
   (las D) van a `docs/criterios-bajas.json` solo si alguna vez estuvieron en la foto. Estas son
   anteriores a la foto, así que su registro es este documento.
