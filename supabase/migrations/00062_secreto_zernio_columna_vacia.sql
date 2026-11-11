-- ============================================================
-- 00062: EL SECRETO DE FIRMA DE ZERNIO A VAULT, PASO 2 (1a; ítem 7 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- Vacía `workspaces.webhook_secret` y `channels.webhook_secret`, que cualquier
-- miembro del espacio podía leer con su sesión (§15 del plano), SOLO en los
-- espacios que ya tienen el secreto en Vault (`ws:<espacio>:zernio_webhook_secret`,
-- copiado por la 00058). Un espacio sin el secreto en Vault queda como está.
--
-- La condición del paso 2 se cumplió antes de escribir esto: el receptor de
-- producción acepta un aviso firmado con un secreto que está solo en Vault, con
-- la columna vacía, y rechaza uno firmado con otro (`scripts/verify-secreto-vault.mjs`,
-- 7 de 7, 10/11/2026 a las 18:29).
--
-- No borra las columnas: el código las sigue leyendo como respaldo (los
-- verificadores escriben ahí el secreto de sus espacios fantasma), y borrar
-- columnas del fork es otra decisión. El valor sigue en Vault y en la copia de
-- las 17:49 (`backups/copia-20261110-1749/`). Idempotente.

update public.workspaces w
set webhook_secret = null
where w.webhook_secret is not null
  and exists (
    select 1 from vault.secrets s
    where s.name = public.vault_secret_key(w.id, 'zernio_webhook_secret')
  );

update public.channels c
set webhook_secret = null
where c.webhook_secret is not null
  and exists (
    select 1 from vault.secrets s
    where s.name = public.vault_secret_key(c.workspace_id, 'zernio_webhook_secret')
  );
