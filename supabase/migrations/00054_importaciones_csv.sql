-- ============================================================
-- 00054: IMPORTACIONES DE PLANILLA (F37, parte 1; ítem 11 del plan maestro, 09/11/2026)
-- ============================================================
-- La tabla `csv_imports` (§ modelo de datos: «Registro de cada importación de
-- planilla») y la acción `importacion.completada` en el historial (F31).
--
-- Quién escribe: SOLO el servidor, con la clave de servicio, después de
-- comprobar que quien importa es Owner o Admin (esta noche importar es solo de
-- managers, decidido por Marcos el 09/11/2026). Por eso la tabla no tiene
-- políticas de escritura: ninguna sesión de usuario inserta, cambia ni borra.
-- Leer: Owner y Admin, todas las del espacio; cualquier otro miembro, solo
-- las suyas (para cuando el Member importe, después de la entrega).
--
-- Idempotente: se puede correr dos veces sin error ni cambios.

create table if not exists public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  nombre_archivo text,
  filas integer not null default 0,
  creados integer not null default 0,
  actualizados integer not null default 0,
  con_error integer not null default 0,
  estado text not null default 'en_curso',
  created_at timestamptz not null default now(),
  terminada_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.csv_imports'::regclass and conname = 'csv_imports_estado_check'
  ) then
    alter table public.csv_imports
      add constraint csv_imports_estado_check check (estado in ('en_curso', 'terminada', 'fallida'));
  end if;
end $$;

create index if not exists idx_csv_imports_workspace on public.csv_imports (workspace_id, created_at desc);

alter table public.csv_imports enable row level security;

drop policy if exists "csv_imports: leer, managers todas y cada uno las suyas" on public.csv_imports;
create policy "csv_imports: leer, managers todas y cada uno las suyas"
  on public.csv_imports for select to authenticated
  using (
    public.is_workspace_manager(workspace_id)
    or (created_by = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

comment on table public.csv_imports is
  'F37: una fila por importación de planilla. La escribe solo el servidor (clave de servicio) después de comprobar el rol; sin políticas de escritura. La leen Owner y Admin, y cada uno las suyas.';

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
  'equipo.removido',
  'importacion.completada'
));

alter table audit_log drop constraint if exists audit_log_entity_type_check;
alter table audit_log add constraint audit_log_entity_type_check check (entity_type in (
  'contacto',
  'canal',
  'espacio',
  'integracion',
  'miembro',
  'invitacion',
  'importacion'
));
