-- ============================================================
-- LA BÚSQUEDA DE LA BANDEJA, CON EL ACCESO UNA VEZ POR CONVERSACIÓN
-- (retrabajo de F35, 04/11/2026)
-- ============================================================
-- La búsqueda de la 00044 (`bandeja_busca`) es security invoker: cada
-- mensaje que lee pasa por la política de `messages`, que consulta
-- `conversations` y paga su política también. Medido ese día en el espacio
-- real, en transacción de solo lectura, como el Owner: contar los 4650
-- mensajes tarda unos 2,7 s con la seguridad por filas y 3 ms sin ella, y la
-- búsqueda entera unos 3,1 s por llamada.
--
-- Esta función hace la misma búsqueda comprobando el acceso UNA vez por
-- conversación y una vez por contacto, y después lee los mensajes, el
-- contacto y sus canales sin la seguridad por filas. Para eso es SECURITY
-- DEFINER, con `search_path` vacío y todo calificado.
--
-- NO REESCRIBE LA LÓGICA DE ACCESO: llama a `public.can_see_conversation` y
-- a `public.can_see_contact` tal como están (00019). Lo único que repite de
-- las políticas son las condiciones de `deleted_at`:
--   1. La conversación, `deleted_at is null`: política de lectura de
--      `conversations`, 00038:70-71.
--   2. El contacto, `deleted_at is null`: política de lectura de `contacts`,
--      00038:59-60.
--   3. Los mensajes: la política de lectura de `messages` (00019:231-238)
--      consulta `conversations`, que aplica la suya; hereda la condición 1.
--   4. Los canales del contacto: la política de lectura de
--      `contact_channels` (00019:263-271) consulta `contacts`, que aplica la
--      suya; hereda la condición 2.
-- Si una de esas políticas cambia, esta función tiene que revisarse: lo
-- frena lib/guardia-politicas.test.ts para las migraciones posteriores a la
-- 00046.
--
-- No recibe el contacto: lo lee de la conversación, así nadie la apunta a un
-- contacto ajeno. Si quien llama no puede ver la conversación, da falso sin
-- leer nada más: no sirve para preguntar por conversaciones ajenas.
--
-- Hace lo mismo que `bandeja_busca` cuando la conversación es visible (lo
-- comprueba la equivalencia del 04/11/2026 en el espacio real): cada palabra
-- en algún dato del contacto, si el contacto es visible; lo buscado completo
-- como teléfono; o todas las palabras en un mismo mensaje. Sin mayúsculas ni
-- tildes (la ñ intacta). Los comodines de LIKE se escapan.
--
-- Nada la usa todavía: la conecta la 00046, si los pasos del verificador y
-- la equivalencia dan verde. Solo crea la función y le da permisos.
-- Idempotente: create or replace.
-- ============================================================

create or replace function public.bandeja_busca_con_acceso(p_conversacion uuid, p_busqueda text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with cv as (
    -- La conversación, si quien llama la puede ver (condición 1).
    select c.id, c.contact_id
    from public.conversations c
    where c.id = p_conversacion
      and c.deleted_at is null
      and public.can_see_conversation(c.workspace_id, c.assigned_to, c.contact_id)
  ),
  ct as (
    -- Su contacto, si quien llama lo puede ver (condición 2).
    select k.*
    from public.contacts k, cv
    where k.id = cv.contact_id
      and k.deleted_at is null
      and public.can_see_contact(k.workspace_id, k.setter_id, k.vendedor_id)
  ),
  q as (
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
  )
  select exists (select 1 from cv) and exists (select 1 from palabras) and (
    -- Cada palabra está en algún dato del contacto (condiciones 2 y 4).
    (
      exists (select 1 from ct)
      and not exists (
        select 1 from palabras w
        where not exists (
          select 1 from ct
          where translate(ct.display_name, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(ct.email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or translate(ct.secondary_email, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron
            or (w.patron_digitos is not null and (ct.phone like w.patron_digitos or ct.whatsapp_phone like w.patron_digitos))
            or exists (
              select 1 from public.contact_channels cc
              where cc.contact_id = ct.id
                and translate(cc.platform_username, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron_usuario
            )
        )
      )
    )
    -- Lo buscado completo, como un solo teléfono.
    or exists (
      select 1 from ct, completo
      where completo.patron_digitos is not null
        and (ct.phone like completo.patron_digitos or ct.whatsapp_phone like completo.patron_digitos)
    )
    -- Un mismo mensaje de la conversación tiene todas las palabras (condición 3).
    or exists (
      select 1 from public.messages m, cv
      where m.conversation_id = cv.id
        and m.text is not null
        and not exists (
          select 1 from palabras w
          where not (translate(m.text, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu') ilike w.patron)
        )
    )
  );
$$;

revoke all on function public.bandeja_busca_con_acceso(uuid, text) from public, anon;
grant execute on function public.bandeja_busca_con_acceso(uuid, text) to authenticated;

comment on function public.bandeja_busca_con_acceso(uuid, text) is
  'F35 (retrabajo, 04/11/2026): la búsqueda de bandeja_busca, comprobando el acceso una vez por conversación con can_see_conversation y can_see_contact. Security definer, search_path vacío. Repite de las políticas solo deleted_at: conversations 00038:70-71, contacts 00038:59-60, y heredadas, messages 00019:231-238 y contact_channels 00019:263-271.';
