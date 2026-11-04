-- ============================================================
-- LOS FILTROS DE LA BANDEJA EN EL SERVIDOR (F35, tramo B de S8)
-- ============================================================
-- La 00043 hizo la lista, la búsqueda y las pestañas en el servidor. Estas
-- cuatro funciones suman los filtros de F35 (etiquetas, asignación, canal,
-- fecha del último mensaje, teléfono sin resolver y seguimiento), la búsqueda
-- palabra por palabra y la búsqueda dentro de los mensajes.
--
-- NOMBRES NUEVOS, Y LAS TRES DE LA 00043 INTACTAS, a propósito. El código que
-- corre en producción entre el push y el despliegue las sigue llamando con su
-- firma. `create or replace` con otros parámetros no reemplaza una función:
-- crea otra con el mismo nombre (documentación de PostgreSQL, CREATE
-- FUNCTION), y PostgREST podría no saber cuál elegir. Lo hace cumplir
-- lib/bandeja-filtros-migracion.test.ts.
--
-- SECURITY INVOKER, igual que la 00043: corren con los permisos de quien
-- llama, así que la seguridad por filas de conversations, contacts,
-- contact_tags, contact_channels y messages decide qué ve cada uno. Una
-- consecuencia, medida en scripts/verify-filtros-bandeja.mjs: los filtros que
-- miran el contacto (etiquetas, asignación, teléfono, seguimiento) no
-- encuentran una conversación cuyo contacto la RLS le oculta a quien mira.
--
-- LOS FILTROS VAN EN UN SOLO jsonb (`p_filtros`), que arma y valida el
-- servidor (lib/filtros-bandeja.ts). Así, el filtro de la ventana de Instagram
-- de S9 se suma con un `create or replace` de la misma firma. Las claves:
--   q                      lo buscado
--   etiquetas              [uuid]: el contacto tiene cualquiera
--   asignacion             'sin' (sin setter ni vendedor) o el id de un
--                          miembro (es setter o vendedor del contacto)
--   canal                  ['instagram', 'whatsapp']: por plataforma
--   ultimo                 'hoy', '7', '30' o 'rango' (con ultimo_desde y
--                          ultimo_hasta, AAAA-MM-DD, inclusive)
--   sin_telefono           true: el contacto tiene el teléfono sin resolver
--   seguimiento            'hoy', 'semana', 'vencido' o 'rango' (con
--                          seguimiento_desde y seguimiento_hasta), sobre
--                          contacts.next_followup_date
--   ahora                  solo para el verificador: el reloj fijo. La app
--                          nunca lo manda; por defecto, now()
--
-- «HOY» ES EL DÍA EN LA ZONA DEL ESPACIO (workspaces.zona_horaria, de la
-- 00033; por defecto America/Costa_Rica), no en UTC. «Vence esta semana» va
-- de hoy al domingo, inclusive (la semana va de lunes a domingo). «Últimos 7
-- días» es hoy y los 6 anteriores; «Últimos 30 días», hoy y los 29.
--
-- LA BÚSQUEDA: cada palabra tiene que estar en algún dato del contacto
-- (nombre, correo, correo secundario, usuario de Instagram sin la arroba
-- inicial, o el teléfono por dígitos cuando la palabra son dígitos), o un
-- mismo mensaje de la conversación tiene que tener todas las palabras. Lo
-- buscado completo, si son dígitos y separadores, se compara además como un
-- solo teléfono, como en la 00043. Sin mayúsculas y sin tildes: á, é, í, ó,
-- ú y ü valen como la vocal sola (la ñ no se toca). Los comodines de LIKE se
-- escapan.
--
-- Sin índices: 4640 mensajes en el espacio real el 04/11/2026 (lectura de
-- solo cantidades autorizada por Marcos), y la búsqueda en los mensajes va
-- por conversación, con el índice que ya existe (idx_messages_conversation).
--
-- Solo crea funciones y les da permisos: no toca tablas, políticas ni filas.
-- Idempotente: create or replace.
-- ============================================================

create or replace function public.bandeja_busca(p_conversacion uuid, p_contacto uuid, p_busqueda text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select btrim(coalesce(p_busqueda, '')) as texto
  ),
  palabras as (
    select
      '%' || replace(replace(replace(translate(p, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron,
      '%' || replace(replace(replace(translate(regexp_replace(p, '^@', ''), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron_usuario,
      case when p ~ '^[0-9+().-]+$' and p ~ '[0-9]' then '%' || regexp_replace(p, '[^0-9]', '', 'g') || '%' end as patron_digitos
    from q, regexp_split_to_table(q.texto, '\s+') as p
    where p <> ''
  ),
  completo as (
    select case
      when texto ~ '^[0-9+().[:space:]-]+$' and texto ~ '[0-9]' then '%' || regexp_replace(texto, '[^0-9]', '', 'g') || '%'
    end as patron_digitos
    from q
  ),
  c as (
    select * from contacts where id = p_contacto
  )
  select exists (select 1 from palabras) and (
    -- Cada palabra está en algún dato del contacto.
    (
      exists (select 1 from c)
      and not exists (
        select 1 from palabras w
        where not exists (
          select 1 from c
          where translate(c.display_name, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(c.email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(c.secondary_email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or (w.patron_digitos is not null and (c.phone like w.patron_digitos or c.whatsapp_phone like w.patron_digitos))
            or exists (
              select 1 from contact_channels cc
              where cc.contact_id = c.id
                and translate(cc.platform_username, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron_usuario
            )
        )
      )
    )
    -- Lo buscado completo, como un solo teléfono.
    or exists (
      select 1 from c, completo
      where completo.patron_digitos is not null
        and (c.phone like completo.patron_digitos or c.whatsapp_phone like completo.patron_digitos)
    )
    -- Un mismo mensaje de la conversación tiene todas las palabras.
    or (
      p_conversacion is not null
      and exists (
        select 1 from messages m
        where m.conversation_id = p_conversacion
          and m.text is not null
          and not exists (
            select 1 from palabras w
            where not (translate(m.text, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron)
          )
      )
    )
  );
$$;

create or replace function public.bandeja_filtrada(p_workspace uuid, p_filtros jsonb)
returns setof public.conversations
language sql
stable
security invoker
set search_path = public
as $$
  with f as (
    select
      nullif(btrim(coalesce(p_filtros->>'q', '')), '') as q,
      case when jsonb_typeof(p_filtros->'etiquetas') = 'array'
        then array(select jsonb_array_elements_text(p_filtros->'etiquetas'))::uuid[] end as etiquetas,
      nullif(p_filtros->>'asignacion', '') as asignacion,
      case when jsonb_typeof(p_filtros->'canal') = 'array'
        then array(select jsonb_array_elements_text(p_filtros->'canal')) end as canales,
      nullif(p_filtros->>'ultimo', '') as ultimo,
      (p_filtros->>'ultimo_desde')::date as ultimo_desde,
      (p_filtros->>'ultimo_hasta')::date as ultimo_hasta,
      coalesce((p_filtros->>'sin_telefono')::boolean, false) as sin_telefono,
      nullif(p_filtros->>'seguimiento', '') as seguimiento,
      (p_filtros->>'seguimiento_desde')::date as seguimiento_desde,
      (p_filtros->>'seguimiento_hasta')::date as seguimiento_hasta,
      coalesce((p_filtros->>'ahora')::timestamptz, now()) as ahora
  ),
  z as (
    select coalesce((select w.zona_horaria from workspaces w where w.id = p_workspace), 'America/Costa_Rica') as zona
  ),
  d as (
    select f.*, z.zona, (f.ahora at time zone z.zona)::date as hoy
    from f, z
  )
  select cv.*
  from conversations cv, d
  where cv.workspace_id = p_workspace
    and cv.deleted_at is null
    and (d.q is null or bandeja_busca(cv.id, cv.contact_id, d.q))
    and (
      d.etiquetas is null or cardinality(d.etiquetas) = 0
      or exists (select 1 from contact_tags ct where ct.contact_id = cv.contact_id and ct.tag_id = any (d.etiquetas))
    )
    and (
      d.asignacion is null
      or case d.asignacion
        when 'sin' then exists (
          select 1 from contacts c where c.id = cv.contact_id and c.setter_id is null and c.vendedor_id is null
        )
        else exists (
          select 1 from contacts c
          where c.id = cv.contact_id and (c.setter_id::text = d.asignacion or c.vendedor_id::text = d.asignacion)
        )
      end
    )
    and (d.canales is null or cardinality(d.canales) = 0 or cv.platform = any (d.canales))
    and (
      d.ultimo is null
      or (
        cv.last_message_at is not null
        and (cv.last_message_at at time zone d.zona)::date between
          case d.ultimo
            when 'hoy' then d.hoy
            when '7' then d.hoy - 6
            when '30' then d.hoy - 29
            when 'rango' then d.ultimo_desde
          end
          and case d.ultimo when 'rango' then d.ultimo_hasta else d.hoy end
      )
    )
    and (
      not d.sin_telefono
      or exists (select 1 from contacts c where c.id = cv.contact_id and c.phone_resolved = false)
    )
    and (
      d.seguimiento is null
      or exists (
        select 1 from contacts c
        where c.id = cv.contact_id
          and c.next_followup_date is not null
          and case d.seguimiento
            when 'hoy' then c.next_followup_date = d.hoy
            when 'semana' then c.next_followup_date between d.hoy and d.hoy + (7 - extract(isodow from d.hoy)::int)
            when 'vencido' then c.next_followup_date < d.hoy
            when 'rango' then c.next_followup_date between d.seguimiento_desde and d.seguimiento_hasta
            else false
          end
      )
    );
$$;

create or replace function public.bandeja_pagina_filtros(
  p_workspace uuid,
  p_estado text,
  p_filtros jsonb,
  p_antes_orden timestamptz,
  p_antes_id uuid,
  p_limite integer,
  p_id uuid
)
returns setof public.conversations
language sql
stable
security invoker
set search_path = public
as $$
  select cv.*
  from bandeja_filtrada(p_workspace, p_filtros) cv
  where (p_estado = 'all' or cv.status = p_estado)
    and (p_id is null or cv.id = p_id)
    and (
      p_antes_id is null
      or (coalesce(cv.last_message_at, '-infinity'::timestamptz), cv.id) < (coalesce(p_antes_orden, '-infinity'::timestamptz), p_antes_id)
    )
  order by coalesce(cv.last_message_at, '-infinity'::timestamptz) desc, cv.id desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

create or replace function public.bandeja_cantidades_filtros(p_workspace uuid, p_filtros jsonb)
returns table (abiertas bigint, cerradas bigint, todas bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where cv.status = 'open'),
    count(*) filter (where cv.status = 'closed'),
    count(*)
  from bandeja_filtrada(p_workspace, p_filtros) cv;
$$;

revoke all on function public.bandeja_busca(uuid, uuid, text) from public, anon;
revoke all on function public.bandeja_filtrada(uuid, jsonb) from public, anon;
revoke all on function public.bandeja_pagina_filtros(uuid, text, jsonb, timestamptz, uuid, integer, uuid) from public, anon;
revoke all on function public.bandeja_cantidades_filtros(uuid, jsonb) from public, anon;
grant execute on function public.bandeja_busca(uuid, uuid, text) to authenticated;
grant execute on function public.bandeja_filtrada(uuid, jsonb) to authenticated;
grant execute on function public.bandeja_pagina_filtros(uuid, text, jsonb, timestamptz, uuid, integer, uuid) to authenticated;
grant execute on function public.bandeja_cantidades_filtros(uuid, jsonb) to authenticated;

comment on function public.bandeja_busca(uuid, uuid, text) is
  'F35: si la conversación coincide con lo buscado, palabra por palabra en los datos del contacto, o todas las palabras en un mismo mensaje. Sin mayúsculas ni tildes. Security invoker: aplica la RLS de quien llama.';
comment on function public.bandeja_filtrada(uuid, jsonb) is
  'F35: las conversaciones del espacio que pasan la búsqueda y los filtros (p_filtros, ver la 00044). «Hoy» en workspaces.zona_horaria. Security invoker: aplica la RLS de quien llama.';
comment on function public.bandeja_pagina_filtros(uuid, text, jsonb, timestamptz, uuid, integer, uuid) is
  'F35: una página de la bandeja con filtros (estado open, closed o all), por último mensaje y con cursor, o una sola por p_id. Security invoker: aplica la RLS de quien llama.';
comment on function public.bandeja_cantidades_filtros(uuid, jsonb) is
  'F35: las cantidades de las pestañas Abiertas, Cerradas y Todas, con los filtros. Security invoker: aplica la RLS de quien llama.';
