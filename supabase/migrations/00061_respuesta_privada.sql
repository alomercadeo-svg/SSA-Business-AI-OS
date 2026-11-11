-- ============================================================
-- 00061: LA RESPUESTA PRIVADA A UN COMENTARIO (F40; ítem 6 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- Verificado el 06/11/2026: `comment_logs.created_at` es la hora de proceso,
-- ninguna columna registraba la respuesta privada, y `dm_sent` queda en `true`
-- aunque el envío falle. Para controlar «hasta 7 días desde el comentario, una
-- sola vez» hacen falta:
--   - `comentado_at`: la hora del comentario según el aviso de Zernio
--     (`comment.createdAt`). Nula en los ya registrados: ahí cuenta
--     `created_at`, que es la hora de proceso (unos segundos después).
--   - `respuesta_privada_at`: cuándo se mandó. El envío la reclama ANTES de
--     llamar a Zernio (`update ... where respuesta_privada_at is null`), y la
--     suelta si Zernio la rechaza.
--   - `respuesta_privada_error`: el último rechazo, para saber qué pasó.
-- Sin políticas nuevas: la escribe solo el servidor. Idempotente.

alter table public.comment_logs add column if not exists comentado_at timestamptz;
alter table public.comment_logs add column if not exists respuesta_privada_at timestamptz;
alter table public.comment_logs add column if not exists respuesta_privada_error text;

comment on column public.comment_logs.comentado_at is 'F40: la hora del comentario según el aviso de Zernio. Nula en los registrados antes de la 00061 (cuenta created_at).';
comment on column public.comment_logs.respuesta_privada_at is 'F40: cuándo se mandó la respuesta privada. Una sola vez por comentario, hasta 7 días desde el comentario.';
comment on column public.comment_logs.respuesta_privada_error is 'F40: el último rechazo de Zernio al responder en privado.';
