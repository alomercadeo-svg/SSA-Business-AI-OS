-- ============================================================
-- BORRAR UN CANAL NO PUEDE BORRAR SU HISTORIAL (F24)
-- ============================================================
-- Las claves foráneas de `channel_id` hacia `channels` en las tablas con
-- historia pasan de ON DELETE CASCADE a ON DELETE RESTRICT. Con eso, la base
-- rechaza borrar un canal que tiene conversaciones (y por ellas, mensajes),
-- identidad de contacto, registro de comentarios, inscripciones a secuencias,
-- destinatarios de difusiones o sesiones de flujo.
--
-- POR QUÉ EN LA BASE. La ruta heredada `DELETE /api/v1/channels/[channelId]`
-- borraba la fila del canal y todo eso se iba en cascada. El 05/10/2026 la
-- ruta pasó a responder 405, pero la protección que no depende de la interfaz
-- ni de una ruta es esta: el historial vive en la base local por decisión
-- cerrada del proyecto. Desconectar es marcar el canal inactivo.
--
-- QUÉ NO SE TOCA, a propósito:
--   - Las claves de `contact_id`. La purga de F30 borra contactos y se lleva su
--     historia en cascada, y eso es intencional.
--   - `triggers.channel_id` y `webhook_alerts.channel_id`, que ya son SET NULL:
--     borrar el canal no borra esas filas.
--
-- Idempotente y sin suponer nombres: si la clave de una tabla tiene otro
-- nombre, primero se renombra al esperado (`<tabla>_channel_id_fkey`), después
-- se recrea con `drop ... if exists` + `add`, y al final un bloque comprueba
-- contra el catálogo que cada tabla tiene exactamente una clave hacia
-- `channels` y que es RESTRICT. Si no, la migración falla entera.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select t.relname as tabla, c.conname as nombre
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class f on f.oid = c.confrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and f.relname = 'channels'
      and t.relname in ('conversations', 'contact_channels', 'comment_logs', 'sequence_enrollments', 'broadcast_recipients', 'flow_sessions')
      and c.conname <> t.relname || '_channel_id_fkey'
  loop
    execute format('alter table public.%I rename constraint %I to %I', r.tabla, r.nombre, r.tabla || '_channel_id_fkey');
  end loop;
end $$;

alter table conversations drop constraint if exists conversations_channel_id_fkey;
alter table conversations add constraint conversations_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

alter table contact_channels drop constraint if exists contact_channels_channel_id_fkey;
alter table contact_channels add constraint contact_channels_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

alter table comment_logs drop constraint if exists comment_logs_channel_id_fkey;
alter table comment_logs add constraint comment_logs_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

alter table sequence_enrollments drop constraint if exists sequence_enrollments_channel_id_fkey;
alter table sequence_enrollments add constraint sequence_enrollments_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

alter table broadcast_recipients drop constraint if exists broadcast_recipients_channel_id_fkey;
alter table broadcast_recipients add constraint broadcast_recipients_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

alter table flow_sessions drop constraint if exists flow_sessions_channel_id_fkey;
alter table flow_sessions add constraint flow_sessions_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete restrict;

-- Comprobación contra el catálogo, no contra lo que se escribió arriba: cada
-- tabla tiene exactamente una clave hacia channels, y es RESTRICT ('r').
do $$
declare
  t text;
  cuantas int;
  restrictivas int;
begin
  foreach t in array array['conversations', 'contact_channels', 'comment_logs', 'sequence_enrollments', 'broadcast_recipients', 'flow_sessions']
  loop
    select count(*), count(*) filter (where c.confdeltype = 'r')
      into cuantas, restrictivas
    from pg_constraint c
    join pg_class tb on tb.oid = c.conrelid
    join pg_class f on f.oid = c.confrelid
    join pg_namespace n on n.oid = tb.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and f.relname = 'channels' and tb.relname = t;
    if cuantas <> 1 or restrictivas <> 1 then
      raise exception 'channels: % tiene % claves hacia channels y % en RESTRICT; se esperaba exactamente una en RESTRICT', t, cuantas, restrictivas;
    end if;
  end loop;
end $$;
