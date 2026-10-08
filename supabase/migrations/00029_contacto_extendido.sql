-- ============================================================
-- MODELO DE CONTACTO EXTENDIDO (F25)
-- ============================================================
-- Las columnas de `contacts` que el negocio necesita para trabajar un lead
-- (§7.1). Todas tienen un valor por defecto o son opcionales, así que el código
-- que ya corre en producción sigue funcionando entre migrar y desplegar.
--
-- EL TELÉFONO ES E.164, Y LO HACE CUMPLIR LA BASE. §14 es la única definición:
-- signo más, código de país y número, solo dígitos, hasta 15 en total. Sin
-- mínimo: §14 no lo fija. El servidor normaliza antes de guardar
-- (`lib/telefono.ts`); el `check` existe para que ningún camino, ni uno que se
-- olvide de normalizar, pueda guardar un número sucio. Un número que no se
-- puede normalizar no se guarda: se rechaza, no se inventa.
--
-- EL TELÉFONO NO ES OBLIGATORIO. Un contacto de WhatsApp puede llegar sin
-- número (F26). `phone_resolved` marca ese caso: arranca en true, que es "no
-- hay nada pendiente", y pasa a false solo cuando WhatsApp entrega un contacto
-- sin número. Con false por defecto, los contactos de Instagram, que nunca
-- traen teléfono, aparecerían todos como "teléfono sin resolver". Lo que no
-- puede pasar es tener teléfono y estar sin resolver: lo frena un `check`.
--
-- `display_name_source`: de dónde salió el nombre. Un nombre `manual` no lo
-- pisa ningún camino automático (criterio de F25). Hoy ningún camino reescribe
-- el nombre de un contacto existente; el relleno de F27 tiene que respetarlo.
--
-- `attribution`: `{ first_click, last_click }`. `first_click` se escribe una
-- sola vez y no se modifica nunca más: es el dato de dónde salió el lead, y se
-- pierde para siempre si se sobreescribe. Lo frena un trigger, que rechaza (no
-- corrige en silencio) cualquier cambio o borrado de un `first_click` ya
-- escrito. La única excepción es la fusión de contactos de F26, que se queda
-- con el más viejo de los dos y avisa con `app.fusion_contactos`.
--
-- `instagram_username` NO está, a propósito: el handle es por canal y vive en
-- `contact_channels.platform_username` (decidido el 22/09/2026).
--
-- Los campos personalizados (`custom_fields`, `contact_custom_fields`) no se
-- tocan. Las policies de `contacts` tampoco: las columnas nuevas heredan las de
-- la 00019, y `scripts/verify-lead-scope.mjs` lo comprueba después de aplicar.
--
-- Idempotente: `add column if not exists`, `drop ... if exists` + `add`,
-- `create index if not exists` y `create or replace`.
-- ============================================================

alter table contacts
  add column if not exists phone text,
  add column if not exists phone_resolved boolean not null default true,
  add column if not exists secondary_email text,
  add column if not exists country text,
  add column if not exists whatsapp_phone text,
  add column if not exists next_followup_date date,
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists do_not_contact_reason text,
  add column if not exists do_not_contact_at timestamptz,
  add column if not exists ai_conversation_summary text,
  add column if not exists lead_temperature text,
  add column if not exists attribution jsonb not null default '{}',
  add column if not exists deleted_at timestamptz,
  add column if not exists display_name_source text not null default 'provider';

alter table contacts drop constraint if exists contacts_phone_e164_check;
alter table contacts add constraint contacts_phone_e164_check
  check (phone is null or phone ~ '^\+[1-9][0-9]{0,14}$');

alter table contacts drop constraint if exists contacts_whatsapp_phone_e164_check;
alter table contacts add constraint contacts_whatsapp_phone_e164_check
  check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{0,14}$');

alter table contacts drop constraint if exists contacts_phone_resolved_check;
alter table contacts add constraint contacts_phone_resolved_check
  check (phone is null or phone_resolved);

alter table contacts drop constraint if exists contacts_display_name_source_check;
alter table contacts add constraint contacts_display_name_source_check
  check (display_name_source in ('provider', 'manual'));

alter table contacts drop constraint if exists contacts_lead_temperature_check;
alter table contacts add constraint contacts_lead_temperature_check
  check (lead_temperature is null or lead_temperature in ('frio', 'tibio', 'caliente'));

alter table contacts drop constraint if exists contacts_attribution_object_check;
alter table contacts add constraint contacts_attribution_object_check
  check (jsonb_typeof(attribution) = 'object');

create index if not exists contacts_phone_idx on contacts (phone);
create index if not exists contacts_email_idx on contacts (email);
create index if not exists contacts_deleted_at_idx on contacts (deleted_at);
create index if not exists contacts_workspace_phone_idx on contacts (workspace_id, phone);
create index if not exists contacts_workspace_email_idx on contacts (workspace_id, email);
create index if not exists contact_channels_platform_username_idx on contact_channels (platform_username);

comment on column contacts.phone is
  'E.164 (§14): +, código de país y número, solo dígitos, hasta 15. Lo exige un check. Puede no existir.';
comment on column contacts.phone_resolved is
  'false solo si WhatsApp entregó el contacto sin número (F26). true es "nada pendiente", con o sin teléfono.';
comment on column contacts.display_name_source is
  'provider o manual. Un nombre manual no lo pisa ningún camino automático (F25).';
comment on column contacts.attribution is
  '{ first_click, last_click }. first_click no se modifica nunca (trigger), salvo en una fusión de F26.';
comment on column contacts.next_followup_date is
  'Próximo seguimiento. Fecha sin hora (§7.1): "hoy" se decide con la zona horaria del negocio.';

-- ── first_click no se modifica ───────────────────────────────────────────
create or replace function public.contacts_first_click_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.attribution ? 'first_click'
     and (new.attribution -> 'first_click') is distinct from (old.attribution -> 'first_click')
     and coalesce(current_setting('app.fusion_contactos', true), '') <> 'on' then
    raise exception 'attribution.first_click se escribe una sola vez (F25)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_first_click_inmutable on contacts;
create trigger contacts_first_click_inmutable
  before update of attribution on contacts
  for each row execute function public.contacts_first_click_inmutable();
