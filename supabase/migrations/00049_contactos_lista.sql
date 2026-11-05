-- ============================================================
-- LA LISTA DE CONTACTOS COMPLETA (F43, S9 tramo B, 05/11/2026)
-- ============================================================
-- Hasta acá la lista de Contactos traía los primeros 100 por interacción y
-- buscaba en el navegador, sobre esos 100. Estas tres funciones la llevan al
-- servidor: la búsqueda y los filtros de la fila (seguimiento, etapa, setter,
-- vendedor y etiqueta) sobre todos los contactos del alcance de quien mira,
-- por páginas numeradas.
--
-- SECURITY INVOKER: la seguridad por filas de `contacts` (00038:58-60) y de
-- `contact_channels` (00019:263-271) es la de quien llama. Lo eliminado lo
-- oculta la política de `contacts`.
--
-- La búsqueda es la de la bandeja (bandeja_busca_con_acceso, 00045:71-113),
-- sin la parte de los mensajes, aplicada a la fila del contacto de la
-- consulta (no vuelve a leerlo por id): cada palabra en algún dato del
-- contacto (nombre, correo, correo secundario, usuario de Instagram sin «@»,
-- teléfono por dígitos), o lo buscado completo como un solo teléfono. Sin
-- mayúsculas ni tildes (la ñ intacta). Los comodines de LIKE se escapan.
--
-- Claves de p_filtros: q; seguimiento (hoy, semana, vencido; las de F35,
-- copiadas de bandeja_filtrada, 00048); etapa (pipeline_stage, exacta);
-- setter y vendedor ('sin' o el id); etiqueta (el id); ahora (el reloj, que
-- solo manda el verificador). «Hoy» en workspaces.zona_horaria.
--
-- Solo crea funciones y les da permisos. No toca políticas ni tablas.
-- Idempotente: create or replace.
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
          where not (
            translate(c.display_name, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
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
    );
$$;

create or replace function public.contactos_pagina(p_workspace uuid, p_filtros jsonb, p_pagina integer, p_por_pagina integer)
returns setof public.contacts
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
  from contactos_filtrados(p_workspace, p_filtros) c
  order by c.last_interaction_at desc nulls last, c.id desc
  limit least(greatest(coalesce(p_por_pagina, 50), 1), 200)
  offset (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_por_pagina, 50), 1), 200);
$$;

create or replace function public.contactos_cantidad(p_workspace uuid, p_filtros jsonb)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*) from contactos_filtrados(p_workspace, p_filtros);
$$;

revoke all on function public.contactos_filtrados(uuid, jsonb) from public, anon;
grant execute on function public.contactos_filtrados(uuid, jsonb) to authenticated;
revoke all on function public.contactos_pagina(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.contactos_pagina(uuid, jsonb, integer, integer) to authenticated;
revoke all on function public.contactos_cantidad(uuid, jsonb) from public, anon;
grant execute on function public.contactos_cantidad(uuid, jsonb) to authenticated;

comment on function public.contactos_filtrados(uuid, jsonb) is
  'F43: los contactos del espacio que pasan la búsqueda (la de la bandeja sin los mensajes) y los filtros de la fila (q, seguimiento, etapa, setter, vendedor, etiqueta, ahora). Security invoker: aplica la RLS de quien llama.';
comment on function public.contactos_pagina(uuid, jsonb, integer, integer) is
  'F43: una página de contactos_filtrados, por interacción más reciente (nulos al final) e id. Página desde 1, con tamaño entre 1 y 200, 50 por defecto.';
comment on function public.contactos_cantidad(uuid, jsonb) is
  'F43: cuántos contactos pasan contactos_filtrados, dentro del alcance de quien llama.';
