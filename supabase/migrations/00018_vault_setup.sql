-- ============================================================
-- SUPABASE VAULT: FUNCIONES RPC Y COPIA DE LAS CLAVES EN TEXTO PLANO (F2)
-- ============================================================
-- El fork guarda las API keys en `workspaces.late_api_key_encrypted` y
-- `workspaces.ai_api_key`. Pese al nombre, el valor NO está encriptado: el
-- código lo lee y lo pasa directo al cliente de la API.
--
-- Esta migración es la fase de EXPANDIR de un expandir-y-contraer:
--   1. crea las funciones RPC de Vault,
--   2. COPIA los valores existentes a Vault,
--   3. NO borra ninguna columna.
-- Los dos mecanismos conviven hasta que todas las lecturas del código apunten
-- a Vault y estén probadas. El borrado va en 00021_drop_plaintext_key_columns.
-- Si la reescritura del código saliera mal, el dato viejo todavía está.
--
-- Nota sobre el nombre de la extensión: se llama `supabase_vault`, no `vault`.
-- `create extension vault` falla: no existe con ese nombre.
--
-- Idempotente: `if not exists`, `create or replace` y checks previos.
-- ============================================================

create extension if not exists supabase_vault with schema vault;

-- ============================================================
-- AISLAMIENTO POR WORKSPACE
-- ============================================================
-- Vault tiene un único espacio de nombres global con índice único en `name`.
-- El aislamiento por workspace vive en el nombre del secret: `ws:<uuid>:<nombre>`.
-- Ninguna de las tres funciones acepta un nombre crudo, así que un workspace no
-- puede nombrar el secret de otro.

create or replace function public.vault_secret_key(p_workspace_id uuid, p_secret_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'ws:' || p_workspace_id::text || ':' || p_secret_name;
$$;

comment on function public.vault_secret_key(uuid, text) is
  'Nombre del secret en Vault para un workspace. El aislamiento entre workspaces vive acá.';

-- ============================================================
-- HELPERS DE ROL
-- ============================================================
-- is_workspace_manager: Owner o Admin. Se reusa en las policies del scope de
-- leads (00019). security definer porque consulta workspace_members, cuya RLS
-- solo deja ver la fila propia.

create or replace function public.is_workspace_manager(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

comment on function public.is_workspace_manager(uuid) is
  'true si el usuario actual es owner o admin del workspace.';

-- can_manage_secrets: quién puede tocar los secrets de un workspace.
--
-- Dos casos legítimos:
--   * service_role: webhooks, cron y motor de flujos corren sin usuario. Ahí no
--     hay auth.uid() y la clave se necesita igual para poder enviar mensajes.
--   * Owner o Admin: configuran las integraciones desde la UI.
-- Un Member queda afuera, que es el criterio de F3 ("Member no accede a Vault").
--
-- auth.role() lee el claim `role` del JWT desde una GUC de la request, así que
-- no lo afecta el cambio de usuario de un security definer.

create or replace function public.can_manage_secrets(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false)
      or public.is_workspace_manager(p_workspace_id);
$$;

comment on function public.can_manage_secrets(uuid) is
  'true para service_role (webhooks, cron, motor de flujos) o para Owner/Admin del workspace.';

-- ============================================================
-- store_secret / read_secret / delete_secret
-- ============================================================
-- Las tres validan autorización antes de tocar Vault y ninguna incluye el valor
-- del secret en un mensaje de error: un error no puede ser un canal de fuga.

create or replace function public.store_secret(
  secret_name text,
  secret_value text,
  workspace_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  if workspace_id is null then
    raise exception 'store_secret: workspace_id es obligatorio' using errcode = '22023';
  end if;
  if secret_name is null or btrim(secret_name) = '' then
    raise exception 'store_secret: secret_name es obligatorio' using errcode = '22023';
  end if;
  if secret_value is null or btrim(secret_value) = '' then
    raise exception 'store_secret: secret_value no puede estar vacío' using errcode = '22023';
  end if;

  if not public.can_manage_secrets(workspace_id) then
    raise exception 'store_secret: no autorizado sobre el workspace %', workspace_id
      using errcode = '42501';
  end if;

  v_key := public.vault_secret_key(workspace_id, secret_name);

  select id into v_id from vault.secrets where name = v_key;

  if v_id is null then
    v_id := vault.create_secret(secret_value, v_key, 'workspace ' || workspace_id::text);
  else
    perform vault.update_secret(v_id, secret_value);
  end if;

  return v_id;
end;
$$;

create or replace function public.read_secret(
  secret_name text,
  workspace_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_value text;
begin
  if workspace_id is null or secret_name is null or btrim(secret_name) = '' then
    raise exception 'read_secret: workspace_id y secret_name son obligatorios' using errcode = '22023';
  end if;

  if not public.can_manage_secrets(workspace_id) then
    raise exception 'read_secret: no autorizado sobre el workspace %', workspace_id
      using errcode = '42501';
  end if;

  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where name = public.vault_secret_key(workspace_id, secret_name);

  -- null cuando no existe: el caller distingue "no configurado" de "sin permiso"
  -- (lo segundo llega como excepción).
  return v_value;
end;
$$;

create or replace function public.delete_secret(
  secret_name text,
  workspace_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if workspace_id is null or secret_name is null or btrim(secret_name) = '' then
    raise exception 'delete_secret: workspace_id y secret_name son obligatorios' using errcode = '22023';
  end if;

  if not public.can_manage_secrets(workspace_id) then
    raise exception 'delete_secret: no autorizado sobre el workspace %', workspace_id
      using errcode = '42501';
  end if;

  -- Vault 0.3.1 no expone una función de borrado: se borra la fila.
  delete from vault.secrets
  where name = public.vault_secret_key(workspace_id, secret_name);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- ============================================================
-- PERMISOS
-- ============================================================
-- `create function` otorga execute a PUBLIC por defecto, y PUBLIC incluye a
-- `anon`. Sin este revoke, cualquiera con la anon key podría invocar las
-- funciones (la autorización interna las frenaría, pero el endpoint quedaría
-- expuesto y sirviendo para sondear). Se revoca y se otorga explícito.

revoke all on function public.store_secret(text, text, uuid) from public;
revoke all on function public.read_secret(text, uuid) from public;
revoke all on function public.delete_secret(text, uuid) from public;
revoke all on function public.can_manage_secrets(uuid) from public;

grant execute on function public.store_secret(text, text, uuid) to authenticated, service_role;
grant execute on function public.read_secret(text, uuid) to authenticated, service_role;
grant execute on function public.delete_secret(text, uuid) to authenticated, service_role;
grant execute on function public.can_manage_secrets(uuid) to authenticated, service_role;

grant execute on function public.is_workspace_manager(uuid) to authenticated, service_role;
grant execute on function public.vault_secret_key(uuid, text) to authenticated, service_role;

-- ============================================================
-- COPIA DE LAS CLAVES EN TEXTO PLANO A VAULT
-- ============================================================
-- Dinámico con `execute` para que el bloque no falle si las columnas ya no
-- existen (por ejemplo al reconstruir la base después del 00021).
-- No pasa por store_secret: acá no hay JWT, corre como el dueño de la migración.

do $$
declare
  v_has_late boolean;
  v_has_ai boolean;
  r record;
  v_key text;
  v_id uuid;
  v_copiados integer := 0;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces'
      and column_name = 'late_api_key_encrypted'
  ) into v_has_late;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces'
      and column_name = 'ai_api_key'
  ) into v_has_ai;

  if v_has_late then
    for r in execute
      'select id, late_api_key_encrypted as val from public.workspaces'
      || ' where late_api_key_encrypted is not null and btrim(late_api_key_encrypted) <> '''''
    loop
      v_key := public.vault_secret_key(r.id, 'zernio_api_key');
      select id into v_id from vault.secrets where name = v_key;
      if v_id is null then
        perform vault.create_secret(r.val, v_key, 'workspace ' || r.id::text);
      else
        perform vault.update_secret(v_id, r.val);
      end if;
      v_copiados := v_copiados + 1;
    end loop;
  end if;

  if v_has_ai then
    for r in execute
      'select id, ai_api_key as val from public.workspaces'
      || ' where ai_api_key is not null and btrim(ai_api_key) <> '''''
    loop
      v_key := public.vault_secret_key(r.id, 'ai_gateway_api_key');
      select id into v_id from vault.secrets where name = v_key;
      if v_id is null then
        perform vault.create_secret(r.val, v_key, 'workspace ' || r.id::text);
      else
        perform vault.update_secret(v_id, r.val);
      end if;
      v_copiados := v_copiados + 1;
    end loop;
  end if;

  -- Solo el conteo: el valor nunca va a un log.
  raise log '00018_vault_setup: % claves copiadas a Vault', v_copiados;
end
$$;
