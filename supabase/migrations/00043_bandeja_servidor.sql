-- ============================================================
-- LA BANDEJA EN EL SERVIDOR (F35, tramo A de S8)
-- ============================================================
-- Hasta acá la bandeja cargaba un tope fijo de 50 conversaciones y buscaba
-- solo entre esas, en el navegador (medido el 22/09/2026: 50 de 200; el
-- 03/11/2026 son más de 761). Estas tres funciones hacen la lista por páginas,
-- la búsqueda y las cantidades de las pestañas sobre todas las conversaciones
-- que quien mira puede ver.
--
-- SECURITY INVOKER, a propósito: corren con los permisos de quien llama, así
-- que la seguridad por filas de conversations, contacts y contact_channels
-- decide qué ve cada uno, igual que una lectura directa. Una consecuencia
-- medida en scripts/verify-bandeja.mjs: una conversación asignada a un Member
-- cuyo contacto no es suyo aparece en su lista, pero buscarla por el contacto
-- no la encuentra, porque la RLS le oculta el contacto.
--
-- La búsqueda: nombre, correo y correo secundario del contacto, usuario de
-- Instagram (contact_channels.platform_username, sin la arroba inicial), y
-- teléfono y teléfono de WhatsApp por dígitos, solo cuando lo buscado son
-- dígitos y separadores. Los teléfonos están en E.164 por el check de la 00029,
-- así que alcanza con comparar los dígitos. Los comodines de LIKE se escapan:
-- lo buscado se compara como texto.
--
-- El orden: último mensaje, del más nuevo al más viejo, las que no tienen al
-- final, y el id para desempatar. Las páginas siguen un cursor por esa pareja,
-- no un desplazamiento: una conversación que sube o se cierra mientras se
-- pagina no hace saltear otra.
--
-- Sin índices: con menos de mil conversaciones no hacen falta. La medición
-- con EXPLAIN ANALYZE sigue anotada como deuda del Bloque 4.
--
-- Solo crea funciones y les da permisos: no toca tablas, políticas ni filas.
-- Idempotente: create or replace.
-- ============================================================

create or replace function public.bandeja_coincide(p_contacto uuid, p_busqueda text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select
      '%' || replace(replace(replace(btrim(p_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron,
      '%' || replace(replace(replace(regexp_replace(btrim(p_busqueda), '^@', ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron_usuario,
      case
        when btrim(p_busqueda) ~ '^[0-9+().[:space:]-]+$' and btrim(p_busqueda) ~ '[0-9]'
          then '%' || regexp_replace(p_busqueda, '[^0-9]', '', 'g') || '%'
      end as patron_digitos
  )
  select exists (
    select 1
    from contacts c, q
    where c.id = p_contacto
      and (
        c.display_name ilike q.patron
        or c.email ilike q.patron
        or c.secondary_email ilike q.patron
        or (q.patron_digitos is not null and (c.phone like q.patron_digitos or c.whatsapp_phone like q.patron_digitos))
        or exists (
          select 1 from contact_channels cc
          where cc.contact_id = c.id and cc.platform_username ilike q.patron_usuario
        )
      )
  );
$$;

create or replace function public.bandeja_pagina(
  p_workspace uuid,
  p_estado text,
  p_busqueda text,
  p_antes_orden timestamptz,
  p_antes_id uuid,
  p_limite integer
)
returns setof public.conversations
language sql
stable
security invoker
set search_path = public
as $$
  select cv.*
  from conversations cv
  where cv.workspace_id = p_workspace
    and cv.deleted_at is null
    and (p_estado = 'all' or cv.status = p_estado)
    and (
      coalesce(btrim(p_busqueda), '') = ''
      or (cv.contact_id is not null and bandeja_coincide(cv.contact_id, p_busqueda))
    )
    and (
      p_antes_id is null
      or (coalesce(cv.last_message_at, '-infinity'::timestamptz), cv.id) < (coalesce(p_antes_orden, '-infinity'::timestamptz), p_antes_id)
    )
  order by coalesce(cv.last_message_at, '-infinity'::timestamptz) desc, cv.id desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

create or replace function public.bandeja_cantidades(p_workspace uuid, p_busqueda text)
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
  from conversations cv
  where cv.workspace_id = p_workspace
    and cv.deleted_at is null
    and (
      coalesce(btrim(p_busqueda), '') = ''
      or (cv.contact_id is not null and bandeja_coincide(cv.contact_id, p_busqueda))
    );
$$;

revoke all on function public.bandeja_coincide(uuid, text) from public, anon;
revoke all on function public.bandeja_pagina(uuid, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.bandeja_cantidades(uuid, text) from public, anon;
grant execute on function public.bandeja_coincide(uuid, text) to authenticated;
grant execute on function public.bandeja_pagina(uuid, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.bandeja_cantidades(uuid, text) to authenticated;

comment on function public.bandeja_coincide(uuid, text) is
  'F35: si el contacto coincide con lo buscado (nombre, correo, correo secundario, usuario de Instagram, teléfono por dígitos). Security invoker: aplica la RLS de quien llama.';
comment on function public.bandeja_pagina(uuid, text, text, timestamptz, uuid, integer) is
  'F35: una página de la bandeja (estado open, closed o all), por último mensaje y con cursor. Security invoker: aplica la RLS de quien llama.';
comment on function public.bandeja_cantidades(uuid, text) is
  'F35: las cantidades de las pestañas Abiertas, Cerradas y Todas. Security invoker: aplica la RLS de quien llama.';
