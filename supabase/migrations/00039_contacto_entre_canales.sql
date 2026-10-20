-- ============================================================
-- DETECCIÓN DE CONTACTO ENTRE CANALES (F29)
-- ============================================================
-- F29: al llegar un mensaje de un canal nuevo se busca el contacto por
-- teléfono normalizado a E.164, correo o nombre de usuario (§14). Coincidencia
-- exacta de teléfono o correo vincula sola; solo por nombre de usuario,
-- sugiere al operador. Las vinculaciones quedan en el historial.
--
-- 1. `buscar_contacto_entre_canales`: la búsqueda, en la base, para que el
--    receptor y el verificador usen exactamente la misma. Solo contactos vivos
--    (`deleted_at is null`) del mismo espacio, y solo si la coincidencia es
--    única: dos contactos con el mismo teléfono no se eligen a ciegas.
-- 2. `sugerencias_union`: lo que se le propone al operador («¿Es la misma
--    persona?», §11, panel del contacto de la bandeja), con su motivo: el
--    usuario, o el teléfono cuando `reconciliar_telefono` devuelve conflicto en
--    el camino automático (F26 lo deja escrito como de F29). «No es la misma»
--    la descarta y no se vuelve a sugerir (única por par).
-- 3. «contacto.vinculado» en la lista cerrada de `audit_log` (como la 00036).
--    La vinculación manual es la fusión, que ya escribe «contacto.fusionado».
-- 4. `fusionar_contactos`: la tabla nueva tiene clave hacia `contacts`, y la
--    guarda de la fusión corta si queda una fila del absorbido. Se reescribe
--    entera con UNA línea nueva, que borra las sugerencias del absorbido (la
--    unión ya queda en el historial como «contactos unidos»). Lo demás es copia
--    textual de la 00037.
--
-- Revisión y respuestas de Marcos del 20/10/2026: el teléfono se busca
-- también en `whatsapp_phone` y el correo también en `secondary_email`; un
-- lead eliminado (dentro de los 30 días) que escribe por otro canal se
-- encuentra igual y se restaura; y un par se sugiere una sola vez en cualquier
-- orden (índice único sobre el par sin orden).
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

-- ── 1. La búsqueda ───────────────────────────────────────────────────────
create or replace function public.buscar_contacto_entre_canales(
  p_workspace uuid,
  p_telefono text default null,
  p_correo text default null,
  p_usuario text default null,
  p_canal uuid default null,
  p_excluir uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_vivo boolean;
begin
  -- Teléfono y correo, exactos y de un solo contacto. Primero entre los vivos;
  -- si no hay ninguno, entre los eliminados (dentro de los 30 días: los
  -- purgados ya no existen), y entonces la respuesta lo marca para que el
  -- receptor lo restaure antes de vincular (respuesta de Marcos del
  -- 20/10/2026). Si hay más de un vivo, no se elige: null.
  foreach v_vivo in array array[true, false] loop
    if p_telefono is not null then
      select array_agg(id) into v_ids from (
        select id from public.contacts
        where workspace_id = p_workspace
          and (phone = p_telefono or whatsapp_phone = p_telefono)
          and (deleted_at is null) = v_vivo
          and id is distinct from p_excluir
        limit 2
      ) t;
      if coalesce(array_length(v_ids, 1), 0) = 1 then
        return jsonb_build_object('tipo', 'exacto', 'por', 'telefono', 'contact_id', v_ids[1])
          || case when v_vivo then '{}'::jsonb else jsonb_build_object('eliminado', true) end;
      end if;
      if v_vivo and coalesce(array_length(v_ids, 1), 0) > 1 then
        return null;
      end if;
    end if;

    if p_correo is not null and btrim(p_correo) <> '' then
      select array_agg(id) into v_ids from (
        select id from public.contacts
        where workspace_id = p_workspace
          and (lower(email) = lower(btrim(p_correo)) or lower(secondary_email) = lower(btrim(p_correo)))
          and (deleted_at is null) = v_vivo
          and id is distinct from p_excluir
        limit 2
      ) t;
      if coalesce(array_length(v_ids, 1), 0) = 1 then
        return jsonb_build_object('tipo', 'exacto', 'por', 'correo', 'contact_id', v_ids[1])
          || case when v_vivo then '{}'::jsonb else jsonb_build_object('eliminado', true) end;
      end if;
      if v_vivo and coalesce(array_length(v_ids, 1), 0) > 1 then
        return null;
      end if;
    end if;
  end loop;

  -- El usuario solo sugiere, y solo entre los vivos.
  if p_usuario is not null and btrim(p_usuario) <> '' then
    select array_agg(contact_id) into v_ids from (
      select distinct cc.contact_id
      from public.contact_channels cc
      join public.contacts c on c.id = cc.contact_id
      where c.workspace_id = p_workspace and c.deleted_at is null
        and lower(cc.platform_username) = lower(ltrim(btrim(p_usuario), '@'))
        and cc.channel_id is distinct from p_canal
        and cc.contact_id is distinct from p_excluir
      limit 2
    ) t;
    if coalesce(array_length(v_ids, 1), 0) = 1 then
      return jsonb_build_object('tipo', 'sugerencia', 'por', 'usuario', 'contact_id', v_ids[1]);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.buscar_contacto_entre_canales(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.buscar_contacto_entre_canales(uuid, text, text, text, uuid, uuid) to service_role;

-- ── 2. Las sugerencias ───────────────────────────────────────────────────
create table if not exists sugerencias_union (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- El contacto nuevo (el que llegó) y el que ya estaba.
  contacto_id uuid not null references contacts(id) on delete cascade,
  otro_id uuid not null references contacts(id) on delete cascade,
  motivo text not null check (motivo in ('usuario', 'telefono')),
  detalle jsonb not null default '{}',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'descartada')),
  created_at timestamptz not null default now(),
  resuelta_por uuid references auth.users(id) on delete set null,
  resuelta_at timestamptz,
  constraint sugerencias_union_par_unico unique (contacto_id, otro_id),
  constraint sugerencias_union_distintos check (contacto_id <> otro_id)
);

-- Un par, una sola vez, en cualquier orden: (A,B) y (B,A) son la misma sugerencia.
create unique index if not exists sugerencias_union_par_sin_orden
  on sugerencias_union (least(contacto_id, otro_id), greatest(contacto_id, otro_id));
create index if not exists sugerencias_union_otro_idx on sugerencias_union (otro_id);
create index if not exists sugerencias_union_workspace_idx on sugerencias_union (workspace_id, estado);

alter table sugerencias_union enable row level security;

-- Se lee si quien mira ve los DOS contactos: la seguridad por filas de
-- `contacts` se aplica adentro de la subconsulta, así que un Member no se
-- entera de un contacto ajeno, y ninguno eliminado aparece (00038).
drop policy if exists "sugerencias_union: leer si se ven los dos" on sugerencias_union;
create policy "sugerencias_union: leer si se ven los dos"
  on sugerencias_union for select to authenticated
  using (
    exists (select 1 from public.contacts c where c.id = sugerencias_union.contacto_id)
    and exists (select 1 from public.contacts c where c.id = sugerencias_union.otro_id)
  );

-- Sin políticas de escritura: las crea el receptor (clave de servicio) y las
-- descarta `descartar_sugerencia`.
revoke insert, update, delete, truncate on sugerencias_union from anon, authenticated;

-- «No es la misma»: quien ve los dos la descarta, y no se vuelve a sugerir.
create or replace function public.descartar_sugerencia(p_sugerencia uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sugerencias_union%rowtype;
  v_a public.contacts%rowtype;
  v_b public.contacts%rowtype;
begin
  select * into v_s from public.sugerencias_union where id = p_sugerencia and estado = 'pendiente' for update;
  if v_s.id is null then
    raise exception 'descartar_sugerencia: no hay una sugerencia pendiente con ese id' using errcode = 'P0002';
  end if;
  select * into v_a from public.contacts where id = v_s.contacto_id and deleted_at is null;
  select * into v_b from public.contacts where id = v_s.otro_id and deleted_at is null;
  if v_a.id is null or v_b.id is null
     or not public.can_see_contact(v_a.workspace_id, v_a.setter_id, v_a.vendedor_id)
     or not public.can_see_contact(v_b.workspace_id, v_b.setter_id, v_b.vendedor_id) then
    raise exception 'descartar_sugerencia: no hay una sugerencia pendiente con ese id' using errcode = 'P0002';
  end if;
  update public.sugerencias_union
    set estado = 'descartada', resuelta_por = auth.uid(), resuelta_at = now()
    where id = v_s.id;
end;
$$;

revoke all on function public.descartar_sugerencia(uuid) from public, anon;
grant execute on function public.descartar_sugerencia(uuid) to authenticated;

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
  'contacto.vinculado',
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

-- ── 4. La fusión conoce las sugerencias ──────────────────────────────────
create or replace function public.fusionar_contactos(
  p_conservar uuid,
  p_absorber uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contacts%rowtype;
  v_a public.contacts%rowtype;
  v_uid uuid := auth.uid();
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_conv record;
  v_destino uuid;
  v_movidas uuid[] := '{}';
  v_unidas uuid[] := '{}';
  v_foto jsonb;
  v_fc jsonb;
  v_lc jsonb;
  r record;
  v_quedan bigint;
begin
  if p_conservar = p_absorber then
    raise exception 'fusionar_contactos: es el mismo contacto' using errcode = '22023';
  end if;
  select * into v_c from public.contacts where id = p_conservar and deleted_at is null for update;
  select * into v_a from public.contacts where id = p_absorber and deleted_at is null for update;
  if v_c.id is null or v_a.id is null then
    raise exception 'fusionar_contactos: alguno de los dos contactos no existe' using errcode = 'P0002';
  end if;
  if v_c.workspace_id <> v_a.workspace_id then
    raise exception 'fusionar_contactos: son de espacios distintos' using errcode = '22023';
  end if;
  if not v_servidor and not public.is_workspace_manager(v_c.workspace_id) then
    raise exception 'fusionar_contactos: solo Owner y Admin' using errcode = '42501';
  end if;

  -- La foto, antes de mover nada: es lo que permite reconstruir la fusión.
  v_foto := jsonb_build_object(
    'contacto', to_jsonb(v_a),
    'etiquetas', (select coalesce(jsonb_agg(tag_id), '[]') from public.contact_tags where contact_id = v_a.id),
    'campos', (select coalesce(jsonb_agg(jsonb_build_object('field_id', field_id, 'value', value)), '[]')
               from public.contact_custom_fields where contact_id = v_a.id),
    'canales', (select coalesce(jsonb_agg(jsonb_build_object('channel_id', channel_id, 'platform_sender_id', platform_sender_id)), '[]')
                from public.contact_channels where contact_id = v_a.id)
  );

  -- Conversaciones: una por canal y contacto. Si los dos tienen en el mismo
  -- canal, los mensajes pasan a la que queda y la otra se borra vacía.
  for v_conv in select * from public.conversations where contact_id = v_a.id loop
    select id into v_destino from public.conversations
      where contact_id = v_c.id and channel_id = v_conv.channel_id;
    if v_destino is null then
      update public.conversations set contact_id = v_c.id where id = v_conv.id;
      v_movidas := v_movidas || v_conv.id;
    else
      update public.messages set conversation_id = v_destino where conversation_id = v_conv.id;
      update public.conversations d set
        last_message_at = greatest(d.last_message_at, v_conv.last_message_at),
        last_message_preview = case when v_conv.last_message_at > d.last_message_at
                                    then v_conv.last_message_preview else d.last_message_preview end,
        unread_count = coalesce(d.unread_count, 0) + coalesce(v_conv.unread_count, 0),
        assigned_to = coalesce(d.assigned_to, v_conv.assigned_to)
      where d.id = v_destino;
      delete from public.conversations where id = v_conv.id;
      v_unidas := v_unidas || v_conv.id;
    end if;
  end loop;

  update public.contact_channels set contact_id = v_c.id where contact_id = v_a.id;

  insert into public.contact_tags (contact_id, tag_id)
    select v_c.id, tag_id from public.contact_tags where contact_id = v_a.id
    on conflict do nothing;
  delete from public.contact_tags where contact_id = v_a.id;

  -- Campos propios: manda el valor del que queda; el absorbido completa huecos.
  insert into public.contact_custom_fields (contact_id, field_id, value)
    select v_c.id, field_id, value from public.contact_custom_fields where contact_id = v_a.id
    on conflict do nothing;
  delete from public.contact_custom_fields where contact_id = v_a.id;

  -- Inscripciones: una por secuencia. Si los dos estaban, queda la del que queda.
  update public.sequence_enrollments e set contact_id = v_c.id
    where e.contact_id = v_a.id
      and not exists (select 1 from public.sequence_enrollments x where x.contact_id = v_c.id and x.sequence_id = e.sequence_id);
  delete from public.sequence_enrollments where contact_id = v_a.id;

  update public.flow_sessions set contact_id = v_c.id where contact_id = v_a.id;
  update public.broadcast_recipients set contact_id = v_c.id where contact_id = v_a.id;
  update public.analytics_events set contact_id = v_c.id where contact_id = v_a.id;
  update public.contact_notes set contact_id = v_c.id where contact_id = v_a.id;
  delete from public.sugerencias_union where contacto_id = v_a.id or otro_id = v_a.id;

  -- La atribución: el primer clic más viejo y el último más nuevo. Es la única
  -- escritura que puede cambiar un first_click ya escrito (trigger de la 00029).
  v_fc := case
    when v_c.attribution -> 'first_click' is null then v_a.attribution -> 'first_click'
    when v_a.attribution -> 'first_click' is null then v_c.attribution -> 'first_click'
    when (v_a.attribution #>> '{first_click,captured_at}') < (v_c.attribution #>> '{first_click,captured_at}')
      then v_a.attribution -> 'first_click'
    else v_c.attribution -> 'first_click' end;
  v_lc := case
    when v_c.attribution -> 'last_click' is null then v_a.attribution -> 'last_click'
    when v_a.attribution -> 'last_click' is null then v_c.attribution -> 'last_click'
    when (v_a.attribution #>> '{last_click,captured_at}') > (v_c.attribution #>> '{last_click,captured_at}')
      then v_a.attribution -> 'last_click'
    else v_c.attribution -> 'last_click' end;

  perform set_config('app.fusion_contactos', 'on', true);
  update public.contacts set
    attribution = jsonb_strip_nulls(jsonb_build_object('first_click', v_fc, 'last_click', v_lc)),
    phone = coalesce(phone, v_a.phone),
    phone_resolved = case when coalesce(phone, v_a.phone) is not null then true else phone_resolved and v_a.phone_resolved end,
    email = coalesce(email, v_a.email),
    secondary_email = coalesce(secondary_email, v_a.secondary_email),
    country = coalesce(country, v_a.country),
    whatsapp_phone = coalesce(whatsapp_phone, v_a.whatsapp_phone),
    setter_id = coalesce(setter_id, v_a.setter_id),
    vendedor_id = coalesce(vendedor_id, v_a.vendedor_id),
    last_interaction_at = greatest(last_interaction_at, v_a.last_interaction_at),
    updated_at = now()
  where id = v_c.id;
  perform set_config('app.fusion_contactos', '', true);

  -- La guarda: nada que apunte al absorbido puede irse en cascada sin que
  -- esta función lo haya movido. Una tabla nueva con clave hacia contacts
  -- (contact_notes, de F30) hace fallar la fusión hasta que se la incluya.
  for r in
    select c.conrelid::regclass as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.contacts'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tabla, r.columna) into v_quedan using v_a.id;
    if v_quedan > 0 then
      raise exception 'fusionar_contactos: % todavía tiene % filas del contacto absorbido; hay que sumarla a la fusión', r.tabla, v_quedan
        using errcode = '55000';
    end if;
  end loop;

  delete from public.contacts where id = v_a.id;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id,
    case when v_servidor then null else v_uid end,
    case when v_servidor then 'Sistema' else coalesce(public.etiqueta_de_actor(v_uid), 'Usuario') end,
    'contacto.fusionado',
    'contacto',
    v_c.id,
    v_c.display_name,
    '{}',
    jsonb_build_object(
      'absorbido_id', v_a.id,
      'absorbido_nombre', v_a.display_name,
      'absorbido', v_foto -> 'contacto',
      'foto', v_foto,
      'conversaciones_movidas', to_jsonb(v_movidas),
      'conversaciones_unidas', to_jsonb(v_unidas)
    )
  );

  return jsonb_build_object('resultado', 'fusionado', 'conservado', v_c.id, 'absorbido', v_a.id);
end;
$$;

revoke all on function public.fusionar_contactos(uuid, uuid) from public, anon;
grant execute on function public.fusionar_contactos(uuid, uuid) to authenticated, service_role;
