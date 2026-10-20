-- ============================================================
-- NOTAS DEL CONTACTO (F30) Y LAS NOTAS EN LA FUSIÓN (F26)
-- ============================================================
-- F30 pide la tabla `contact_notes`, con lista cronológica en la ficha:
-- cualquier miembro con acceso al contacto crea notas; solo el autor, un Admin
-- o el Owner edita o elimina. Y su seguridad por filas hereda el alcance del
-- contacto (criterio 2): un Member lee, crea o edita notas solo de los
-- contactos donde es setter, vendedor o asignado, y Owner y Admin las ven
-- todas. Se apoya en `can_see_contact` de la 00019.
--
-- Borrado suave: eliminar marca `deleted_at`; las eliminadas no se listan. Lo
-- elimina `eliminar_nota`, y no un UPDATE directo: la política de lectura
-- excluye las eliminadas, y (inferencia, la comprueba
-- scripts/verify-notas.mjs) un UPDATE que deja la fila ilegible se rechaza.
-- La edición directa exige `deleted_at is null` antes y después, así que nadie
-- elimina ni restaura una nota por fuera de la función.
--
-- La fusión: `fusionar_contactos` (00031) corta si alguna fila sigue apuntando
-- al contacto absorbido, así que sin esto una nota rompería la fusión. Se
-- reescribe entera con UNA línea nueva: pasa las notas del absorbido al que
-- queda, incluidas las eliminadas. Lo demás es copia textual de la 00031,
-- comparada contra `pg_get_functiondef` en producción el 20/10/2026.
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

-- ── 1. La tabla ──────────────────────────────────────────────────────────
create table if not exists contact_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  -- El nombre del autor en el momento de escribirla: la nota se sigue leyendo
  -- aunque el autor deje el equipo. Lo pone el trigger, no el cliente.
  author_label text,
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists contact_notes_contact_idx on contact_notes (contact_id, created_at desc);
create index if not exists contact_notes_deleted_at_idx on contact_notes (deleted_at);

-- ── 2. Lo que el cliente no elige ────────────────────────────────────────
-- Al crear: el autor es quien escribe y su nombre sale de Auth. Al editar
-- desde la API (rol `authenticated`), solo cambia el cuerpo: ni el contacto,
-- ni el espacio, ni el autor, ni las fechas. La fusión corre como dueña de su
-- función (no `authenticated`) y sí puede mover `contact_id`.
--
-- El trigger es `security invoker` a propósito: dentro de uno `security
-- definer`, `current_user` es el dueño y nunca `authenticated`, y el control
-- no distinguiría la API de la fusión. El nombre del autor sale de
-- `etiqueta_propia`, que devuelve solo el de quien llama (`etiqueta_de_actor`
-- no es de `authenticated`: daría el correo de cualquiera).
create or replace function public.etiqueta_propia()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.etiqueta_de_actor((select auth.uid()));
$$;

revoke all on function public.etiqueta_propia() from public, anon;
grant execute on function public.etiqueta_propia() to authenticated;

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
  if new.body is distinct from old.body then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.contact_notes_antes() from public, anon;

drop trigger if exists contact_notes_antes on contact_notes;
create trigger contact_notes_antes
  before insert or update on contact_notes
  for each row execute function public.contact_notes_antes();

-- ── 3. Quién lee, crea y edita ───────────────────────────────────────────
alter table contact_notes enable row level security;

drop policy if exists "contact_notes: leer las del alcance, sin eliminadas" on contact_notes;
create policy "contact_notes: leer las del alcance, sin eliminadas"
  on contact_notes for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.contacts c
      where c.id = contact_notes.contact_id
        and c.workspace_id = contact_notes.workspace_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

drop policy if exists "contact_notes: crear en los contactos del alcance" on contact_notes;
create policy "contact_notes: crear en los contactos del alcance"
  on contact_notes for insert to authenticated
  with check (
    deleted_at is null
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.contacts c
      where c.id = contact_notes.contact_id
        and c.workspace_id = contact_notes.workspace_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

-- Editar: el autor dentro del alcance, o un manager. Nunca una eliminada, y
-- nunca dejándola eliminada (eso es de `eliminar_nota`).
drop policy if exists "contact_notes: editar el autor o un manager" on contact_notes;
create policy "contact_notes: editar el autor o un manager"
  on contact_notes for update to authenticated
  using (
    deleted_at is null
    and (
      public.is_workspace_manager(workspace_id)
      or (
        author_id = (select auth.uid())
        and exists (
          select 1 from public.contacts c
          where c.id = contact_notes.contact_id
            and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
        )
      )
    )
  )
  with check (
    deleted_at is null
    and (
      public.is_workspace_manager(workspace_id)
      or (
        author_id = (select auth.uid())
        and exists (
          select 1 from public.contacts c
          where c.id = contact_notes.contact_id
            and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
        )
      )
    )
  );

-- Sin política de DELETE: las notas no se borran desde la API. La purga de
-- F30 corre con la clave de servicio.
revoke delete, truncate on contact_notes from anon, authenticated;
revoke all on contact_notes from anon;

-- ── 4. Eliminar una nota ─────────────────────────────────────────────────
create or replace function public.eliminar_nota(p_nota uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.contact_notes%rowtype;
  v_c public.contacts%rowtype;
begin
  select * into v_n from public.contact_notes where id = p_nota and deleted_at is null for update;
  if v_n.id is null then
    raise exception 'eliminar_nota: la nota no existe' using errcode = 'P0002';
  end if;
  select * into v_c from public.contacts where id = v_n.contact_id;
  if not public.can_see_contact(v_c.workspace_id, v_c.setter_id, v_c.vendedor_id) then
    raise exception 'eliminar_nota: la nota no existe' using errcode = 'P0002';
  end if;
  if not public.is_workspace_manager(v_n.workspace_id)
     and v_n.author_id is distinct from auth.uid() then
    raise exception 'eliminar_nota: solo el autor, un Admin o el Owner' using errcode = '42501';
  end if;
  update public.contact_notes set deleted_at = now() where id = v_n.id;
end;
$$;

revoke all on function public.eliminar_nota(uuid) from public, anon;
grant execute on function public.eliminar_nota(uuid) to authenticated;

-- ── 5. Las notas en la fusión ────────────────────────────────────────────
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
