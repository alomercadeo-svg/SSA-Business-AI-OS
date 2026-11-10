-- ============================================================
-- 00055: REGLAS DE SEGURIDAD DE SECUENCIA (F33; ítem 10 del plan maestro, 09/11/2026)
-- ============================================================
-- `channels.safety_config`, del modelo de datos del plano («Las seis reglas
-- de seguridad de secuencia»), que la 00022 dejó para el Bloque 4. Las lee y
-- las valida `lib/reglas-seguridad.ts`; el motor que las consume es de la
-- Fase 2 (§4.8).
--
-- Los valores por defecto los aprobó Marcos el 09/11/2026. Para confirmar con
-- Alejandra después de la entrega: el horario (08:00 a 20:00, lunes a sábado)
-- y el umbral de la proporción de respuesta (15 % sobre los últimos 50). El
-- opt-out no está acá: siempre está activo y no se puede apagar (la marca de
-- F34 y el disparador de la 00053).
--
-- Sin políticas nuevas: editar `channels` ya es solo de Owner y Admin
-- (00019, «channels: editar solo manager»).
--
-- Idempotente: se puede correr dos veces sin error ni cambios.

alter table public.channels
  add column if not exists safety_config jsonb not null default '{"corte_silencio": {"activo": true, "seguimientos": 3}, "texto_variable": {"rotar": true, "aviso_desde": 20}, "espaciado": {"activo": true, "min_segundos": 45, "max_segundos": 180}, "horario": {"activo": true, "desde": "08:00", "hasta": "20:00", "dias": [1, 2, 3, 4, 5, 6]}, "proporcion": {"umbral_porcentaje": 15, "muestra": 50}}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.channels'::regclass and conname = 'channels_safety_config_check'
  ) then
    alter table public.channels
      add constraint channels_safety_config_check check (jsonb_typeof(safety_config) = 'object');
  end if;
end $$;

comment on column public.channels.safety_config is
  'F33: las reglas de seguridad de secuencia del canal (corte con el silencio, texto variable, espaciado, horario y proporción de respuesta). Las valida lib/reglas-seguridad.ts; el opt-out no está acá porque no se puede apagar. El motor que las consume es de la Fase 2.';
