-- ============================================================
-- CONFIGURACIÓN Y ESTADO DE LAS INTEGRACIONES (F24)
-- ============================================================
-- Una fila por integración de cada workspace: los canales, el correo y los
-- proveedores de IA. La pantalla de `/settings/integrations` se arma leyendo
-- esta tabla, así que un canal agregado como fila aparece sin tocar código
-- (decidido el 22 de septiembre de 2026, ver el plano, §0).
--
-- QUÉ NO VA ACÁ: ninguna clave. Las claves viven en Vault, bajo el nombre que
-- el código deriva del proveedor. Esta tabla guarda solo lo que se puede
-- mostrar: el nombre, el estado, cuándo se verificó y el último error, y en
-- `config` datos no secretos como el modelo por defecto.
--
-- EL ESTADO, y por qué son cuatro y no dos. `sin_verificar` significa que no se
-- pudo preguntar (el proveedor no respondió, o respondió algo que no es un sí
-- ni un no), y nunca se muestra como `desconectado`: decir "desconectado"
-- cuando en realidad no sabemos es mentir con confianza. `sin_configurar` es
-- que falta la clave. Se detecta al abrir la pantalla y cuando una operación
-- real falla por credenciales o conexión; no hay tarea periódica, a propósito
-- (el motivo está en F24).
--
-- QUIÉN LA VE: solo Owner y Admin, en las cuatro operaciones. La pantalla es de
-- configuración, y el estado de una integración le dice a quien lo lea qué
-- claves hay cargadas. Realtime evalúa la misma política de SELECT, así que un
-- Member suscrito tampoco recibe los cambios; lo comprueba
-- `scripts/verify-integration-configs.mjs`, con canario.
--
-- Idempotente: `if not exists`, `drop ... if exists` y un bloque `do $$` con
-- check previo para la publicación de Realtime.
-- ============================================================

create table if not exists integration_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  tipo text not null check (tipo in ('canal', 'correo', 'ia')),
  proveedor text not null,
  nombre text not null,
  orden integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  estado text not null default 'sin_configurar' check (estado in ('conectado', 'desconectado', 'sin_verificar', 'sin_configurar')),
  verificado_el timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, proveedor)
);

create index if not exists integration_configs_workspace_idx on integration_configs (workspace_id, orden);

comment on table integration_configs is
  'Una fila por integración del workspace (F24). Sin claves: las claves van a Vault. La pantalla de integraciones se arma leyendo esta tabla.';
comment on column integration_configs.estado is
  'conectado, desconectado, sin_verificar (no se pudo preguntar; nunca se muestra como desconectado) o sin_configurar (falta la clave).';
comment on column integration_configs.config is
  'Datos no secretos de la integración, como el modelo por defecto. Nunca una clave.';
comment on column integration_configs.ultimo_error is
  'Motivo corto del último fallo, en lenguaje claro. Nunca una clave ni el cuerpo de una respuesta del proveedor.';

alter table integration_configs enable row level security;

drop policy if exists "integration_configs: managers leen" on integration_configs;
create policy "integration_configs: managers leen"
  on integration_configs for select to authenticated
  using (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers crean" on integration_configs;
create policy "integration_configs: managers crean"
  on integration_configs for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers modifican" on integration_configs;
create policy "integration_configs: managers modifican"
  on integration_configs for update to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers borran" on integration_configs;
create policy "integration_configs: managers borran"
  on integration_configs for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- Realtime: la pantalla abierta se entera de los cambios de estado sin
-- recargar. `alter publication ... add table` falla si la tabla ya está, así
-- que se pregunta antes. La 00001 lo hizo sin check para `conversations` y
-- `messages`; acá no, porque esta migración tiene que poder correr dos veces.
--
-- LÍMITE CONOCIDO, el mismo que documenta `verify-realtime-scope.mjs`: los
-- eventos de DELETE no los filtra la RLS y le llegan a todo suscriptor de la
-- tabla, con la clave primaria y sin contenido.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'integration_configs'
  ) then
    alter publication supabase_realtime add table integration_configs;
  end if;
end $$;
