-- ============================================================
-- ADJUNTOS (F28)
-- ============================================================
-- F28 baja el archivo de cada adjunto entrante al recibirlo y lo guarda en
-- Storage. Esta migración trae lo que hace falta para eso, y nada más:
--
-- 1. Cuatro columnas de `messages` para el archivo bajado y una para el
--    reintento:
--    - `media_intentos`: cuántas veces se intentó bajar. SIN VALOR POR
--      DEFECTO, A PROPÓSITO: los mensajes que ya están en la base (los
--      importados y los que llegaron antes de F28) quedan en nulo, y el
--      reintento solo toma filas con intentos no nulos. El receptor la pone en
--      0 al guardar un entrante con archivo. Así el reintento no puede elegir
--      un histórico, aunque los dos tengan `media_status = 'pendiente'`: los
--      históricos son de la parte B de F28 y no se tocan.
--    - `media_reclamado_at`: la hora del último intento tomado. El reintento
--      espera desde acá, no desde `created_at` (que es la hora del proveedor):
--      así no alcanza a una descarga que todavía está en curso.
--    - `media_mime` y `media_bytes`: el tipo detectado por el contenido del
--      archivo (sus primeros bytes) y el tamaño guardado.
--    - `media_error`: un código corto del último fallo (`http_403`,
--      `tipo_no_permitido`, `excede_tamano`…). Nunca contenido del mensaje.
--
-- 2. Un índice parcial para que el reintento encuentre lo suyo sin recorrer
--    la tabla.
--
-- 3. El bucket `message-media` (§9 del plano), PRIVADO. Sin ninguna política
--    en `storage.objects` ni en `storage.buckets`: con la seguridad por filas
--    activa y sin políticas, solo la clave de servicio lee y escribe. El
--    navegador no lee el bucket; la bandeja recibe direcciones firmadas que da
--    el servidor. El 09/10/2026, antes de escribir esto, el esquema `storage`
--    de producción tenía 0 políticas y 0 buckets (consulta de catálogo).
--    `allowed_mime_types` es la misma lista que `FORMATOS_PERMITIDOS` de
--    `lib/adjuntos-formatos.ts`: un test falla si difieren. `file_size_limit`
--    es un techo duro de 100 MB; el límite que aplica la app es menor y
--    configurable (`ADJUNTOS_TAMANO_MAXIMO_MB`, 25 por defecto).
--
-- El insert en `storage.buckets` es el que da la documentación de Supabase
-- (https://supabase.com/docs/guides/storage/buckets/creating-buckets).
--
-- Idempotente: `add column if not exists`, `create index if not exists`,
-- `drop constraint if exists` antes del `check`, y el bucket con
-- `on conflict (id) do nothing`.
-- ============================================================


-- ── 1. Columnas ──────────────────────────────────────────────────────────

alter table messages
  add column if not exists media_intentos integer,
  add column if not exists media_reclamado_at timestamptz,
  add column if not exists media_mime text,
  add column if not exists media_bytes bigint,
  add column if not exists media_error text;

alter table messages drop constraint if exists messages_media_intentos_check;
alter table messages add constraint messages_media_intentos_check
  check (media_intentos is null or media_intentos >= 0);

comment on column messages.media_intentos is
  'Intentos de bajar el adjunto (F28). Nulo = el receptor no lo marcó para bajar (históricos y salientes): el reintento no lo toma.';
comment on column messages.media_reclamado_at is
  'Hora del último intento tomado de bajar el adjunto (F28). El reintento espera desde acá.';
comment on column messages.media_mime is
  'Tipo del archivo detectado por su contenido, no por la extensión ni por el proveedor (F28).';
comment on column messages.media_bytes is
  'Tamaño del archivo guardado en Storage (F28).';
comment on column messages.media_error is
  'Código corto del último fallo al bajar el adjunto (F28). Nunca contenido.';


-- ── 2. Índice del reintento ──────────────────────────────────────────────

create index if not exists messages_adjuntos_por_reintentar
  on messages (media_reclamado_at)
  where media_intentos is not null and media_status in ('pendiente', 'fallido');


-- ── 3. El bucket privado ─────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-media',
  'message-media',
  false,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac',
    'application/pdf'
  ]
)
on conflict (id) do nothing;
