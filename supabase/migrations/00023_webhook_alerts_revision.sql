-- ============================================================
-- REVISIÓN DE LAS ALERTAS DEL RECEPTOR (F22)
-- ============================================================
-- Tres correcciones sobre lo que dejó la 00022, que ya está aplicada y por lo
-- tanto no se toca.
--
--   1. Se borra `is_any_workspace_owner()` y su policy. Las filas de sistema
--      pasan a no tener lectura por RLS.
--   2. `record_webhook_alert` acota el `detail` y limita la frecuencia de
--      actualización de la condición de instancia desconocida.
--   3. Queda documentado por qué una condición se cierra sola y la otra no.
--
-- Idempotente: `drop ... if exists` y `create or replace`.
-- ============================================================


-- ============================================================
-- 1. AFUERA is_any_workspace_owner(): SE CONTRADECÍA CON SU PROPIO MOTIVO
-- ============================================================
-- La 00022 justificaba esa función diciendo que una instancia desconocida no es
-- atribuible a ningún workspace... y después dejaba que CUALQUIER Owner de
-- CUALQUIER workspace leyera la fila. Las dos cosas no pueden ser ciertas a la
-- vez.
--
-- Hoy no se nota porque hay un solo workspace, pero el esquema del fork es
-- multi-tenant y el proyecto decidió conservarlo intacto. Y el `detail` lleva el
-- nombre de una instancia, que en multi-tenant es de otro despliegue: es una
-- fuga entre inquilinos esperando a que exista el segundo.
--
-- DÓNDE SE LEEN AHORA. En el servidor, con el cliente de servicio y una guarda
-- de rol explícita, que es un patrón que el fork ya usa (`getWorkspaceAsManager`
-- en `lib/workspace.ts`). La autorización queda en un lugar que se lee de una
-- sola vez, en vez de en una policy que dice una cosa y significa otra.

drop policy if exists "webhook_alerts: alertas de sistema, para el owner" on webhook_alerts;
drop function if exists public.is_any_workspace_owner();

-- La policy que SÍ queda, sin cambios respecto de la 00022: las alertas con
-- workspace las leen su Owner y sus Admin. Se recrea para que esta migración se
-- pueda leer sola y para que sea idempotente.
drop policy if exists "webhook_alerts: alertas del workspace, para managers" on webhook_alerts;
create policy "webhook_alerts: alertas del workspace, para managers"
  on webhook_alerts for select to authenticated
  using (workspace_id is not null and public.is_workspace_manager(workspace_id));


-- ============================================================
-- 2. can_touch_webhook_alert SIN LA RAMA DE SISTEMA
-- ============================================================
-- Sin `is_any_workspace_owner()`, la rama de las filas sin workspace queda solo
-- para `service_role`. El cierre manual desde la pantalla de canales pasa por el
-- Server Component, que corre con el cliente de servicio después de comprobar el
-- rol, así que no necesita la rama de `authenticated`.

create or replace function public.can_touch_webhook_alert(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false)
      or (p_workspace_id is not null and public.is_workspace_manager(p_workspace_id));
$$;


-- ============================================================
-- 3. record_webhook_alert: TOPE DE ESCRITURA Y `detail` ACOTADO
-- ============================================================
-- POR QUÉ EL TOPE. El camino de instancia desconocida corre ANTES de verificar
-- el token, porque para verificarlo hay que saber qué secreto usar y eso sale
-- del canal. Consecuencia: cualquiera que mande un cuerpo bien formado con un
-- nombre inventado provoca una escritura. La tabla no crece, por el agrupado,
-- pero es una escritura por petición sobre la MISMA fila, o sea contención de
-- bloqueo sobre una fila caliente.
--
-- El tope es de una actualización por minuto y va SOLO en esa condición. En
-- `webhook_auth_failed` NO se aplica, y la asimetría es deliberada: ahí un
-- incremento sí es un mensaje perdido, porque el 401 no se reintenta, y
-- limitarlo rompería el único número de esta tabla que significa algo. Además
-- esa condición exige un `instance_name` válido para alcanzarse, así que no está
-- expuesta del mismo modo.
--
-- El contador de la condición de instancia desconocida pierde precisión, y no
-- importa: con 503 los eventos se reintentan hasta 10 veces, así que ese número
-- ya no cuenta mensajes sino intentos de entrega. Lo que hay que mirar es que la
-- condición esté abierta, no cuánto marca.
--
-- POR QUÉ `left(p_detail, 200)`. El `detail` guarda el nombre de instancia, que
-- lo elige quien llama y termina renderizado en el dashboard. El tope va del
-- lado de la base y no del receptor para que valga para cualquier llamador
-- futuro, no solo para el que hoy existe.

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

  -- ATENCIÓN: HAY DOS `where` EN ESTA SENTENCIA Y SIGNIFICAN COSAS DISTINTAS.
  --
  --   * El primero, antes del `do update`, es el PREDICADO DEL ÍNDICE. Sirve
  --     para INFERIR de qué índice estamos hablando. El índice de la 00022 es
  --     parcial y sobre una expresión, así que la inferencia tiene que
  --     reproducir las dos cosas exactas: la lista de expresiones con su
  --     `coalesce`, y el `where resolved_at is null`. Si no coinciden NO hay
  --     error de sintaxis: revienta en ejecución con el código 42P10, la primera
  --     vez que llegue un evento real.
  --
  --   * El segundo, después del `set`, es el TOPE. Decide SI se actualiza.
  insert into public.webhook_alerts as wa
    (workspace_id, channel_id, source, alert_condition, detail)
  values
    (p_workspace_id, p_channel_id, p_source, p_condition, left(p_detail, 200))
  on conflict (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    alert_condition
  )
  where resolved_at is null
  do update set
    occurrences  = wa.occurrences + 1,
    last_seen_at = now(),
    -- El detalle es siempre el de la última ocurrencia.
    detail       = excluded.detail,
    -- El canal no se pisa con un nulo: una entrega sin canal no debe borrar el
    -- que ya se había identificado.
    channel_id   = coalesce(excluded.channel_id, wa.channel_id)
  where wa.alert_condition <> 'webhook_unknown_instance'
     or wa.last_seen_at < now() - interval '1 minute'
  returning wa.id into v_id;

  -- Cuando el tope no deja pasar la actualización, no se actualiza ninguna fila
  -- y el `returning` viene vacío. Se busca el id de la condición abierta y se
  -- devuelve igual: el llamador no distingue un caso del otro, que es lo que se
  -- quiere.
  if v_id is null then
    select id into v_id
    from public.webhook_alerts
    where resolved_at is null
      and source = p_source
      and alert_condition = p_condition
      and coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  return v_id;
end;
$$;

comment on function public.record_webhook_alert(text, text, uuid, uuid, text) is
  'Abre la condición o incrementa la abierta. El detail nunca puede traer el cuerpo del aviso ni credenciales, y se acota a 200 caracteres porque lo elige quien llama. La condición webhook_unknown_instance no se actualiza más de una vez por minuto: se alcanza antes de autenticar.';


-- ============================================================
-- 4. POR QUÉ UNA CONDICIÓN SE CIERRA SOLA Y LA OTRA NO
-- ============================================================
-- Es la primera pregunta que va a hacer quien lea esto, y sin la respuesta al
-- lado parece una inconsistencia que alguien va a "arreglar".
--
-- `webhook_auth_failed` SE CIERRA SOLA cuando entra un evento válido de ese
-- workspace. La condición está atada a un workspace, que es un dato nuestro, así
-- que un evento válido de ese workspace sí prueba que la autenticación volvió a
-- funcionar.
--
-- `webhook_unknown_instance` NO TIENE CIERRE AUTOMÁTICO. Solo se cierra a mano,
-- desde la pantalla de canales.
--
-- El motivo es que el cierre automático se contradecía con la decisión de
-- agrupación de la 00022. La idea era cerrarla con un evento válido de la
-- instancia que figura en el `detail`, y no funciona, porque el `detail` guarda
-- el nombre de la ÚLTIMA instancia desconocida, no el de la que causó el
-- problema:
--
--   * Con tres nombres desconocidos, el `detail` tiene el tercero. Arreglar el
--     `instance_name` que causó el problema real no cierra nada, y la alerta
--     queda abierta después de estar resuelta.
--   * Peor: cualquier nombre basura posterior al arreglo pisa el `detail` y
--     desactiva el cierre PARA SIEMPRE. Como ese nombre lo elige quien llama,
--     desactivar el cierre queda al alcance de cualquiera que conozca la URL.
--
-- Una alerta que a veces se limpia sola y a veces no enseña a no creerle, y una
-- alarma en la que no se confía es peor que no tenerla.
--
-- `resolve_webhook_alert` no cambia: sigue existiendo para el cierre manual, y
-- para el cierre automático de `webhook_auth_failed`. Lo que cambió es quién la
-- llama, y eso vive en el receptor.

comment on table webhook_alerts is
  'Condiciones abiertas del receptor de webhooks. Una fila por condición, con contador, no una por evento. Nunca guarda el cuerpo del aviso ni credenciales. webhook_auth_failed se cierra sola con un evento válido; webhook_unknown_instance solo se cierra a mano (ver 00023).';
