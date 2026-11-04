-- ============================================================
-- LA BANDEJA USA LA BÚSQUEDA CON EL ACCESO UNA VEZ POR CONVERSACIÓN
-- (retrabajo de F35, 04/11/2026)
-- ============================================================
-- `bandeja_filtrada` (00044) pasa a llamar a `bandeja_busca_con_acceso`
-- (00045) en lugar de `bandeja_busca`. Es la misma función de la 00044, con
-- la misma firma y una sola línea distinta: la llamada a la búsqueda (lo
-- comprueba lib/bandeja-filtros-acceso-migracion.test.ts).
--
-- Antes de aplicarla, con la 00045 ya en producción (condiciones de Marcos):
-- los pasos de verify-filtros-bandeja.mjs que llaman directo a la función
-- nueva, en verde (135 de 135, 04/11/2026 12:40:29), y la equivalencia en el
-- espacio real, como el Owner y en solo lectura: con «tania», «tania
-- robles», «hola» y una palabra inexistente, las dos funciones dan las mismas
-- conversaciones (12:42:01).
--
-- Cambia el comportamiento de producción en el momento del push: la app que
-- corre ya usa `bandeja_filtrada`. La vuelta atrás está escrita aparte y sin
-- aplicar: pone `bandeja_filtrada` tal como está en la 00044.
--
-- `bandeja_busca` queda sin uso por la app, junto a las tres de la 00043.
-- Solo reemplaza una función y su comentario. Idempotente: create or replace.
-- ============================================================

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
    and (d.q is null or bandeja_busca_con_acceso(cv.id, d.q))
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

comment on function public.bandeja_filtrada(uuid, jsonb) is
  'F35: las conversaciones del espacio que pasan la búsqueda y los filtros (p_filtros, ver la 00044). «Hoy» en workspaces.zona_horaria. Busca con bandeja_busca_con_acceso (00046). Security invoker: aplica la RLS de quien llama.';
