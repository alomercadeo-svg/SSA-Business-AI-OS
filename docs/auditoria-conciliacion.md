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

**Estado: empezada el 22/09/2026 a las 19:55 y cortada a las 19:57 por hora. Solo se revisó F8, la
pantalla de integraciones (hoy F24), como control positivo del método. Faltan las otras 38
funcionalidades de las dos fuentes.**

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

## Cómo seguir

1. Revisar juntos los tres primeros de la lista y fijar el criterio de clasificación.
2. Decidir lo de los sinónimos, antes de correr el resto.
3. Correr las otras 38 funcionalidades de las dos fuentes, sin filtro de encabezado, y clasificar.
4. Recién ahí corregir el plano. Esta auditoría no arregla nada.
