-- ============================================================
-- EL ESTADO DE SESIÓN DEL CANAL DE WHATSAPP (F32)
-- ============================================================
-- La pantalla de canales tiene que mostrar si la sesión de WhatsApp está
-- conectada, y la bandeja tiene que avisar cuando se cae. El estado lo escriben
-- dos caminos: el receptor, con `connection.update` de Evolution, y el chequeo
-- periódico de las tareas programadas, porque ante una caída pasajera Evolution
-- reconecta solo y no avisa.
--
-- `session_state` y `session_checked_at` son los nombres del modelo de datos
-- del plano (la 00022 los dejó para el Bloque 4). Se suman tres:
--   session_changed_at  cuándo cambió el estado.
--   session_detail      la última lectura cruda de Evolution (`open`,
--                       `connecting`, `close`, `refused`) o el motivo de un «no
--                       se pudo verificar». Sin secretos. La regla de
--                       «connecting dos veces seguidas» la lee.
--   session_linked_at   la marca de «alguna vez estuvo conectado». Se pone la
--                       primera vez que la sesión se ve abierta y no se borra
--                       nunca: sin ella, un `close` es «sin vincular» y no una
--                       caída (decisión de Marcos del 02/11/2026).
--
-- Y el tipo de correo `sesion_whatsapp` en la lista cerrada de F23, que la 00027
-- dejó anunciado. El nombre del `check` en línea de la 00027 es
-- `email_log_tipo_check`, leído en producción el 02/11/2026.
--
-- No toca filas: las columnas nacen vacías y los `check` solo amplían.
-- Idempotente: `add column if not exists` y `drop constraint if exists`.
-- ============================================================

alter table channels add column if not exists session_state text;
alter table channels add column if not exists session_checked_at timestamptz;
alter table channels add column if not exists session_changed_at timestamptz;
alter table channels add column if not exists session_detail text;
alter table channels add column if not exists session_linked_at timestamptz;

alter table channels drop constraint if exists channels_session_state_check;
alter table channels add constraint channels_session_state_check check (session_state in (
  'conectado',
  'caido',
  'agotado',
  'sin_verificar',
  'sin_vincular'
));

comment on column channels.session_state is
  'Estado de la sesión de WhatsApp (F32): conectado, caido, agotado, sin_verificar o sin_vincular. Nulo hasta la primera lectura.';
comment on column channels.session_linked_at is
  'Primera vez que la sesión se vio abierta (F32). No se borra nunca.';

alter table email_log drop constraint if exists email_log_tipo_check;
alter table email_log add constraint email_log_tipo_check check (tipo in (
  'invitacion',
  'alerta_webhook',
  'sesion_whatsapp'
));
