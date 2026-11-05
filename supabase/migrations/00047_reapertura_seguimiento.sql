-- ============================================================
-- LA REAPERTURA EL DÍA DEL PRÓXIMO SEGUIMIENTO (F35, tramo D de S8)
-- ============================================================
-- Una conversación cerrada se reabre sola el día del próximo seguimiento de
-- su contacto, en la zona horaria del negocio. La llama la tarea programada
-- (lib/tareas-programadas.ts, cada 10 minutos) una vez por espacio, con el
-- reloj de la corrida; el verificador (scripts/verify-estados-bandeja.mjs) la
-- llama con el reloj fijo.
--
-- QUÉ REABRE: las conversaciones del espacio cerradas y no eliminadas cuyo
-- contacto, no eliminado, tiene next_followup_date MENOR O IGUAL a hoy. «Menor
-- o igual» y no «igual» (decidido por Marcos al aprobar el plan, 04/11/2026):
-- una corrida que faltó no deja una sin reabrir. Si el contacto tiene más de
-- una conversación, las reabre todas.
--
-- «HOY» es el día de p_ahora en workspaces.zona_horaria, con el mismo
-- coalesce que los filtros de la bandeja (00046:50-53): «Vence hoy» y esta
-- reapertura no pueden tener dos días distintos.
--
-- SECURITY INVOKER, con search_path vacío, y la ejecuta solo service_role: es
-- del servidor. Ningún usuario la llama. No toca ninguna política.
--
-- Devuelve los ids que reabrió. Idempotente: create or replace.
-- ============================================================

create or replace function public.reabrir_por_seguimiento(p_workspace uuid, p_ahora timestamptz default now())
returns table (id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.conversations cv
     set status = 'open'
    from public.contacts ct
   where cv.workspace_id = p_workspace
     and cv.status = 'closed'
     and cv.deleted_at is null
     and ct.id = cv.contact_id
     and ct.deleted_at is null
     and ct.next_followup_date <= (p_ahora at time zone coalesce((select w.zona_horaria from public.workspaces w where w.id = p_workspace), 'America/Costa_Rica'))::date
  returning cv.id;
$$;

revoke all on function public.reabrir_por_seguimiento(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reabrir_por_seguimiento(uuid, timestamptz) to service_role;

comment on function public.reabrir_por_seguimiento(uuid, timestamptz) is
  'F35 (tramo D de S8, 04/11/2026): reabre las conversaciones cerradas y no eliminadas del espacio cuyo contacto (no eliminado) tiene next_followup_date <= hoy, con hoy en workspaces.zona_horaria (el mismo coalesce de los filtros, 00046). Devuelve los ids reabiertos. Security invoker, search_path vacío, solo service_role. La llama lib/tareas-programadas.ts.';
