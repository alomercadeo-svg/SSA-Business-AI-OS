# Contingencia del canal de WhatsApp

**Qué es este documento:** el procedimiento a ejecutar si el canal de WhatsApp se cae por una acción de Meta o de WhatsApp, en cualquiera de sus formas. No es una explicación del riesgo, es la lista de pasos.

**Qué no es:** no es el plano. El plano está en `docs/requerimientos-fase1.md`. Acá no se define alcance ni criterios de aceptación; se define qué hacer el día que el canal deje de funcionar.

**Cómo leer las afirmaciones:** todo lo que dice "verificado" tiene su cita textual en §7. Todo lo demás está marcado como inferencia, suposición o pregunta abierta, con esas palabras. Si una afirmación no tiene ninguna de las dos marcas, es un error de este documento y hay que corregirlo.

**Última investigación contra la documentación de Meta:** 22 de septiembre de 2026.

---

## 0. Las cuatro entidades, y cuál sobrevive a qué

Casi todos los malentendidos sobre este tema salen de que "cuenta de negocio" nombra cuatro cosas distintas. Antes del procedimiento hay que tener claro cuál es cuál, porque el procedimiento cambia según cuál esté en riesgo.

| Entidad | Qué es | De qué depende |
|---|---|---|
| **Perfil de la app de WhatsApp Business** | Nombre, descripción, horarios, catálogo | Del número y del teléfono. Es un formulario, no un activo |
| **Portafolio de negocio de Meta** | El contenedor de la organización en Business Manager | De nada relacionado con un número |
| **WABA** (WhatsApp Business Account) | Vive dentro del portafolio. Es dueña de las plantillas y puede tener varios números | Del portafolio |
| **Número de negocio** | El número registrado en una WABA | De la WABA |

**El hallazgo central, verificado:** Meta aplica las sanciones **al nivel de la WABA**, no del número. Eso tiene una consecuencia contraintuitiva y es la que gobierna todo este documento:

> **Conseguir otro número funciona hoy, y deja de funcionar el día que exista una WABA.**

Hoy funciona porque no hay ninguna cuenta de negocio de Meta en juego: el número es una cuenta de la app y nada más. Cuando exista una WABA, un número nuevo dentro de una WABA sancionada es un número nuevo dentro de una cuenta sancionada.

**Y el activo que importa no está del lado de Meta en ningún escenario.** Los contactos, las conversaciones, el estado de cada lead, la atribución y las asignaciones viven en la base del negocio. Es para eso que existe F27, y es lo que hace que cualquiera de los tres escenarios de abajo sea sobrevivible.

---

## 1. Escenario A: bloqueo del número hoy, sobre Evolution

**Cuándo aplica:** mientras el canal corra por Evolution API y no exista ninguna WABA. Es la situación actual.

**Qué es el riesgo real.** WhatsApp bloquea el número por usar un cliente no oficial o por patrones de envío que parecen difusión. Es un bloqueo del número en WhatsApp, no una sanción de cuenta de negocio, porque no hay cuenta de negocio.

**Qué se pierde:**

- El número.
- El historial de chat que viva solo en el teléfono.
- El perfil de la app, que se vuelve a llenar en diez minutos.

**Qué NO se pierde:** contactos, conversaciones, mensajes guardados, estado comercial de cada lead, atribución, asignaciones de setter y vendedor, notas, etiquetas. Todo eso está en la base.

**Procedimiento:**

1. **Confirmar que es un bloqueo y no una caída de sesión.** No son lo mismo y el síntoma inicial se parece. La pantalla de estado de canal (F32) dice si la sesión está caída; un bloqueo se confirma intentando abrir WhatsApp con ese número en un teléfono, donde aparece el aviso de cuenta bloqueada.
2. **Apagar las secuencias antes que nada.** Si hay envíos encolados contra un número bloqueado, cada intento falla y ensucia el diagnóstico.
3. **Conseguir el número nuevo.** No reutilizar el bloqueado: registrarlo de nuevo requiere apelación (ver §3) y no vale la pena por un número.
4. **Dar de alta el número nuevo en WhatsApp Business** y vincularlo a la instancia de Evolution con el procedimiento de `docs/despliegue-evolution.md`.
5. **Actualizar el número en la base del canal**, no crear un canal nuevo, para que las conversaciones existentes no se dupliquen.
6. **Avisar a los leads activos.** Es el único paso que no es técnico y el que más cuesta: los leads en seguimiento tienen el número viejo guardado. Sale del CRM: los contactos con conversación abierta o seguimiento pendiente.
7. **Actualizar la pauta**, la firma de Alejandra, y cualquier lugar donde el número esté publicado.

**Lo que hay que tener listo de antemano para que esto sea un día y no una semana:** ver §4.

---

## 2. Escenario B: migración preventiva a la API oficial

**Cuándo aplica:** **antes** de cualquier bloqueo. Es la única rama que se ejecuta de punta a punta sin depender de que Meta acepte nada, y por eso es la que conviene planificar en serio.

**Disparadores.** No se espera el bloqueo: se migra cuando aparece cualquiera de estas señales.

- Una advertencia de Meta o WhatsApp sobre el número.
- Un bloqueo temporal de envío, de los de uno o tres días.
- Caída sostenida de la proporción de respuesta de los seguimientos, que es la métrica de salud de F39.
- Volumen creciendo hasta donde el riesgo de Evolution deje de valer la pena.
- Decisión comercial de profesionalizar el canal.

**Prerrequisitos, verificado:** para registrar un número en la API oficial, el número tiene que salir de donde esté. *"Numbers already in use with WhatsApp cannot be registered unless they are deleted first."*

**Y hay dos caminos, con consecuencias muy distintas, verificado:**

| Camino | Qué pasa con el historial | Qué pasa con la app |
|---|---|---|
| Borrar la cuenta de la app | *"your existing messaging history will be lost"* | *"you will be unable to use that number with the WhatsApp Business app again, unless you deregister the number from Cloud API"* |
| Onboarding a través de un socio que soporte números de la app de negocio | *"messaging history will be preserved"* | Se puede seguir usando la app en paralelo |

**El segundo camino es mucho mejor y depende de Zernio.** Es la pregunta abierta 1 de §6. Si Zernio lo soporta, la migración no pierde historial y el número no sale de la app. Si no lo soporta, hay que respaldar el historial del teléfono antes de borrar la cuenta, y la documentación de Meta lo recomienda explícitamente.

**Pasos:**

1. **Confirmar con Zernio cuál de los dos caminos aplica.** Cambia todo lo que sigue.
2. **Crear la WABA y dejar las plantillas aprobadas antes de tocar el número.** Verificado: *"Templates are WhatsApp Business Account assets"*, y la revisión tarda *"up to 24 hours"*. Como las plantillas son de la WABA y no del número, aprobarlas de antemano saca las 24 horas del camino crítico. Queda sin confirmar si una WABA puede existir con cero números registrados: ver pregunta abierta 2.
3. **Respaldar el historial del teléfono**, si el camino es el de borrar la cuenta.
4. **Apagar las secuencias.**
5. **Borrar la cuenta de la app** (Ajustes, Cuenta, Eliminar mi cuenta) o ejecutar el onboarding del socio. Verificado: *"It may take up to 3 minutes for the disconnected number to become available."*
6. **Registrar el número en la WABA.**
7. **Cambiar el proveedor del canal en el sistema**, de Evolution a Zernio, sin crear un canal nuevo.
8. **Activar el modelo de ventana y plantillas**, que está escrito y sin construir en el plano. Desde este momento el seguimiento semanal y quincenal pasa a ser mensajes de plantilla con costo por envío y por lead.
9. **Verificación de punta a punta:** un mensaje entrante que llegue a la bandeja y un saliente que llegue al teléfono. Las dos direcciones, porque fallan por motivos distintos.

**Lo que cambia para el negocio, y hay que decirlo antes de migrar:** el seguimiento fuera de las 24 horas deja de ser texto libre gratis y pasa a ser plantilla aprobada con costo. Esa es la razón por la que este proyecto eligió Evolution, así que migrar es aceptar ese costo.

**Los topes, verificado:** *"Newly created business portfolios have a messaging limit of 250"* contactos únicos cada 24 horas. La verificación de negocio en Meta no es requisito para arrancar: es uno de los caminos para subir el tope a 2.000. Para el volumen de este negocio, 250 sobra.

---

## 3. Escenario C: sanción con una WABA ya existente

**Cuándo aplica:** después de haber migrado a la API oficial.

**Acá el número nuevo no sirve y es el punto más importante de este documento.** Verificado: *"WhatsApp will enforce on WhatsApp Business Accounts that repeatedly violate"*. La sanción sigue a la cuenta, así que agregar un número a una WABA sancionada da un número nuevo dentro de una cuenta sancionada.

**La escalera de sanciones, verificado.** Importa porque los primeros escalones son la señal temprana que permite ejecutar el escenario B mientras todavía se puede:

1. Advertencia con el detalle de la violación.
2. *"1 or 3 day block on sending marketing, utility, and authentication template messages"*.
3. *"5, 7, or 30 day block on sending any messages"*.
4. *"an indefinite block on sending any messages; can only be removed via an appeal"*.
5. Deshabilitación permanente de la plataforma.
6. Baja inmediata, para violaciones graves.

**La apelación, verificado.** Desde Business Support Home, eligiendo la WABA, con "Request Review" y los detalles de respaldo. La decisión *"typically takes 24 to 48 hours"* y llega como "Unchanged" o "Reversed".

**Procedimiento:**

1. **Leer en qué escalón estamos.** Los escalones 1 a 3 no son una emergencia: son la ventana para arreglar la causa. El 4 y el 5 sí.
2. **En los escalones 1 a 3: apagar las secuencias, encontrar la causa, arreglarla.** No apelar todavía: una apelación sin la causa corregida gasta el intento.
3. **En el escalón 4: apelar, y en paralelo preparar la salida.** No se espera el resultado de la apelación cruzado de brazos.
4. **La salida, si la apelación queda "Unchanged":** un portafolio nuevo, una WABA nueva, un número nuevo, y las plantillas de nuevo a revisión. Eso es reconstruir desde cero del lado de Meta. Del lado nuestro no se pierde nada, porque los datos están en la base.
5. **Volver a Evolution es una opción, no una derrota.** Si la WABA queda inutilizable, el canal puede volver a Evolution con un número nuevo, que es el escenario A. El sistema soporta los dos proveedores por diseño.

**Una asimetría que conviene tener presente:** en Evolution el riesgo es perder un número; con una WABA el riesgo es perder la cuenta, que es más caro de reconstruir. No es un argumento para no migrar, es la razón por la que las seis reglas de seguridad de secuencia tienen que estar aplicadas por el sistema y no por la memoria de nadie. Su valor real aparece recién en el escenario donde el número nuevo ya no salva.

---

## 4. Lo que hay que tener listo de antemano

Ninguna de estas cosas se construye el día del problema. Todas son baratas hoy y caras ese día.

| Qué | Para qué escenario | Estado |
|---|---|---|
| **El historial en la base local (F27)** | Los tres | Es la compuerta antes de vincular el número. Sin esto, cualquiera de los tres escenarios pierde las conversaciones |
| **Un segundo número disponible** | A | Pendiente. Es la única rama que no depende de que Meta acepte una apelación |
| **El texto de las plantillas de seguimiento, redactado** | B y C | Pendiente. No acelera a Meta, pero saca de la ruta crítica el trabajo de inventar la copia con el canal caído |
| **El paso de secuencia que referencia una plantilla por ID** | B y C | Se define en Fase 2. Si el paso guarda el cuerpo como texto libre, migrar obliga a reescribir el motor de secuencias, no a agregar una tabla |
| **La lista de leads activos exportable del CRM** | A y C | Sale de la bandeja. Es el paso 6 del escenario A y es el que más tarda si hay que armarlo a mano |
| **Respaldo del historial del teléfono** | B, si Zernio no soporta el onboarding desde la app | Recomendado explícitamente por Meta antes de borrar la cuenta |
| **La WABA creada con plantillas aprobadas** | B | Pendiente de la pregunta abierta 2 |

---

## 5. Señales tempranas

Las señales tempranas no son métricas de reporte: son el mecanismo que hace ejecutable el escenario B. Sirven para migrar mientras migrar todavía es posible, que es antes del escalón 4.

| Señal | De dónde sale | Estado |
|---|---|---|
| Proporción de respuesta de los seguimientos | Métrica de salud de las reglas de secuencia | Diseñada, no construida |
| Silencio del canal | F39 | Bloque 3 |
| Estado de sesión caído | F32 | Bloque 3 |
| Advertencias y bloqueos temporales de Meta | Solo existen con una WABA. Si Zernio los expone, es la señal más directa de todas | Pregunta abierta 3 |

---

## 6. Preguntas abiertas, con dueño

Ninguna de estas es un supuesto de este documento. Están sin responder y las respuestas cambian el procedimiento.

**1. ¿Zernio soporta el onboarding de un número que está en la app de WhatsApp Business, conservando el historial?** Dueño: Marcos, preguntando a Zernio. Si la respuesta es sí, el escenario B no pierde historial y el número no sale de la app. Es la pregunta de mayor impacto de las tres.

**2. ¿Puede existir una WABA con cero números registrados, con plantillas aprobadas esperando?** Dueño: Marcos, comprobándolo. La documentación confirma que las plantillas son activos de la WABA y no del número, pero no dice explícitamente que la WABA pueda existir sin números. Se resuelve creando la WABA e intentando. Si la respuesta es sí, el escenario B baja de días a horas.

**3. ¿Zernio expone las advertencias y los bloqueos temporales de Meta, por API o por webhook?** Dueño: Marcos, preguntando a Zernio. Si los expone, F39 gana una entrada directa en vez de inferir la salud del canal desde la proporción de respuesta.

**4. ¿El nombre visible de un número nuevo dentro de una WABA existente necesita aprobación aparte?** No verificado. Afecta cuánto tarda el paso 4 del escenario C.

**5. ¿Hay manera de forzar que Zernio complete el perfil de una conversación, o de suscribirse a un evento de perfil completado? Hoy solo 2 de 500 conversaciones traen `instagramProfile`.** Dueño: Marcos, preguntando a Zernio. Es de Instagram, no de WhatsApp: está acá porque esta es la lista de preguntas abiertas a Zernio. **La restricción que la origina, medida el 22 de septiembre de 2026:** Zernio manda el handle en el campo del nombre, tanto en el listado de conversaciones como en el webhook, y el nombre real aparece recién cuando completó el perfil. En la muestra de ese día eso pasó justo después de un mensaje entrante. Así que la bandeja va a mostrar handles donde la app de Instagram muestra nombres, y **es un límite de Zernio, no nuestro**. Si la respuesta es sí, los contactos que nunca vuelven a escribir también pueden recibir su nombre real.

---

## 7. Fuentes

Todas consultadas el 22 de septiembre de 2026. Las citas textuales del documento salen de acá.

| Afirmación | Fuente |
|---|---|
| Un número bloqueado necesita desbloqueo por apelación antes de poder registrarse; los números ya en uso hay que borrarlos primero | [Business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| Las sanciones se aplican a nivel de WABA; la escalera de seis escalones; el procedimiento de apelación y sus 24 a 48 horas | [Policy and spam enforcement](https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement) |
| Los dos caminos de migración, la pérdida de historial, los 3 minutos, la recomendación de respaldar | [Migrate an existing WhatsApp number to a business account](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account/) |
| Las plantillas son activos de la WABA; la revisión tarda hasta 24 horas; los estados de plantilla | [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) |
| El tope de 250 contactos únicos para portafolios nuevos; la verificación como camino a 2.000 | [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) |

**Sobre la caducidad de estas fuentes:** Meta cambia estas reglas sin aviso. Cualquier decisión que se tome sobre este documento pasados unos meses tiene que re-verificar las citas antes, no después. Si al releerlo las citas no se pueden confirmar, el documento es un punto de partida, no una referencia.
