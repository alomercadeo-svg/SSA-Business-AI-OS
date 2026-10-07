-- ============================================================
-- REGISTRO DE CORREOS ENVIADOS (F23)
-- ============================================================
-- Una fila por correo que el sistema intenta mandar por Resend. Es lo que lee
-- la pestaña «Correos enviados» de Configuración (§11), y es el criterio de F23
-- "los correos enviados quedan registrados para poder consultarlos".
--
-- LA LISTA DE TIPOS ES CERRADA, Y LA HACE CUMPLIR LA BASE. F23 dice que una
-- notificación nueva se escribe primero como criterio de la funcionalidad que
-- la dispara. El `check` de `tipo` es la traba: un tipo nuevo necesita una
-- migración, no solo código. Hoy hay dos construidos: las invitaciones y los
-- avisos de `webhook_alerts`. El fin de una importación (F37) y la caída de la
-- sesión de WhatsApp (F32) se suman cuando se construyan.
--
-- LOS ESTADOS:
--   pendiente       se está mandando, o el servidor se reinició a mitad de los
--                   reintentos (no hay tarea programada que lo retome).
--   enviado         Resend lo aceptó. `intentos` dice en cuál.
--   fallido         se agotaron los reintentos, o el error no se reintenta.
--   omitido_techo   un aviso del mismo tipo ya salió en la última hora. El
--                   aviso sigue registrado donde se originó; lo que se limita
--                   es el correo. Se guarda igual, porque es la prueba de que
--                   el techo actuó (y no de que no llegó nada).
--   omitido_prueba  todos los destinatarios eran de dominios reservados para
--                   pruebas (.local, .test, .invalid, .example), como los
--                   usuarios de los verificadores. No se intenta: rebotaría.
--
-- QUIÉN LA VE: Owner y Admin del workspace, igual que la pantalla. No hay
-- políticas de escritura: escribe solo el servidor, con la clave de servicio.
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  tipo text not null check (tipo in ('invitacion', 'alerta_webhook')),
  clave_techo text,
  alerta_id uuid references webhook_alerts(id) on delete set null,
  invite_id uuid references workspace_invites(id) on delete set null,
  para text[] not null default '{}',
  para_etiqueta text not null,
  asunto text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido', 'omitido_techo', 'omitido_prueba')),
  intentos integer not null default 0,
  ultimo_error text,
  resend_id text,
  created_at timestamptz not null default now(),
  enviado_el timestamptz
);

create index if not exists email_log_workspace_idx on email_log (workspace_id, created_at desc);
create index if not exists email_log_techo_idx on email_log (workspace_id, tipo, clave_techo, created_at desc);

comment on table email_log is
  'Correos que el sistema intenta mandar por Resend (F23). La lista de tipos es cerrada: un tipo nuevo necesita su criterio en el plano y una migración.';
comment on column email_log.para_etiqueta is
  'Lo que muestra la columna «Para»: «Owner y Admin», un nombre o la dirección.';
comment on column email_log.ultimo_error is
  'Motivo del último fallo, corto. Nunca la clave ni el cuerpo entero de la respuesta.';

alter table email_log enable row level security;

drop policy if exists "email_log: managers leen" on email_log;
create policy "email_log: managers leen"
  on email_log for select to authenticated
  using (public.is_workspace_manager(workspace_id));

-- ── El techo: un correo por tipo de aviso por hora ──────────────────────────
--
-- Atómico, porque los rechazos no vienen solos: un cambio de secreto mal hecho
-- hace fallar todas las entregas a la vez, y dos `after()` simultáneos que
-- primero consultaran y después insertaran mandarían dos correos. El candado de
-- transacción serializa por (workspace, tipo, clave) y se suelta solo al
-- terminar.
--
-- Cuenta como "ya salió" todo lo que no es una omisión: pendiente, enviado o
-- fallido. Un fallido también cuenta a propósito: si la clave de Resend está
-- mal, cada ocurrencia del aviso no tiene que gastar cuatro intentos más.
--
-- Devuelve el id de la fila y si quedó reservada para enviar. Si no, la fila
-- queda como `omitido_techo`.
create or replace function public.reservar_correo_aviso(
  p_workspace_id uuid,
  p_tipo text,
  p_clave text,
  p_alerta_id uuid,
  p_para text[],
  p_para_etiqueta text,
  p_asunto text
)
returns table (id uuid, reservado boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_ya_salio boolean;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_tipo || ':' || coalesce(p_clave, ''), 0)
  );

  select exists (
    select 1 from public.email_log e
    where e.workspace_id = p_workspace_id
      and e.tipo = p_tipo
      and e.clave_techo is not distinct from p_clave
      and e.estado in ('pendiente', 'enviado', 'fallido')
      and e.created_at > now() - interval '1 hour'
  ) into v_ya_salio;

  insert into public.email_log
    (workspace_id, tipo, clave_techo, alerta_id, para, para_etiqueta, asunto, estado)
  values
    (p_workspace_id, p_tipo, p_clave, p_alerta_id, p_para, p_para_etiqueta, p_asunto,
     case when v_ya_salio then 'omitido_techo' else 'pendiente' end)
  returning email_log.id into v_id;

  return query select v_id, not v_ya_salio;
end;
$$;

revoke all on function public.reservar_correo_aviso(uuid, text, text, uuid, text[], text, text) from public;
revoke all on function public.reservar_correo_aviso(uuid, text, text, uuid, text[], text, text) from anon, authenticated;
grant execute on function public.reservar_correo_aviso(uuid, text, text, uuid, text[], text, text) to service_role;
