-- ============================================================
-- EL ÚLTIMO ESTADO CONOCIDO DE LA SESIÓN DE WHATSAPP (F32)
-- ============================================================
-- Un «no se pudo verificar» pisa `session_state`, que era el único lugar donde
-- quedaba que el canal estaba agotado. Después, un `close` con la marca daba
-- «caído» con un segundo correo, sin la marca «sin vincular», y dos `connecting`
-- seguidos «caído» (03/11/2026, S7 tramo 3, decidido por Marcos).
--
-- `session_known_state` guarda el último estado que no fue «no se pudo
-- verificar». `session_state` no cambia de significado: mientras no se sabe,
-- sigue diciendo «sin_verificar», y eso es lo que muestran la pantalla y la
-- bandeja (criterios 3 y 8 de F32). La regla la lee para no perder el agotado,
-- y para no mandar otro correo al volver al mismo estado.
--
-- Rellena las filas que ya tienen un estado conocido: un nulo o un
-- «sin_verificar» quedan vacíos, como si fuera la primera lectura.
-- Idempotente: `add column if not exists`, `drop constraint if exists` y el
-- relleno solo donde está vacía.
-- ============================================================

alter table channels add column if not exists session_known_state text;

alter table channels drop constraint if exists channels_session_known_state_check;
alter table channels add constraint channels_session_known_state_check check (session_known_state in (
  'conectado',
  'caido',
  'agotado',
  'sin_vincular'
));

update channels
  set session_known_state = session_state
  where session_known_state is null
    and session_state is not null
    and session_state <> 'sin_verificar';

comment on column channels.session_known_state is
  'Último estado de la sesión de WhatsApp que no fue sin_verificar (F32): conectado, caido, agotado o sin_vincular. Nulo si nunca se conoció.';
