-- ============================================================
-- 00051: F43, el filtro de los que escribieron (ítem 5 del plan maestro, 06/11/2026)
-- ============================================================
-- El criterio de F43 agregado el 05/11/2026: un filtro deja afuera de la lista
-- de Contactos a los que nunca escribieron, sin ningún mensaje del lead en
-- ninguna de sus conversaciones. Con la clave `escribieron` en 'si', solo
-- pasan los contactos con al menos un mensaje `direction = 'inbound'`.
--
-- Solo reemplaza contactos_filtrados: misma firma y security invoker, así que
-- `create or replace` conserva los permisos de la 00049, y contactos_pagina y
-- contactos_cantidad, que la llaman, no cambian. Conserva el arreglo de la
-- 00050. No toca filas ni políticas. Idempotente: create or replace.
-- ============================================================

create or replace function public.contactos_filtrados(p_workspace uuid, p_filtros jsonb)
returns setof public.contacts
language sql
stable
security invoker
set search_path = public
as $$
  with f as (
    select
      btrim(coalesce(p_filtros->>'q', '')) as q,
      nullif(p_filtros->>'seguimiento', '') as seguimiento,
      nullif(p_filtros->>'etapa', '') as etapa,
      nullif(p_filtros->>'setter', '') as setter,
      nullif(p_filtros->>'vendedor', '') as vendedor,
      nullif(p_filtros->>'etiqueta', '') as etiqueta,
      coalesce(p_filtros->>'escribieron', '') = 'si' as escribieron,
      coalesce((p_filtros->>'ahora')::timestamptz, now()) as ahora
  ),
  z as (
    select coalesce((select w.zona_horaria from workspaces w where w.id = p_workspace), 'America/Costa_Rica') as zona
  ),
  d as (
    select f.*, (f.ahora at time zone z.zona)::date as hoy,
      case
        when f.q ~ '^[0-9+().[:space:]-]+$' and f.q ~ '[0-9]' then '%' || regexp_replace(f.q, '[^0-9]', '', 'g') || '%'
      end as completo_digitos
    from f, z
  ),
  palabras as (
    select
      '%' || replace(replace(replace(translate(p, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron,
      '%' || replace(replace(replace(translate(regexp_replace(p, '^@', ''), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron_usuario,
      case when p ~ '^[0-9+().-]+$' and p ~ '[0-9]' then '%' || regexp_replace(p, '[^0-9]', '', 'g') || '%' end as patron_digitos
    from d, regexp_split_to_table(d.q, '\s+') as p
    where p <> ''
  )
  select c.*
  from contacts c, d
  where c.workspace_id = p_workspace
    and (
      d.q = ''
      or (
        not exists (
          select 1 from palabras w
          where not coalesce(
            translate(c.display_name, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(c.email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(c.secondary_email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or (w.patron_digitos is not null and (c.phone like w.patron_digitos or c.whatsapp_phone like w.patron_digitos))
            or exists (
              select 1 from contact_channels cc
              where cc.contact_id = c.id
                and translate(cc.platform_username, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron_usuario
            ),
            false
          )
        )
      )
      or (d.completo_digitos is not null and (c.phone like d.completo_digitos or c.whatsapp_phone like d.completo_digitos))
    )
    and (
      d.seguimiento is null
      or (
        c.next_followup_date is not null
        and case d.seguimiento
          when 'hoy' then c.next_followup_date = d.hoy
          when 'semana' then c.next_followup_date between d.hoy and d.hoy + (7 - extract(isodow from d.hoy)::int)
          when 'vencido' then c.next_followup_date < d.hoy
          else false
        end
      )
    )
    and (d.etapa is null or c.pipeline_stage = d.etapa)
    and (
      d.setter is null
      or case d.setter when 'sin' then c.setter_id is null else c.setter_id::text = d.setter end
    )
    and (
      d.vendedor is null
      or case d.vendedor when 'sin' then c.vendedor_id is null else c.vendedor_id::text = d.vendedor end
    )
    and (
      d.etiqueta is null
      or exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id::text = d.etiqueta)
    )
    -- F43, 00051: los que escribieron al menos una vez, en cualquiera de sus
    -- conversaciones. `inbound` es el mensaje del lead; lo que escribe el
    -- negocio y sus ecos son `outbound`.
    and (
      not d.escribieron
      or exists (
        select 1 from conversations cv
        join messages m on m.conversation_id = cv.id
        where cv.contact_id = c.id and m.direction = 'inbound'
      )
    );
$$;

comment on function public.contactos_filtrados(uuid, jsonb) is
  'F43: los contactos del espacio que pasan la búsqueda (la de la bandeja sin los mensajes) y los filtros de la fila (q, seguimiento, etapa, setter, vendedor, etiqueta, escribieron, ahora). Security invoker: aplica la RLS de quien llama. Corregida en la 00050: una palabra sin coincidencia cuenta como faltante aunque el contacto tenga datos vacíos. La 00051 suma escribieron = si: solo los que tienen algún mensaje del lead (direction inbound).';
