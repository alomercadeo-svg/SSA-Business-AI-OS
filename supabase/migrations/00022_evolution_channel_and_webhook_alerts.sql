-- ============================================================
-- CANAL DE EVOLUTION Y ALERTAS DEL RECEPTOR DE WEBHOOKS (F21, F22)
-- ============================================================
-- Dos cosas que van juntas porque el receptor de Evolution necesita las dos
-- para funcionar: saber de qué canal viene un aviso, y poder gritar cuando no
-- lo puede saber.
--
-- Idempotente: `if not exists`, `create or replace`, `drop ... if exists` y
-- bloques `do $$` con checks previos.
-- ============================================================


-- ============================================================
-- PARTE 1: EL CANAL DE EVOLUTION
-- ============================================================
-- El aviso que manda Evolution trae el nombre de la instancia y nada más que
-- identifique al canal. El receptor tiene que ir de ese nombre al canal, y del
-- canal al workspace, porque el secreto con el que se verifica la firma vive en
-- Vault bajo `ws:<workspace_id>:<nombre>`. Sin este mapeo no hay autenticación
-- posible.
--
-- ALCANCE: solo las tres columnas que esa búsqueda necesita. `session_state`,
-- `session_checked_at` y `safety_config` están en el modelo de datos del plano
-- pero pertenecen al Bloque 4, junto con las funcionalidades que las usan.

alter table channels add column if not exists provider text not null default 'zernio';

-- `drop` + `add` porque `add constraint` no es idempotente. Mismo patrón que la
-- 00016 usó para la lista de plataformas.
alter table channels drop constraint if exists channels_provider_check;
alter table channels add constraint channels_provider_check
  check (provider in ('zernio', 'evolution'));

alter table channels add column if not exists instance_name text;

-- POR QUÉ EL ÍNDICE ES GLOBAL Y NO POR WORKSPACE
-- La búsqueda instancia -> canal -> workspace está en el camino que autentica
-- cada mensaje entrante. Si dos canales pudieran compartir nombre de instancia,
-- esa búsqueda sería ambigua y habría que elegir uno, que es exactamente la
-- clase de decisión que no se puede tomar en un camino de autenticación.
-- Además los nombres de instancia son globales del lado de Evolution, así que
-- un índice por workspace estaría permitiendo algo que el proveedor no permite.
create unique index if not exists channels_instance_name_key
  on channels (instance_name) where instance_name is not null;

-- POR QUÉ `late_account_id` DEJA DE SER OBLIGATORIO
-- Un canal de Evolution no tiene cuenta de Zernio. El valor correcto es vacío.
-- La alternativa era meter el nombre de la instancia en una columna que dice
-- "late_account_id", y esa clase de atajo es la que produjo
-- `late_api_key_encrypted`: una columna que decía "encrypted" y guardaba texto
-- plano. Costó dos sesiones deshacerla.
--
-- La restricción `unique (workspace_id, late_account_id)` de la 00001 sigue en
-- pie y sigue sirviendo: Postgres trata los NULL como distintos entre sí, así
-- que varios canales de Evolution conviven sin chocar. Lo que los desambigua es
-- el índice de arriba.
--
-- OJO, ESTO DESTAPA UN ERROR LATENTE EN EL CÓDIGO HEREDADO, corregido en el
-- mismo commit: el bucle de `app/api/v1/channels/sync/route.ts` que desactiva
-- canales cuyas cuentas de Zernio ya no existen compara contra un Set de
-- identificadores. Con el valor en nulo, `Set.has(null)` da false siempre, así
-- que cada vez que alguien apretara "Sincronizar" el canal de WhatsApp quedaría
-- con `is_active = false`, y a partir de ahí el receptor rechazaría todos los
-- mensajes entrantes sin ningún síntoma.
alter table channels alter column late_account_id drop not null;

comment on column channels.provider is
  'Quién opera el canal: zernio (API oficial de Meta) o evolution (WhatsApp autoalojado).';
comment on column channels.instance_name is
  'Nombre de la instancia de Evolution. Único global: es la clave de búsqueda del receptor de webhooks.';
comment on column channels.late_account_id is
  'Id de cuenta de Zernio. Nulo en los canales de Evolution, que no tienen cuenta de Zernio.';


-- ============================================================
-- PARTE 2: ALERTAS DEL RECEPTOR DE WEBHOOKS
-- ============================================================
-- POR QUÉ ESTA TABLA EXISTE
-- Verificado en el código de Evolution 2.3.7 (ver docs/investigacion-evolution-api.md):
-- los códigos 400, 401, 403, 404 y 422 están en la lista por defecto de
-- `WEBHOOK_RETRY_NON_RETRYABLE_STATUS_CODES`. Cuando el receptor devuelve
-- cualquiera de ellos, Evolution registra el error, CORTA LOS REINTENTOS y
-- descarta el evento. No hay cola de reproceso. El mensaje del lead se perdió y
-- no hay ningún síntoma.
--
-- Con Zernio un 401 es ruido esperable de internet. Acá es la señal de que
-- estamos perdiendo mensajes, y por eso necesita alerta.
--
-- POR QUÉ NO SE REUSA `audit_log`, que es la alternativa obvia y alguien la va
-- a proponer:
--   * El historial de auditoría responde "quién hizo qué". Un rechazo de
--     autenticación no tiene autor: el que lo provocó es justamente el que no
--     pudo identificarse.
--   * El audit log no se purga nunca, por diseño. Un cambio de secreto mal
--     hecho lo llenaría para siempre con el mismo evento repetido miles de
--     veces, y eso degrada la herramienta que sí necesitamos que sea confiable.
--
-- POR QUÉ SE AGRUPA POR CONDICIÓN Y NO POR EVENTO
-- Un rechazo nunca viene solo. Los tres escenarios donde ocurre (un cambio de
-- secreto mal hecho, el mecanismo `jwt_key` desapareciendo en una actualización
-- de Evolution, una configuración equivocada) hacen que fallen TODOS los
-- mensajes hasta que alguien intervenga. Si entran 500 mensajes en una hora,
-- eso tiene que ser una fila con `occurrences = 500`, no 500 filas.

create table if not exists webhook_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  channel_id uuid references channels(id) on delete set null,
  source text not null,
  alert_condition text not null,
  detail text,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- `alert_condition` y no `condition`: CONDITION es palabra reservada de
-- PL/pgSQL (`declare ... condition`), y estas funciones son plpgsql. El nombre
-- feo evita un fallo de aplicación por una ambigüedad que no se ve al leer.
--
-- `workspace_id` y `channel_id` son NULLABLE a propósito, y no por comodidad:
-- la condición `webhook_unknown_instance` se dispara cuando llega un aviso para
-- una instancia que no existe en nuestra base. Ahí no hay canal, así que no hay
-- workspace al que atribuirlo. Ver la política de lectura más abajo, que es
-- donde esa decisión tiene consecuencias.

comment on table webhook_alerts is
  'Condiciones abiertas del receptor de webhooks. Una fila por condición, con contador, no una por evento. Nunca guarda el cuerpo del aviso ni credenciales.';
comment on column webhook_alerts.source is
  'Proveedor del webhook: por ahora solo evolution.';
comment on column webhook_alerts.alert_condition is
  'webhook_auth_failed (firma rechazada) o webhook_unknown_instance (aviso para una instancia desconocida).';
comment on column webhook_alerts.detail is
  'Motivo corto, legible. PROHIBIDO: el cuerpo del aviso, el token, la API key de la instancia.';

-- LA CLAVE DE AGRUPACIÓN, Y POR QUÉ LLEVA UN `coalesce`
-- Con `workspace_id` nullable, un índice único común trata los NULL como
-- distintos entre sí, así que cada aviso de instancia desconocida abriría su
-- propia fila: exactamente el desborde que esta tabla existe para evitar. El
-- `coalesce` los colapsa a un valor único.
--
-- Se usa `coalesce` y no `nulls not distinct` (Postgres 15+) para no atar la
-- migración a una versión del motor.
--
-- El nombre de la instancia NO entra en la clave. Lo controla quien llama, así
-- que agrupar por él permitiría llenar la tabla mandando nombres al azar. Todas
-- las instancias desconocidas van a una sola condición abierta, y el nombre
-- queda solo en el `detail` de la última.
create unique index if not exists webhook_alerts_open_condition_key
  on webhook_alerts (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    alert_condition
  )
  where resolved_at is null;

create index if not exists webhook_alerts_open_idx
  on webhook_alerts (last_seen_at desc) where resolved_at is null;


-- ============================================================
-- QUIÉN PUEDE LEER LAS ALERTAS
-- ============================================================
-- is_any_workspace_owner: Owner de algún workspace, sin importar cuál.
--
-- Existe por un motivo puntual y fácil de pasar por alto: la condición
-- `webhook_unknown_instance` tiene `workspace_id` en nulo por definición, y
-- `is_workspace_manager(null)` no encuentra membresía para NADIE. Con una sola
-- política, esa fila se registraría correctamente, con su contador y su
-- agrupación perfectos, y no la podría leer ninguna persona: ni el Owner, ni el
-- indicador de la pantalla de canales. La alerta existiría y no alertaría a
-- nadie.
--
-- Se trata como alerta de sistema. En single-tenant eso es exactamente lo
-- correcto; y si alguna vez hubiera varios workspaces, una instancia
-- desconocida no es atribuible a ninguno, así que tampoco debería mostrarse a
-- todos.
--
-- security definer por el mismo motivo que is_workspace_manager: la RLS de
-- workspace_members solo deja ver la fila propia.
create or replace function public.is_any_workspace_owner()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where user_id = auth.uid()
      and role = 'owner'
  );
$$;

comment on function public.is_any_workspace_owner() is
  'true si el usuario actual es owner de algún workspace. Para alertas de sistema, que no tienen workspace al que atribuirse.';

revoke all on function public.is_any_workspace_owner() from public;
grant execute on function public.is_any_workspace_owner() to authenticated, service_role;

alter table webhook_alerts enable row level security;

-- Dos políticas, una por clase de alerta. Se escriben separadas en vez de
-- juntarlas en un `or` para que cada una se lea sola y no haya que desarmar una
-- condición compuesta para entender quién ve qué.
drop policy if exists "webhook_alerts: alertas del workspace, para managers" on webhook_alerts;
create policy "webhook_alerts: alertas del workspace, para managers"
  on webhook_alerts for select to authenticated
  using (workspace_id is not null and public.is_workspace_manager(workspace_id));

drop policy if exists "webhook_alerts: alertas de sistema, para el owner" on webhook_alerts;
create policy "webhook_alerts: alertas de sistema, para el owner"
  on webhook_alerts for select to authenticated
  using (workspace_id is null and public.is_any_workspace_owner());

-- Sin políticas de insert, update ni delete: nadie escribe esta tabla
-- directamente. Se escribe por las dos funciones de abajo, que son
-- security definer y validan quién llama.


-- ============================================================
-- record_webhook_alert / resolve_webhook_alert
-- ============================================================

-- can_touch_webhook_alert: la autorización compartida por las dos funciones.
-- Mismo criterio que la lectura, más service_role, que es quien corre el
-- receptor y no tiene auth.uid().
create or replace function public.can_touch_webhook_alert(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false)
      or (p_workspace_id is not null and public.is_workspace_manager(p_workspace_id))
      or (p_workspace_id is null and public.is_any_workspace_owner());
$$;

revoke all on function public.can_touch_webhook_alert(uuid) from public;
grant execute on function public.can_touch_webhook_alert(uuid) to authenticated, service_role;

-- Abre la condición o incrementa la que ya está abierta. Un solo upsert
-- atómico: dos entregas simultáneas no pueden abrir dos filas.
create or replace function public.record_webhook_alert(
  p_source text,
  p_condition text,
  p_workspace_id uuid default null,
  p_channel_id uuid default null,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'record_webhook_alert: source es obligatorio' using errcode = '22023';
  end if;
  if p_condition is null or btrim(p_condition) = '' then
    raise exception 'record_webhook_alert: condition es obligatorio' using errcode = '22023';
  end if;

  if not public.can_touch_webhook_alert(p_workspace_id) then
    raise exception 'record_webhook_alert: no autorizado' using errcode = '42501';
  end if;

  insert into public.webhook_alerts as wa
    (workspace_id, channel_id, source, alert_condition, detail)
  values
    (p_workspace_id, p_channel_id, p_source, p_condition, p_detail)
  on conflict (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    alert_condition
  )
  where resolved_at is null
  do update set
    occurrences  = wa.occurrences + 1,
    last_seen_at = now(),
    -- El detalle es siempre el de la última ocurrencia: para la condición de
    -- instancia desconocida, ese es el único lugar donde queda el nombre.
    detail       = excluded.detail,
    -- El canal no se pisa con un nulo: una entrega sin canal no debe borrar el
    -- que ya se había identificado.
    channel_id   = coalesce(excluded.channel_id, wa.channel_id)
  returning wa.id into v_id;

  return v_id;
end;
$$;

comment on function public.record_webhook_alert(text, text, uuid, uuid, text) is
  'Abre la condición o incrementa la abierta. El detail nunca puede traer el cuerpo del aviso ni credenciales.';

-- Cierra la condición. Devuelve cuántas filas cerró, así que 0 significa "no
-- había ninguna abierta" y el llamador puede distinguirlo.
--
-- `p_detail_match` es lo que hace que la condición de instancia desconocida se
-- cierre con precisión: solo la cierra un aviso válido de LA instancia que
-- figura en el detalle, que es la prueba de que el renombre o la fila del canal
-- se arreglaron. Un aviso válido de otra instancia no prueba nada sobre esta y
-- no la toca.
create or replace function public.resolve_webhook_alert(
  p_source text,
  p_condition text,
  p_workspace_id uuid default null,
  p_detail_match text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cerradas integer;
begin
  if not public.can_touch_webhook_alert(p_workspace_id) then
    raise exception 'resolve_webhook_alert: no autorizado' using errcode = '42501';
  end if;

  update public.webhook_alerts
  set resolved_at = now()
  where resolved_at is null
    and source = p_source
    and alert_condition = p_condition
    and coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (p_detail_match is null or detail = p_detail_match);

  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

comment on function public.resolve_webhook_alert(text, text, uuid, text) is
  'Cierra la condición abierta. Devuelve cuántas cerró. Con p_detail_match solo cierra la que coincide, para que un aviso de otra instancia no apague una alerta que sigue vigente.';

revoke all on function public.record_webhook_alert(text, text, uuid, uuid, text) from public;
revoke all on function public.resolve_webhook_alert(text, text, uuid, text) from public;

-- `record` solo lo llama el receptor, que corre como service_role. `resolve` lo
-- llama el receptor y también una persona desde la pantalla de canales, para
-- que el caso nunca quede trabado si la condición dejó de ocurrir y nadie mandó
-- un aviso válido que la cierre sola.
grant execute on function public.record_webhook_alert(text, text, uuid, uuid, text) to service_role;
grant execute on function public.resolve_webhook_alert(text, text, uuid, text) to authenticated, service_role;
