-- ============================================================
-- IDENTIDAD DE CANAL Y RECONCILIACIÓN DE TELÉFONOS (F26)
-- ============================================================
-- Cuatro cosas:
--
-- 1. EL IDENTIFICADOR CRUDO. `contact_channels.raw_jid` guarda el
--    identificador tal como llegó, sin transformar, y `addressing_mode` cómo se
--    direccionó (`pn` o `lid` en WhatsApp). `messages.remote_jid` guarda el
--    identificador con que llegó cada mensaje. Ninguno se sobrescribe una vez
--    escrito: lo frena un trigger. Es lo que permite reconciliar después y
--    reconstruir qué pasó.
--
--    `raw_jid` queda NULLABLE en esta migración, a propósito. §7.1 lo pide
--    obligatorio, y lo va a ser: el NOT NULL lo pone la migración de F27,
--    cuando el código que lo escribe ya esté desplegado. Ponerlo ahora haría
--    fallar cada contacto nuevo de Instagram en los minutos entre migrar y
--    desplegar, porque el código en producción todavía no lo manda. Las filas
--    existentes (todas de Instagram) se rellenan con `platform_sender_id`, que
--    es exactamente el identificador que mandó Zernio.
--
-- 2. LA IDENTIDAD DEL CANAL ES LA CUENTA, NO LA RANURA DEL PROVEEDOR. El
--    22/09/2026 Zernio le dio a otra cuenta de Instagram el mismo `_id` que
--    tenía la anterior, y la sincronización renombró la fila. Ahora:
--    `platform_account_id` guarda el `platformUserId` de la cuenta, y el
--    `unique (workspace_id, late_account_id)` del fork pasa a ser un índice
--    único SOLO SOBRE CANALES ACTIVOS. Así una ranura reusada se resuelve
--    desactivando la fila vieja y creando otra, sin perder el historial que
--    colgaba de la vieja (`decidirCanalDeCuenta`, `lib/channel-rules.ts`).
--    Ningún código usaba ese unique como `onConflict`: verificado en el repo.
--
-- 3. LA RECONCILIACIÓN. `reconciliar_telefono` carga el teléfono de un
--    contacto, saca la marca de "sin resolver" y lo registra en el historial
--    de auditoría, en la misma operación. Tres vías: un mensaje posterior y el
--    aviso de contacto de Evolution (solo el servidor, F27 las llama), y la
--    carga manual desde la ficha (el usuario que ve el contacto). Si el
--    teléfono ya es de otro contacto, NO escribe: devuelve el conflicto para
--    que una persona confirme la fusión. Y a un Member no le dice cuál es el
--    otro contacto si no es suyo: mostrarlo rompería el scope de leads.
--
-- 4. LA FUSIÓN. `fusionar_contactos` la confirma una persona, nunca es
--    automática, y solo la hacen Owner y Admin: borra un contacto, y deshacerla
--    es caro. Une canales, conversaciones (si chocan en el mismo canal, mueve
--    los mensajes a la que queda), etiquetas, campos propios, inscripciones,
--    sesiones de flujo, destinatarios de difusiones, eventos y atribución (el
--    primer clic más viejo y el último más nuevo). Antes de borrar el absorbido
--    comprueba en el catálogo que NINGUNA tabla con clave hacia `contacts` le
--    siga apuntando: cuando F30 sume `contact_notes`, la fusión falla a los
--    gritos hasta que se las incluya, en vez de borrarlas en cascada. Deja en el
--    historial una foto completa del absorbido, para poder reconstruir qué se
--    unió si se confirmó por error (Flujo 2).
--
-- Y el contador de F26: `contar_mensajes_sin_telefono` cuenta los entrantes de
-- WhatsApp de un período y cuántos llegaron sin teléfono. "Sin teléfono" es un
-- `remote_jid` que termina en `@lid`: Evolution reemplaza el `@lid` por el JID
-- con teléfono cuando lo tiene (investigación de Evolution, verificado en su
-- código), así que el que queda en `@lid` es el que llegó sin número.
--
-- Idempotente: `add column if not exists`, `drop ... if exists`,
-- `create index if not exists` y `create or replace`.
-- ============================================================


-- ── 1. Identificador crudo ───────────────────────────────────────────────

alter table contact_channels
  add column if not exists raw_jid text,
  add column if not exists addressing_mode text;

update contact_channels set raw_jid = platform_sender_id where raw_jid is null;

alter table messages add column if not exists remote_jid text;

comment on column contact_channels.raw_jid is
  'Identificador tal como llegó, sin transformar (F26). No se sobrescribe. NOT NULL lo pone F27.';
comment on column contact_channels.addressing_mode is
  'Cómo se direccionó en WhatsApp: pn o lid (key.addressingMode de Evolution). Nulo en Instagram.';
comment on column messages.remote_jid is
  'Identificador con que llegó el mensaje (F26). No se sobrescribe.';

create or replace function public.identificador_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_viejo text := to_jsonb(old) ->> tg_argv[0];
  v_nuevo text := to_jsonb(new) ->> tg_argv[0];
begin
  if v_viejo is not null and v_nuevo is distinct from v_viejo then
    raise exception '%.% guarda el identificador tal como llegó y no se sobrescribe (F26)', tg_table_name, tg_argv[0]
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_channels_raw_jid_inmutable on contact_channels;
create trigger contact_channels_raw_jid_inmutable
  before update of raw_jid on contact_channels
  for each row execute function public.identificador_inmutable('raw_jid');

drop trigger if exists messages_remote_jid_inmutable on messages;
create trigger messages_remote_jid_inmutable
  before update of remote_jid on messages
  for each row execute function public.identificador_inmutable('remote_jid');


-- ── 2. Identidad del canal ───────────────────────────────────────────────

alter table channels add column if not exists platform_account_id text;

comment on column channels.platform_account_id is
  'Identidad del canal: platformUserId de la cuenta en Zernio (F26). late_account_id es la ranura, que Zernio reusa.';

alter table channels drop constraint if exists channels_workspace_id_late_account_id_key;

create unique index if not exists channels_ranura_activa_key
  on channels (workspace_id, late_account_id)
  where is_active and late_account_id is not null;

create unique index if not exists channels_cuenta_activa_key
  on channels (workspace_id, platform, platform_account_id)
  where is_active and platform_account_id is not null;


-- ── Quién actúa, para el historial ───────────────────────────────────────
-- El nombre se toma en el momento, igual que `actorDe` en lib/auditoria.ts.
create or replace function public.etiqueta_de_actor(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    u.email,
    p_user::text
  )
  from auth.users u where u.id = p_user;
$$;

revoke all on function public.etiqueta_de_actor(uuid) from public, anon, authenticated;


-- ── 3. Reconciliar un teléfono ───────────────────────────────────────────

create or replace function public.reconciliar_telefono(
  p_contacto uuid,
  p_telefono text,
  p_via text
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
  v_otro public.contacts%rowtype;
  v_visible boolean;
begin
  if p_via not in ('mensaje', 'aviso_evolution', 'manual') then
    raise exception 'reconciliar_telefono: vía desconocida %', p_via using errcode = '22023';
  end if;
  if p_telefono is null or p_telefono !~ '^\+[1-9][0-9]{0,14}$' then
    raise exception 'reconciliar_telefono: el teléfono tiene que estar en E.164 (§14)' using errcode = '22023';
  end if;

  select * into v_c from public.contacts where id = p_contacto and deleted_at is null;
  if not found then
    raise exception 'reconciliar_telefono: el contacto no existe' using errcode = 'P0002';
  end if;

  -- Las vías automáticas son del servidor. La manual, de quien ve el contacto.
  if p_via <> 'manual' and not v_servidor then
    raise exception 'reconciliar_telefono: la vía % la usa solo el servidor', p_via using errcode = '42501';
  end if;
  if not v_servidor and not public.can_see_contact(v_c.workspace_id, v_c.setter_id, v_c.vendedor_id) then
    raise exception 'reconciliar_telefono: sin acceso a ese contacto' using errcode = '42501';
  end if;

  if v_c.phone = p_telefono then
    return jsonb_build_object('resultado', 'sin_cambios');
  end if;

  -- Nunca por nombre: solo por el teléfono exacto, en el mismo espacio.
  select * into v_otro from public.contacts
  where workspace_id = v_c.workspace_id and phone = p_telefono and id <> v_c.id and deleted_at is null
  order by created_at
  limit 1;

  if found then
    v_visible := v_servidor or public.can_see_contact(v_otro.workspace_id, v_otro.setter_id, v_otro.vendedor_id);
    return jsonb_build_object(
      'resultado', 'conflicto',
      'visible', v_visible,
      'otro_id', case when v_visible then v_otro.id else null end
    );
  end if;

  update public.contacts
    set phone = p_telefono, phone_resolved = true, updated_at = now()
    where id = v_c.id;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id,
    case when v_servidor then null else v_uid end,
    case when v_servidor then 'Sistema' else coalesce(public.etiqueta_de_actor(v_uid), 'Usuario') end,
    case when v_c.phone_resolved then 'contacto.editado' else 'contacto.reconciliado' end,
    'contacto',
    v_c.id,
    v_c.display_name,
    jsonb_build_object('phone', jsonb_build_object('antes', v_c.phone, 'despues', p_telefono)),
    jsonb_build_object('via', p_via)
  );

  return jsonb_build_object('resultado', 'resuelto');
end;
$$;

revoke all on function public.reconciliar_telefono(uuid, text, text) from public, anon;
grant execute on function public.reconciliar_telefono(uuid, text, text) to authenticated, service_role;


-- ── 4. Fusionar dos contactos ────────────────────────────────────────────

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


-- ── El contador de F26 ───────────────────────────────────────────────────
-- security invoker: cuenta lo que quien llama puede leer. La pantalla lo
-- muestra solo al Owner (§11, Canales), que lee todo su espacio.
create or replace function public.contar_mensajes_sin_telefono(
  p_workspace uuid,
  p_desde timestamptz
)
returns table (sin_telefono integer, total integer)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where m.remote_jid like '%@lid')::integer,
    count(*)::integer
  from public.messages m
  join public.conversations v on v.id = m.conversation_id
  where v.workspace_id = p_workspace
    and v.platform = 'whatsapp'
    and m.direction = 'inbound'
    and m.created_at >= p_desde;
$$;

revoke all on function public.contar_mensajes_sin_telefono(uuid, timestamptz) from public, anon;
grant execute on function public.contar_mensajes_sin_telefono(uuid, timestamptz) to authenticated, service_role;
