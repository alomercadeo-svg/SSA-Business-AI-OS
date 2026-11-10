-- ============================================================
-- 00058: EL SECRETO DE FIRMA DE ZERNIO A VAULT, PASO 1 (1a; ítem 4 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- §15 del plano, «El Member puede leer el secreto de firma de los avisos de
-- Zernio con su propia sesión»: `workspaces.webhook_secret` lo lee cualquier
-- miembro (la política de lectura de `workspaces` es `is_workspace_member`,
-- 00002:23-25), y con ese secreto se pueden fabricar avisos firmados que el
-- receptor acepta.
--
-- Recomendación del 06/11/2026, aplicada: moverlo a Vault con el MISMO valor,
-- sin rotarlo (rotar obliga a registrar otra vez el aviso en Zernio), en dos
-- pasos como 00018 y 00021. Este es el paso 1: copia cada secreto que hoy está
-- en la columna a Vault (`ws:<espacio>:zernio_webhook_secret`, la clave de
-- `vault_secret_key` de la 00018). El código lee primero de Vault desde el
-- mismo despliegue. El paso 2, con la lectura de Vault probada en producción,
-- vacía la columna.
--
-- No toca la columna ni ninguna política. Idempotente: si el secreto ya está
-- en Vault, se actualiza con el mismo valor. Solo deja un conteo en el log,
-- nunca el valor.

do $$
declare
  r record;
  v_key text;
  v_id uuid;
  v_copiados integer := 0;
begin
  for r in
    select id, webhook_secret as val from public.workspaces
    where webhook_secret is not null and btrim(webhook_secret) <> ''
  loop
    v_key := public.vault_secret_key(r.id, 'zernio_webhook_secret');
    select id into v_id from vault.secrets where name = v_key;
    if v_id is null then
      perform vault.create_secret(r.val, v_key, 'workspace ' || r.id::text);
    else
      perform vault.update_secret(v_id, r.val);
    end if;
    v_copiados := v_copiados + 1;
  end loop;
  raise log '00058_secreto_zernio_a_vault: % secretos copiados a Vault', v_copiados;
end
$$;
