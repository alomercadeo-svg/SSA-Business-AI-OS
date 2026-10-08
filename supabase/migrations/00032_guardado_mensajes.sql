-- ============================================================
-- GUARDADO DE MENSAJES ENTRANTES (F27)
-- ============================================================
-- Desde F27 la base es la fuente de verdad de la bandeja: lo que no esté en
-- `messages` no se ve. Esta migración prepara el lugar. Cinco cosas:
--
-- 1. LA UNICIDAD DE UN MENSAJE: conversación + identificador del proveedor +
--    dirección. El identificador solo no alcanza: en WhatsApp lo genera el
--    teléfono que envía y es único por conversación, no en todo el sistema.
--    La conversación es el chat, y no `remote_jid`, porque el mismo chat
--    puede llegar como `@lid` o como teléfono. Y es una RESTRICCIÓN normal,
--    no un índice parcial: PostgREST hace el upsert con `on_conflict`, que
--    solo encuentra restricciones, y Postgres no infiere un índice parcial sin
--    su predicado (probado el 08/10/2026 contra la base, con tablas
--    temporales: el parcial da 42P10). Los nulos no chocan entre sí, así que
--    los envíos fallidos sin identificador no se pisan.
--
-- 2. LO QUE §7.1 PIDE DE CADA MENSAJE: el tipo, el mensaje citado (aunque
--    todavía no exista de nuestro lado) y el estado del adjunto (F28). La
--    dirección ya existe desde el fork (`direction`): no se agrega `from_me`,
--    que podría contradecirla.
--
-- 3. EL PERFIL DEL REMITENTE (relleno de F27): `profile_status` y
--    `profile_attempts`, con techo de 3 intentos. Y `raw_jid` pasa a NOT NULL,
--    como anunció la 00031: los dos caminos que crean `contact_channels`
--    (`lib/inbox-sync.ts` y `lib/comment-processor.ts`) ya lo escriben en
--    producción. Si quedara alguna fila nula, la migración corta con error en
--    vez de inventar un valor.
--
-- 4. QUÉ HILOS ESTÁN COMPLETOS: `conversations.historial_estado`. La
--    importación del historial marca `completo` recién con la última página;
--    un corte a la mitad deja `pendiente`, y volver a sincronizar retoma solo
--    esas. Sin esta marca, la unicidad evita duplicados pero no dice qué hilo
--    quedó a medio traer.
--
-- 5. LAS MARCAS: `channels.last_inbound_at`, el último entrante por canal (lo
--    vigila F39), y `tareas_estado`, una fila por tarea del servidor: la
--    importación la usa para no correr dos veces a la vez, F39 para su marca
--    de última ejecución, y la purga de F30 para la suya. Solo la lee y la
--    escribe el servidor.
--
-- Idempotente: `if not exists`, `drop ... if exists` antes de cada `check` y
-- restricción, y `create or replace`.
-- ============================================================


-- ── 1. Unicidad de un mensaje ────────────────────────────────────────────

alter table messages drop constraint if exists messages_mensaje_unico;
alter table messages
  add constraint messages_mensaje_unico unique (conversation_id, platform_message_id, direction);


-- ── 2. Tipo, citado y adjunto ────────────────────────────────────────────

alter table messages
  add column if not exists message_type text,
  add column if not exists quoted_message_id text,
  add column if not exists media_path text,
  add column if not exists media_status text;

alter table messages drop constraint if exists messages_message_type_check;
alter table messages add constraint messages_message_type_check check (
  message_type is null or message_type in
    ('texto', 'imagen', 'audio', 'documento', 'video', 'sticker', 'ubicacion', 'otro')
);

alter table messages drop constraint if exists messages_media_status_check;
alter table messages add constraint messages_media_status_check check (
  media_status is null or media_status in ('pendiente', 'descargado', 'fallido', 'no_disponible')
);

comment on column messages.message_type is
  'Tipo del mensaje (F27). Nulo en los que escribía el fork antes de F27.';
comment on column messages.quoted_message_id is
  'Identificador del proveedor del mensaje citado. Puede no existir todavía de nuestro lado (F27).';
comment on column messages.media_status is
  'Estado del adjunto (F28). Nulo = el mensaje no tiene adjunto.';


-- ── 3. Perfil del remitente y raw_jid obligatorio ────────────────────────

alter table contact_channels
  add column if not exists profile_status text not null default 'pending',
  add column if not exists profile_attempts smallint not null default 0;

alter table contact_channels drop constraint if exists contact_channels_profile_status_check;
alter table contact_channels add constraint contact_channels_profile_status_check
  check (profile_status in ('pending', 'complete', 'unavailable'));

do $$
declare
  nulos integer;
begin
  select count(*) into nulos from contact_channels where raw_jid is null;
  if nulos > 0 then
    raise exception 'contact_channels tiene % filas con raw_jid nulo: no se pone NOT NULL inventando un valor', nulos;
  end if;
end $$;

alter table contact_channels alter column raw_jid set not null;


-- ── 4. Qué hilos están completos ─────────────────────────────────────────

alter table conversations
  add column if not exists historial_estado text not null default 'pendiente',
  add column if not exists historial_importado_at timestamptz;

alter table conversations drop constraint if exists conversations_historial_estado_check;
alter table conversations add constraint conversations_historial_estado_check
  check (historial_estado in ('pendiente', 'completo', 'incompleto', 'no_disponible'));

comment on column conversations.historial_estado is
  'Si el historial del proveedor ya está entero en la base (F27). completo solo con la última página.';


-- ── 5. Marcas ────────────────────────────────────────────────────────────

alter table channels add column if not exists last_inbound_at timestamptz;

comment on column channels.last_inbound_at is
  'Último mensaje entrante recibido por el receptor (F27). Lo vigila F39.';

create table if not exists tareas_estado (
  clave text primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  ultima_ejecucion_at timestamptz,
  ultimo_ok_at timestamptz,
  ocupada_hasta timestamptz,
  resultado jsonb not null default '{}'::jsonb,
  ultimo_error text,
  updated_at timestamptz not null default now()
);

-- RLS sin políticas: solo la clave de servicio. Las pantallas la leen en el
-- servidor, después de comprobar el rol.
alter table tareas_estado enable row level security;

-- Toma la tarea si nadie la tiene, o si quien la tenía se pasó de su plazo
-- (un redespliegue corta un `after()` sin liberar). Devuelve true si la tomó.
create or replace function public.reservar_tarea(p_clave text, p_workspace_id uuid, p_minutos integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tomada boolean;
begin
  insert into tareas_estado (clave, workspace_id, ocupada_hasta, ultima_ejecucion_at, updated_at)
  values (p_clave, p_workspace_id, now() + make_interval(mins => p_minutos), now(), now())
  on conflict (clave) do update
    set ocupada_hasta = excluded.ocupada_hasta,
        ultima_ejecucion_at = excluded.ultima_ejecucion_at,
        updated_at = now()
    where tareas_estado.ocupada_hasta is null or tareas_estado.ocupada_hasta < now()
  returning true into tomada;
  return coalesce(tomada, false);
end;
$$;

revoke all on function public.reservar_tarea(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reservar_tarea(text, uuid, integer) to service_role;
