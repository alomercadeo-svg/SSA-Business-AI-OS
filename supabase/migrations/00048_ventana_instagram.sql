-- ============================================================
-- LA VENTANA DE CONVERSACIÓN DE INSTAGRAM (F40, S9 tramo A, 05/11/2026)
-- ============================================================
-- Dos columnas en `conversations` y el filtro de ventana de F35 en
-- `bandeja_filtrada`.
--
-- `window_expires_at`: hasta cuándo Meta deja que el sistema le envíe al lead.
-- Lo escribe el receptor de Zernio con cada mensaje del lead de Instagram: 24
-- horas desde la hora de Meta del mensaje (`sentAt`, que es `messages.created_at`),
-- y solo la adelanta (lib/ventana-instagram.ts). `window_source`: de dónde sale
-- el plazo; 'mensaje' (24 horas desde el mensaje del lead) y 'ctwa', reservado
-- para el plan B (72 horas con click-to-WhatsApp), que nadie escribe. Las dos
-- existen también en las conversaciones de WhatsApp, como pide F40, y ahí
-- quedan en null: WhatsApp por Evolution no tiene ventana.
--
-- El relleno de las conversaciones que ya existen NO va acá: es una sentencia
-- aparte, mostrada a Marcos con su md5 y su «dale» (plan de S9, tramo A).
--
-- `bandeja_filtrada` es la de la 00046 con dos agregados: la clave `ventana`
-- del jsonb ('abierta', 'por_vencer' o 'cerrada') y su condición, solo para
-- Instagram, con el reloj `ahora` (fijable desde el verificador). La misma
-- firma, security invoker; los permisos quedan los de la 00044. Lo comprueba
-- lib/ventana-instagram-migracion.test.ts.
--
-- No toca políticas. Idempotente: add column if not exists, el check con su
-- control previo, y create or replace.
-- ============================================================

alter table public.conversations add column if not exists window_expires_at timestamptz;
alter table public.conversations add column if not exists window_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_window_source_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_window_source_check
      check (window_source in ('mensaje', 'ctwa'));
  end if;
end
$$;

comment on column public.conversations.window_expires_at is
  'F40: hasta cuándo Meta deja que el sistema le envíe al lead por Instagram. 24 h desde la hora de Meta del último mensaje del lead, y solo avanza. Null: nunca escribió el lead, o WhatsApp por Evolution (sin ventana).';
comment on column public.conversations.window_source is
  'F40: de dónde sale el plazo de window_expires_at. mensaje: 24 h desde el mensaje del lead. ctwa: reservado para el plan B (72 h), sin uso.';

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
      nullif(p_filtros->>'ventana', '') as ventana,
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
    )
    and (
      d.ventana is null
      or (
        cv.platform = 'instagram'
        and case d.ventana
          when 'abierta' then cv.window_expires_at > d.ahora
          when 'por_vencer' then cv.window_expires_at > d.ahora and cv.window_expires_at <= d.ahora + interval '2 hours'
          when 'cerrada' then cv.window_expires_at is null or cv.window_expires_at <= d.ahora
          else false
        end
      )
    );
$$;

comment on function public.bandeja_filtrada(uuid, jsonb) is
  'F35: las conversaciones del espacio que pasan la búsqueda y los filtros (p_filtros, ver la 00044, y la ventana de Instagram, ver la 00048). «Hoy» en workspaces.zona_horaria. Busca con bandeja_busca_con_acceso (00046). Security invoker: aplica la RLS de quien llama.';
