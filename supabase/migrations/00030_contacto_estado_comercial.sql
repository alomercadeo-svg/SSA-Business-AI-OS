-- ============================================================
-- ESTADO COMERCIAL HEREDADO Y AGENDA (§7.1)
-- ============================================================
-- Las diez columnas de `contacts` que §7.1 aplica "en el mismo lote que el
-- resto de las extensiones de contacts del Bloque 3, en una migración numerada
-- propia". Van en el mismo `supabase db push` que la 00029 (F25), decidido con
-- Marcos el 07/10/2026.
--
-- NO TIENEN CRITERIO PROPIO EN ESTA SESIÓN. Las siete primeras las llena la
-- migración desde Pipedrive (F38, Bloque 4); las tres de agenda, la integración
-- con Calendly de la Fase 2. Se agregan ahora para no migrar datos después.
-- Ninguna pantalla ni lógica las usa todavía.
--
-- LAS RESTRICCIONES, Y POR QUÉ UNA NO LA TIENE (§7.1):
--   - `pipeline_stage`: las 13 etapas del embudo, escritas carácter por
--     carácter como en el export, con la numeración adentro y el salto del 9
--     al 11. Es un vocabulario propio del negocio: la base garantiza que nadie
--     escriba una decimocuarta, ni "negociacion" al lado de "Negociación".
--   - `deal_status`: abierto, ganado o perdido. Es independiente de la etapa:
--     253 tratos están en "1. Nuevo contacto" y perdidos a la vez.
--   - `booking_status`: los 5 estados de la agenda.
--   - `deal_currency`: SIN restricción. Los códigos de moneda son un estándar
--     de afuera; enumerar los dos de hoy (USD, CRC) solo garantiza que la
--     importación se caiga el día que haya una campaña en otro país.
--
-- Idempotente: `add column if not exists` y `drop ... if exists` + `add`.
-- ============================================================

alter table contacts
  add column if not exists pipeline_stage text,
  add column if not exists deal_status text,
  add column if not exists deal_value numeric,
  add column if not exists deal_currency text,
  add column if not exists deal_closed_at date,
  add column if not exists pipedrive_person_id text,
  add column if not exists pipedrive_deal_id text,
  add column if not exists booking_status text,
  add column if not exists booking_at timestamptz,
  add column if not exists booking_external_id text;

alter table contacts drop constraint if exists contacts_pipeline_stage_check;
alter table contacts add constraint contacts_pipeline_stage_check check (pipeline_stage is null or pipeline_stage in (
    '1. Nuevo contacto',
    '2. Le escribí',
    '3. Respondió',
    '4. ¿Es mi cliente?',
    '5. Le ofrecí una cita',
    '6. Agendó',
    '7. Confirmó asistencia',
    '8. No llegó',
    '9. Reagendó',
    '11. Seguimiento intensivo',
    '12. En espera de pago',
    '13. ¡Cerrada!',
    '14. Repesca'
));

alter table contacts drop constraint if exists contacts_deal_status_check;
alter table contacts add constraint contacts_deal_status_check
  check (deal_status is null or deal_status in ('abierto', 'ganado', 'perdido'));

alter table contacts drop constraint if exists contacts_booking_status_check;
alter table contacts add constraint contacts_booking_status_check
  check (booking_status is null or booking_status in ('sin_agendar', 'agendada', 'asistio', 'no_asistio', 'cancelada'));

comment on column contacts.pipeline_stage is
  'Etapa del embudo heredado de Pipedrive (§7.1). Solo en contactos migrados (F38).';
comment on column contacts.deal_currency is
  'Moneda de deal_value. Sin restricción a propósito: es un estándar externo (§7.1).';
comment on column contacts.booking_status is
  'Estado de la agenda. Lo escribe la Fase 2 (Calendly).';
