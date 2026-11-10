-- ============================================================
-- 00056: EL ORDEN DE CONTACTOS (F43, criterio 7; pedido por Marcos el 09/11/2026)
-- ============================================================
-- Solo reemplaza `contactos_pagina` (00049), con la MISMA firma, `security
-- invoker` y `search_path` fijo: `create or replace` conserva los permisos de
-- la 00049. `contactos_filtrados` y `contactos_cantidad` no cambian: dejan
-- pasar las claves nuevas sin mirarlas.
--
-- El orden sale de tres claves de `p_filtros`:
--   orden:   'nombre' | 'correo' | 'interaccion' | 'setter' (por defecto
--            'interaccion', el orden de antes);
--   dir:     'asc' | 'desc' (por defecto 'desc');
--   setters: los ids de los setters ya ordenados por su nombre. Lo arma la app
--            (el nombre vive en auth.users, que esta función no lee).
-- Sin las claves nuevas, responde exactamente como antes.
--
-- El nombre es el VISIBLE (decisión de la revisión de Marcos del 09/11/2026,
-- vetable), el de `lib/nombre-visible.ts`: el `display_name` sin espacios, si
-- no es el identificador crudo de alguno de sus canales; si no, el primer
-- usuario de Instagram, sin la «@»; si no, «Sin nombre», que va al final en
-- los dos sentidos. Las tildes no cambian el orden (translate; la extensión
-- `unaccent` no se usa porque no se verificó que esté instalada; la ñ queda).
-- Siempre se desempata por id en el mismo sentido: con offset, la página 2
-- sigue a la 1 sin repetir ni saltear.

create or replace function public.contactos_pagina(p_workspace uuid, p_filtros jsonb, p_pagina integer, p_por_pagina integer)
returns setof public.contacts
language sql
stable
security invoker
set search_path = public
as $$
  with pedido as (
    select
      coalesce(nullif(p_filtros->>'orden', ''), 'interaccion') as orden,
      case when p_filtros->>'dir' = 'asc' then 'asc' else 'desc' end as dir,
      coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(case when jsonb_typeof(p_filtros->'setters') = 'array' then p_filtros->'setters' else '[]'::jsonb end) x),
        '{}'::uuid[]
      ) as setters
  ),
  conclave as (
    select
      c,
      lower(translate(
        case
          when nullif(trim(c.display_name), '') is not null
            and not exists (select 1 from contact_channels cc where cc.contact_id = c.id and cc.platform_sender_id = trim(c.display_name))
          then trim(c.display_name)
          else (
            select ltrim(trim(cc.platform_username), '@')
            from contact_channels cc
            where cc.contact_id = c.id and nullif(ltrim(trim(cc.platform_username), '@'), '') is not null
            order by cc.created_at, cc.id
            limit 1
          )
        end,
        'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU'
      )) as nombre,
      lower(translate(nullif(trim(c.email), ''), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) as correo,
      array_position((select setters from pedido), c.setter_id) as setter
    from contactos_filtrados(p_workspace, p_filtros) c
  )
  select (k.c).*
  from conclave k, pedido p
  order by
    case when p.orden = 'nombre' and p.dir = 'asc' then k.nombre end asc nulls last,
    case when p.orden = 'nombre' and p.dir = 'desc' then k.nombre end desc nulls last,
    case when p.orden = 'correo' and p.dir = 'asc' then k.correo end asc nulls last,
    case when p.orden = 'correo' and p.dir = 'desc' then k.correo end desc nulls last,
    case when p.orden = 'setter' and p.dir = 'asc' then k.setter end asc nulls last,
    case when p.orden = 'setter' and p.dir = 'desc' then k.setter end desc nulls last,
    case when p.orden not in ('nombre', 'correo', 'setter') and p.dir = 'asc' then (k.c).last_interaction_at end asc nulls last,
    case when p.orden not in ('nombre', 'correo', 'setter') and p.dir = 'desc' then (k.c).last_interaction_at end desc nulls last,
    case when p.dir = 'asc' then (k.c).id end asc,
    case when p.dir = 'desc' then (k.c).id end desc
  limit least(greatest(coalesce(p_por_pagina, 50), 1), 200)
  offset (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_por_pagina, 50), 1), 200);
$$;

comment on function public.contactos_pagina(uuid, jsonb, integer, integer) is
  'F43: una página de contactos_filtrados. Ordena por p_filtros.orden (nombre visible, correo, interaccion, setter según p_filtros.setters) y p_filtros.dir; por defecto, la última interacción descendente. Sin nombre al final; las tildes no cambian el orden; desempate por id. Security invoker. Cambiada en la 00056 (el orden de Contactos, 09/11/2026).';
