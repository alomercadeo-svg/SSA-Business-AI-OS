-- ============================================================
-- HISTORIAL DE AUDITORÍA (F31)
-- ============================================================
-- Quién hizo qué y cuándo. Una fila por evento: contacto creado, editado o
-- reconciliado; canal conectado, desconectado, con error o reemplazado; cambios
-- de configuración; movimientos de equipo. Es lo que lee la pestaña «Historial
-- de cambios» de Configuración (§11).
--
-- NUNCA SE ELIMINA, Y LO HACE CUMPLIR LA BASE. No hay policies de escritura
-- para usuarios, y un trigger rechaza UPDATE, DELETE y TRUNCATE para todos,
-- incluida la clave de servicio. Tampoco tiene borrado suave: no hay
-- `deleted_at`. La purga a 30 días del borrado suave de F30 no la toca.
--
-- SIN CLAVES FORÁNEAS, A PROPÓSITO. `workspace_id`, `actor_id` y `entity_id`
-- son identificadores sueltos. Con una clave foránea, borrar un contacto (la
-- purga de F30, la limpieza de los verificadores) o fallaría o se llevaría su
-- historial en cascada, y las dos cosas contradicen "nunca se elimina". Por lo
-- mismo, el nombre de quien actuó y el de la entidad se guardan como texto en
-- el momento (`actor_label`, `entity_label`): sobreviven aunque el usuario o el
-- contacto dejen de existir.
--
-- QUIÉN ESCRIBE. Solo el servidor, con la clave de servicio: `lib/auditoria.ts`
-- y las funciones SQL que hacen el cambio y su registro en una sola operación
-- (la reconciliación y la fusión de F26). Se decidió escribir desde el código y
-- no con triggers sobre cada tabla porque los verificadores escriben directo
-- contra la base real, y con triggers cada corrida dejaría en el espacio real,
-- para siempre, filas de contactos y miembros de prueba.
--
-- QUIÉN LEE. Owner y Admin, todo su espacio. Un Member, solo las filas donde
-- él es el actor (criterio de F31).
--
-- LA LISTA DE ACCIONES ES CERRADA. Un evento nuevo necesita esta migración o
-- una posterior que reemplace el `check`, no solo código. Las que faltan las
-- suma cada funcionalidad: eliminado y restaurado (F30), asignado (F41), no
-- contactar (F34), importaciones (F37).
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  actor_id uuid,
  actor_label text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  changes jsonb not null default '{}',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log add constraint audit_log_action_check check (action in (
  'contacto.creado',
  'contacto.editado',
  'contacto.reconciliado',
  'contacto.fusionado',
  'canal.conectado',
  'canal.desconectado',
  'canal.error',
  'canal.reemplazado',
  'configuracion.cambiada',
  'equipo.invitado',
  'equipo.invitacion_revocada',
  'equipo.ingreso',
  'equipo.rol_cambiado',
  'equipo.removido'
));

alter table audit_log drop constraint if exists audit_log_entity_type_check;
alter table audit_log add constraint audit_log_entity_type_check check (entity_type in (
  'contacto', 'canal', 'espacio', 'integracion', 'miembro', 'invitacion'
));

create index if not exists audit_log_workspace_idx on audit_log (workspace_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);
create index if not exists audit_log_created_idx on audit_log (created_at);
-- Para la lectura del Member, que filtra por actor.
create index if not exists audit_log_actor_idx on audit_log (actor_id, created_at desc);

comment on table audit_log is
  'Historial de auditoría (F31). Nunca se elimina: un trigger rechaza UPDATE, DELETE y TRUNCATE. Sin claves foráneas a propósito.';
comment on column audit_log.actor_id is
  'Quién actuó. Nulo es el Sistema: un webhook, la sincronización, una tarea automática.';
comment on column audit_log.changes is
  'Campo → {antes, despues}. Nunca el valor de una clave ni de un secreto: para eso, solo "guardada" o "borrada".';

-- ── Inmutable ────────────────────────────────────────────────────────────
create or replace function public.audit_log_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log no se modifica ni se borra (F31): % rechazado', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_sin_cambios on audit_log;
create trigger audit_log_sin_cambios
  before update or delete on audit_log
  for each row execute function public.audit_log_inmutable();

drop trigger if exists audit_log_sin_truncate on audit_log;
create trigger audit_log_sin_truncate
  before truncate on audit_log
  for each statement execute function public.audit_log_inmutable();

-- ── Quién lee ────────────────────────────────────────────────────────────
alter table audit_log enable row level security;

drop policy if exists "audit_log: managers leen todo, members lo propio" on audit_log;
create policy "audit_log: managers leen todo, members lo propio"
  on audit_log for select to authenticated
  using (
    public.is_workspace_manager(workspace_id)
    or (actor_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

revoke insert, update, delete, truncate on audit_log from anon, authenticated;
