-- ============================================================
-- 00052: RESPUESTAS RÁPIDAS (F36; ítem 6 del plan maestro, 06/11/2026)
-- ============================================================
-- La tabla `response_templates`, que no existía (verificado el 22/09/2026, F36
-- en el plano). En la interfaz se llaman «Respuestas rápidas», nunca
-- «plantillas»: las plantillas de WhatsApp son otra cosa (plan B).
--
-- Trae también el `deleted_at` de respuestas rápidas del criterio de F30, y
-- sigue el antecedente de la 00038 (decisión de la revisión del plan maestro):
--   - leer: cualquier miembro del espacio, solo las no eliminadas (el Member
--     las usa escribiendo «/» en la bandeja);
--   - crear y editar: solo Owner y Admin (§11.1: la sección es de managers);
--     con `deleted_at is null` en el `using` y el `with check`, nadie elimina
--     con un UPDATE directo;
--   - eliminar: solo `eliminar_respuesta_rapida`, que exige manager;
--   - sin política de DELETE: la API no borra. Borra solo la purga de F30
--     (`lib/purga.ts`, con la clave de servicio), a los 30 días.
--
-- No toca políticas de messages, conversations, contacts ni contact_channels.
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

create table if not exists public.response_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  atajo text not null check (atajo ~ '^[a-z0-9_-]{1,30}$'),
  contenido text not null check (char_length(btrim(contenido)) between 1 and 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists response_templates_atajo_unico
  on public.response_templates (workspace_id, atajo) where deleted_at is null;
create index if not exists response_templates_deleted_at_idx
  on public.response_templates (workspace_id, deleted_at);

alter table public.response_templates enable row level security;

drop policy if exists "response_templates: leer, miembros, no eliminadas" on public.response_templates;
create policy "response_templates: leer, miembros, no eliminadas"
  on public.response_templates for select to authenticated
  using (deleted_at is null and public.is_workspace_member(workspace_id));

drop policy if exists "response_templates: crear, solo manager" on public.response_templates;
create policy "response_templates: crear, solo manager"
  on public.response_templates for insert to authenticated
  with check (deleted_at is null and public.is_workspace_manager(workspace_id));

drop policy if exists "response_templates: editar, solo manager" on public.response_templates;
create policy "response_templates: editar, solo manager"
  on public.response_templates for update to authenticated
  using (deleted_at is null and public.is_workspace_manager(workspace_id))
  with check (deleted_at is null and public.is_workspace_manager(workspace_id));

drop trigger if exists set_updated_at on public.response_templates;
create trigger set_updated_at before update on public.response_templates
  for each row execute function public.update_updated_at();

-- Eliminar marca la fecha y no borra (F30). Solo Owner y Admin del espacio de
-- la fila; si no corresponde, o ya estaba eliminada, no hace nada y devuelve
-- false. El historial lo escribe la acción del servidor que la llama.
create or replace function public.eliminar_respuesta_rapida(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cambiadas integer;
begin
  update public.response_templates r
     set deleted_at = now()
   where r.id = p_id
     and r.deleted_at is null
     and public.is_workspace_manager(r.workspace_id);
  get diagnostics v_cambiadas = row_count;
  return v_cambiadas = 1;
end;
$$;

revoke all on function public.eliminar_respuesta_rapida(uuid) from public, anon;
grant execute on function public.eliminar_respuesta_rapida(uuid) to authenticated;

comment on table public.response_templates is
  'F36: Respuestas rápidas (nunca «plantillas»: esas son las de WhatsApp del plan B). Las lee cualquier miembro, sin las eliminadas; las crean y editan Owner y Admin; se eliminan con eliminar_respuesta_rapida (marca la fecha) y las borra la purga de F30 a los 30 días.';
