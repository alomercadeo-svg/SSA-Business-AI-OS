-- ============================================================
-- BORRADO SUAVE DE CONTACTOS Y CONVERSACIONES (F30)
-- ============================================================
-- F30: «Campo `deleted_at` en contactos, notas, conversaciones y respuestas
-- rápidas. Eliminar marca la fecha, no borra» y «Los listados y las reglas de
-- seguridad excluyen lo eliminado». `contacts.deleted_at` existe desde la
-- 00029 y `contact_notes.deleted_at` desde la 00037; esta suma el de
-- `conversations`. Respuestas rápidas no existe hasta F36, que lo trae.
--
-- QUÉ EXCLUYE LO ELIMINADO. Las políticas de lectura y de edición de
-- `contacts` y `conversations` (las de la 00019, leídas en producción el
-- 20/10/2026 sin cambios) suman `deleted_at is null`. Lo demás cae solo,
-- porque sus políticas pasan por esas dos tablas y la seguridad por filas se
-- aplica también adentro de esas subconsultas: mensajes (por la
-- conversación), canales del contacto, etiquetas, campos propios y notas (por
-- el contacto).
--
-- QUIÉN ELIMINA Y RESTAURA (decisión de Marcos del 20/10/2026, el permiso de
-- borrado de la 00019 llevado al borrado suave): solo Owner y Admin, aplicado
-- en la base. Con `deleted_at is null` en el `using` y el `with check` de la
-- edición, nadie cambia `deleted_at` con un UPDATE directo: un Member que pone
-- la fecha choca con el `with check`, y uno que intenta restaurar no ve la
-- fila. Eliminar y restaurar pasan solo por `eliminar_contacto` y
-- `restaurar_contacto`, que exigen `is_workspace_manager`.
--
-- «ELIMINAR MARCA LA FECHA, NO BORRA», también para Owner y Admin (pedido de
-- Marcos del 20/10/2026, el mismo principio llevado al DELETE): la 00019 les
-- deja borrar de verdad contactos y conversaciones con su token
-- («... borrar solo manager»), sin `deleted_at`, sin los 30 días y sin
-- historial. Esta migración saca esas dos políticas y no pone otras: con la
-- seguridad por filas activa y sin política de DELETE, la API no borra. Borra
-- solo la clave de servicio (la purga de F30). `fusionar_contactos` no se
-- afecta: es `security definer` y su dueño, `postgres`, es el dueño de las
-- tablas, que no fuerzan la seguridad por filas (leído en el catálogo de
-- producción el 20/10/2026).
--
-- La clave de servicio no pasa por la seguridad por filas: el receptor restaura con
-- `restaurar_contacto` al lead eliminado que vuelve a escribir (decisión de
-- Marcos del 19/10/2026), con el Sistema como autor.
--
-- «Eliminados» (§11): `contactos_eliminados` devuelve los eliminados del
-- espacio que quien llama puede ver por su alcance (`can_see_contact`), así
-- que un Member ve solo los suyos. Lo garantiza la base.
--
-- El historial: «contacto.eliminado» y «contacto.restaurado» se suman a la
-- lista cerrada de `audit_log` (como la 00036). Las dos funciones escriben su
-- fila; «contacto.editado» ya estaba.
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

-- ── 1. La columna ────────────────────────────────────────────────────────
alter table conversations add column if not exists deleted_at timestamptz;
create index if not exists conversations_deleted_at_idx on conversations (deleted_at);

-- ── 2. Las políticas: las de la 00019 más «no eliminado» ─────────────────
drop policy if exists "contacts: leer solo los leads dentro del scope" on contacts;
create policy "contacts: leer solo los leads dentro del scope"
  on contacts for select to authenticated
  using (deleted_at is null and public.can_see_contact(workspace_id, setter_id, vendedor_id));

drop policy if exists "contacts: editar solo los leads dentro del scope" on contacts;
create policy "contacts: editar solo los leads dentro del scope"
  on contacts for update to authenticated
  using (deleted_at is null and public.can_see_contact(workspace_id, setter_id, vendedor_id))
  with check (deleted_at is null and public.can_see_contact(workspace_id, setter_id, vendedor_id));

drop policy if exists "conversations: leer solo las del scope" on conversations;
create policy "conversations: leer solo las del scope"
  on conversations for select to authenticated
  using (deleted_at is null and public.can_see_conversation(workspace_id, assigned_to, contact_id));

drop policy if exists "conversations: editar solo las del scope" on conversations;
create policy "conversations: editar solo las del scope"
  on conversations for update to authenticated
  using (deleted_at is null and public.can_see_conversation(workspace_id, assigned_to, contact_id))
  with check (deleted_at is null and public.can_see_conversation(workspace_id, assigned_to, contact_id));

-- Nadie borra de verdad desde la API: ni Owner ni Admin. Eliminar es
-- `eliminar_contacto`; borrar definitivamente, solo la purga (clave de servicio).
drop policy if exists "contacts: borrar solo manager" on contacts;
drop policy if exists "conversations: borrar solo manager" on conversations;

-- Nadie crea algo ya eliminado (revisión del 20/10/2026): sin esto, un Member
-- podía dar de alta un contacto suyo con `deleted_at` puesto, que aparecía en
-- «Eliminados» sin fila de «eliminado» en el historial. Las mismas reglas de la
-- 00019, más `deleted_at is null`.
drop policy if exists "contacts: crear, un Member solo asignado a si mismo" on contacts;
create policy "contacts: crear, un Member solo asignado a si mismo"
  on contacts for insert to authenticated
  with check (
    deleted_at is null
    and public.is_workspace_member(workspace_id)
    and (
      public.is_workspace_manager(workspace_id)
      or setter_id = (select auth.uid())
      or vendedor_id = (select auth.uid())
    )
  );

drop policy if exists "conversations: crear solo manager" on conversations;
create policy "conversations: crear solo manager"
  on conversations for insert to authenticated
  with check (deleted_at is null and public.is_workspace_manager(workspace_id));

-- La fecha de edición de una nota (00037) la pone siempre el trigger
-- (revisión del 20/10/2026): antes, el autor podía mandar un `updated_at`
-- cualquiera sin tocar el texto. Es la función de la 00037 con esa línea.
create or replace function public.contact_notes_antes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.author_id := auth.uid();
      new.author_label := coalesce(public.etiqueta_propia(), 'Usuario');
    else
      new.author_label := coalesce(new.author_label, 'Sistema');
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if current_user = 'authenticated' then
    if new.contact_id is distinct from old.contact_id
       or new.workspace_id is distinct from old.workspace_id
       or new.author_id is distinct from old.author_id
       or new.author_label is distinct from old.author_label
       or new.created_at is distinct from old.created_at then
      raise exception 'contact_notes: solo se edita el texto de la nota' using errcode = '42501';
    end if;
  end if;
  new.updated_at := case when new.body is distinct from old.body then now() else old.updated_at end;
  return new;
end;
$$;

-- ── 3. El historial ──────────────────────────────────────────────────────
alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log add constraint audit_log_action_check check (action in (
  'contacto.creado',
  'contacto.editado',
  'contacto.reconciliado',
  'contacto.fusionado',
  'contacto.asignado',
  'contacto.eliminado',
  'contacto.restaurado',
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

-- ── 4. Eliminar ──────────────────────────────────────────────────────────
-- Marca el contacto y sus conversaciones con la misma fecha: así restaurar
-- devuelve exactamente las que se fueron con él.
create or replace function public.eliminar_contacto(p_contacto uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contacts%rowtype;
  v_uid uuid := auth.uid();
  v_ahora timestamptz := now();
  v_convs int;
begin
  select * into v_c from public.contacts where id = p_contacto and deleted_at is null for update;
  if v_c.id is null then
    raise exception 'eliminar_contacto: el contacto no existe' using errcode = 'P0002';
  end if;
  if not public.is_workspace_manager(v_c.workspace_id) then
    raise exception 'eliminar_contacto: solo Owner y Admin' using errcode = '42501';
  end if;

  update public.contacts set deleted_at = v_ahora where id = v_c.id;
  update public.conversations set deleted_at = v_ahora
    where contact_id = v_c.id and deleted_at is null;
  get diagnostics v_convs = row_count;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id, v_uid, coalesce(public.etiqueta_de_actor(v_uid), 'Usuario'),
    'contacto.eliminado', 'contacto', v_c.id, v_c.display_name,
    jsonb_build_object('deleted_at', jsonb_build_object('antes', null, 'despues', v_ahora)),
    jsonb_build_object('conversaciones', v_convs)
  );

  return jsonb_build_object('resultado', 'eliminado', 'deleted_at', v_ahora, 'conversaciones', v_convs);
end;
$$;

revoke all on function public.eliminar_contacto(uuid) from public, anon;
grant execute on function public.eliminar_contacto(uuid) to authenticated, service_role;

-- ── 5. Restaurar ─────────────────────────────────────────────────────────
-- `p_via`: `manual` (Owner o Admin, desde «Eliminados»), `mensaje_entrante`
-- (el lead eliminado que vuelve a escribir) o `mensaje_saliente` (el negocio le
-- escribe desde la app de Instagram o desde el teléfono; decisión de Marcos del
-- 20/10/2026). Las dos automáticas son solo del servidor, con el Sistema de
-- autor y el canal en el detalle.
create or replace function public.restaurar_contacto(
  p_contacto uuid,
  p_via text default 'manual',
  p_canal uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contacts%rowtype;
  v_uid uuid := auth.uid();
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_convs int;
begin
  if p_via not in ('manual', 'mensaje_entrante', 'mensaje_saliente') then
    raise exception 'restaurar_contacto: vía desconocida %', p_via using errcode = '22023';
  end if;
  if p_via in ('mensaje_entrante', 'mensaje_saliente') and not v_servidor then
    raise exception 'restaurar_contacto: la vía automática es solo del servidor' using errcode = '42501';
  end if;
  select * into v_c from public.contacts where id = p_contacto and deleted_at is not null for update;
  if v_c.id is null then
    raise exception 'restaurar_contacto: no hay un contacto eliminado con ese id' using errcode = 'P0002';
  end if;
  if not v_servidor and not public.is_workspace_manager(v_c.workspace_id) then
    raise exception 'restaurar_contacto: solo Owner y Admin' using errcode = '42501';
  end if;

  update public.conversations set deleted_at = null
    where contact_id = v_c.id and deleted_at = v_c.deleted_at;
  get diagnostics v_convs = row_count;
  update public.contacts set deleted_at = null where id = v_c.id;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id,
    case when v_servidor then null else v_uid end,
    case when v_servidor then 'Sistema' else coalesce(public.etiqueta_de_actor(v_uid), 'Usuario') end,
    'contacto.restaurado', 'contacto', v_c.id, v_c.display_name,
    jsonb_build_object('deleted_at', jsonb_build_object('antes', v_c.deleted_at, 'despues', null)),
    jsonb_strip_nulls(jsonb_build_object('via', p_via, 'canal_id', p_canal, 'conversaciones', v_convs))
  );

  return jsonb_build_object('resultado', 'restaurado', 'conversaciones', v_convs);
end;
$$;

revoke all on function public.restaurar_contacto(uuid, text, uuid) from public, anon;
grant execute on function public.restaurar_contacto(uuid, text, uuid) to authenticated, service_role;

-- ── 6. «Eliminados» ──────────────────────────────────────────────────────
create or replace function public.contactos_eliminados(p_workspace uuid)
returns table (id uuid, display_name text, deleted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.display_name, c.deleted_at
  from public.contacts c
  where c.workspace_id = p_workspace
    and c.deleted_at is not null
    and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
  order by c.deleted_at desc;
$$;

revoke all on function public.contactos_eliminados(uuid) from public, anon;
grant execute on function public.contactos_eliminados(uuid) to authenticated;
