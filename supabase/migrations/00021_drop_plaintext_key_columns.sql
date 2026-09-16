-- ============================================================
-- BORRADO DE LAS COLUMNAS DE CLAVES EN TEXTO PLANO (F2, fase de contraer)
-- ============================================================
-- Cierre del expandir-y-contraer que empezó la 00018.
--
-- La 00018 copió los valores de `workspaces.late_api_key_encrypted` y
-- `workspaces.ai_api_key` a Vault y NO borró nada, a propósito: los dos
-- mecanismos tenían que convivir mientras se reescribían las 16 lecturas del
-- código. Si esa reescritura salía mal, el dato viejo todavía estaba.
--
-- Ahora Vault está probado en todos los caminos: la UI de settings, el webhook,
-- el motor de flujos, el procesador de secuencias, el nodo de IA y el cron. Ya
-- ningún archivo de `app/`, `lib/` ni `components/` lee ni escribe estas dos
-- columnas; lo único que queda son los tipos, que se borran en este mismo
-- commit.
--
-- POR QUÉ IMPORTA BORRARLAS Y NO SOLO DEJAR DE LEERLAS
-- Mientras la columna existe, el valor existe. En esta base se vaciaron a mano
-- al cerrar la Sesión A, pero en una instalación desde cero la 00018 deja el
-- texto plano sentado en la fila hasta acá: la migración copia, no mueve. Un
-- `select *` sobre `workspaces` —el que hacían las seis consultas que se
-- corrigieron— lo traía entero. Borrar la columna es lo que hace que el dato
-- deje de existir, y recién con eso se cumple el criterio de F2: "consultar
-- select * from workspaces no devuelve ninguna clave de API".
--
-- NO TOCA `webhook_secret`. Es el tercer secreto de la tabla, pero está en uso:
-- `lib/zernio-webhook.ts` lo necesita para validar la firma HMAC de los
-- webhooks entrantes. Sigue protegido por `lib/safe-columns.ts`, que prohíbe el
-- `select("*")` y el nombre de la columna fuera del allowlist.
--
-- Idempotente: `drop column if exists`.
-- ============================================================

alter table workspaces
  drop column if exists late_api_key_encrypted,
  drop column if exists ai_api_key;

-- Deja constancia en el esquema de dónde viven ahora, para quien mire la tabla
-- buscando la clave y no la encuentre.
comment on table workspaces is
  'Workspace del sistema. Las API keys (Zernio, AI Gateway) NO viven acá: están en Supabase Vault, bajo el nombre ws:<workspace_id>:<nombre>. Se leen y escriben con las funciones read_secret / store_secret / delete_secret (00018).';
