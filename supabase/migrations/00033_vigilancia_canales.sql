-- ============================================================
-- VIGILANCIA DE CANALES (F39)
-- ============================================================
-- F39 abre una alerta cuando un canal pasa más horas hábiles sin recibir
-- mensajes que su límite. Para contar horas hábiles hacen falta el horario y la
-- zona horaria del negocio, y para comparar, el límite de cada canal. Tres
-- columnas, y nada más:
--
-- 1. `workspaces.zona_horaria`: la zona IANA del negocio. Por defecto
--    America/Costa_Rica. Que sea una zona válida lo controla el servidor al
--    guardar (con `Intl`), no un `check`: Postgres no puede validar contra su
--    lista de zonas dentro de un `check`.
--
-- 2. `workspaces.horario_atencion`: las franjas por día de la semana, en la
--    hora local del negocio. Forma: {"lun": [["08:00", "18:00"]], ...,
--    "dom": []}; un día sin franjas no cuenta. El valor por defecto es el del
--    prototipo aprobado el 06/10/2026 (`docs/diseno/prototipo-fase1.html:844`):
--    lunes a viernes de 8:00 a 18:00 y sábado de 9:00 a 12:00. NO LO CONFIRMÓ
--    ALEJANDRA: es el valor del prototipo. La forma de cada franja la valida el
--    servidor al guardar; acá solo se exige que sea un objeto.
--
-- 3. `channels.umbral_silencio_horas`: el límite de silencio del canal, en
--    horas hábiles. Nulo = el canal no se vigila. Por defecto 8. Las filas que
--    ya existen quedan en 8, como cualquier columna nueva con valor por
--    defecto; esta migración no escribe ningún canal en particular.
--
-- Lo leído de la suscripción de Zernio, su hora y su error van en
-- `tareas_estado.resultado` (00032), no en columnas nuevas.
--
-- Idempotente: `add column if not exists` y `drop constraint if exists` antes
-- de cada `check`.
-- ============================================================

alter table workspaces
  add column if not exists zona_horaria text not null default 'America/Costa_Rica',
  add column if not exists horario_atencion jsonb not null default
    '{"lun": [["08:00", "18:00"]], "mar": [["08:00", "18:00"]], "mie": [["08:00", "18:00"]], "jue": [["08:00", "18:00"]], "vie": [["08:00", "18:00"]], "sab": [["09:00", "12:00"]], "dom": []}'::jsonb;

alter table workspaces drop constraint if exists workspaces_horario_atencion_check;
alter table workspaces add constraint workspaces_horario_atencion_check
  check (jsonb_typeof(horario_atencion) = 'object');

comment on column workspaces.zona_horaria is
  'Zona IANA del negocio (F39). Define qué es «hoy» y las horas hábiles. La valida el servidor.';
comment on column workspaces.horario_atencion is
  'Horario de atención del negocio por día (lun..dom), franjas [desde, hasta] en hora local (F39). Por defecto el del prototipo, no confirmado por la clienta.';

alter table channels
  add column if not exists umbral_silencio_horas integer default 8;

alter table channels drop constraint if exists channels_umbral_silencio_horas_check;
alter table channels add constraint channels_umbral_silencio_horas_check
  check (umbral_silencio_horas is null or umbral_silencio_horas > 0);

comment on column channels.umbral_silencio_horas is
  'Límite de silencio en horas hábiles (F39). Nulo = el canal no se vigila.';
