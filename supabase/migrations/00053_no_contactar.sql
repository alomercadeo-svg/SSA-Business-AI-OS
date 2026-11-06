-- ============================================================
-- 00053: NO CONTACTAR (F34, y su parte de F31; ítem 8 del plan maestro, 06/11/2026)
-- ============================================================
-- Las columnas de la marca ya existen (00029: `do_not_contact`,
-- `do_not_contact_reason`, `do_not_contact_at`). Esta migración trae:
--
-- 1. `workspaces.frases_de_baja`: la lista configurable por espacio, cargada
--    con las del criterio. La detección (lib/no-contactar.ts) compara sin
--    mayúsculas, sin tildes y por palabras enteras.
-- 2. Dos acciones del historial: `contacto.no_contactar` (se marcó) y
--    `contacto.no_contactar_revertido` (se revirtió).
-- 3. Revertir la marca, solo Owner y Admin, EN LA BASE. La política de
--    edición de contactos (00038:62-66) deja que un Member edite los suyos,
--    y con eso podía poner `do_not_contact` en falso por la API. El
--    disparador lo corta con la sesión de un Member; la clave de servicio
--    (sin sesión, `auth.uid()` nulo) y los managers pasan. Marcar sí puede
--    cualquiera que edite el contacto: proteger nunca es un riesgo.
-- 4. Un contacto marcado nunca entra a una secuencia, EN LA BASE: las
--    inscripciones se crean en dos lugares (lib/actions/sequences.ts:112 y
--    lib/flow-engine/engine.ts:1050) y un tercero podría olvidarlo. El
--    disparador rechaza el alta y el paso a `active` de un marcado.
--
-- No toca políticas. Idempotente: `if not exists`, `drop ... if exists` y
-- `create or replace`.
-- ============================================================

alter table public.workspaces
  add column if not exists frases_de_baja text[] not null default array[
    'no me escribas más',
    'dejá de mandar mensajes',
    'no quiero recibir mensajes',
    'stop',
    'unsubscribe',
    'basta',
    'no me contactes'
  ]::text[];

comment on column public.workspaces.frases_de_baja is
  'F34: frases que, en un mensaje del lead, marcan el contacto como no contactar. Se comparan sin mayúsculas, sin tildes y por palabras enteras (lib/no-contactar.ts).';

alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log add constraint audit_log_action_check check (action in (
  'contacto.creado',
  'contacto.editado',
  'contacto.reconciliado',
  'contacto.fusionado',
  'contacto.asignado',
  'contacto.eliminado',
  'contacto.restaurado',
  'contacto.vinculado',
  'contacto.no_contactar',
  'contacto.no_contactar_revertido',
  'canal.conectado',
  'canal.desconectado',
  'canal.error',
  'canal.reemplazado',
  'canal.ranura_actualizada',
  'configuracion.cambiada',
  'equipo.invitado',
  'equipo.invitacion_revocada',
  'equipo.ingreso',
  'equipo.rol_cambiado',
  'equipo.removido'
));

create or replace function public.proteger_no_contactar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.do_not_contact
     and not new.do_not_contact
     and (select auth.uid()) is not null
     and not public.is_workspace_manager(old.workspace_id) then
    raise exception 'Solo Owner y Admin pueden revertir la marca de no contactar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.proteger_no_contactar() is
  'F34: con la sesión de un usuario, solo Owner y Admin revierten la marca de no contactar. La clave de servicio pasa (auth.uid() nulo).';

drop trigger if exists contacts_proteger_no_contactar on public.contacts;
create trigger contacts_proteger_no_contactar
  before update of do_not_contact on public.contacts
  for each row execute function public.proteger_no_contactar();

create or replace function public.sin_secuencia_si_no_contactar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.do_not_contact
  ) then
    raise exception 'El contacto pidió no recibir mensajes: no entra a una secuencia.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.sin_secuencia_si_no_contactar() is
  'F34: un contacto marcado como no contactar nunca entra a una secuencia (ni alta ni vuelta a activa). Definer para leer la marca aunque quien inscribe no vea el contacto: con invoker, la política de contactos le escondería la marca y la regla se saltearía. Devuelve trigger: no se puede llamar como RPC.';

drop trigger if exists sequence_enrollments_sin_no_contactar on public.sequence_enrollments;
create trigger sequence_enrollments_sin_no_contactar
  before insert or update of status on public.sequence_enrollments
  for each row execute function public.sin_secuencia_si_no_contactar();
