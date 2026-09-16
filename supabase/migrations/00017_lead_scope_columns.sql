-- ============================================================
-- COLUMNAS DEL SCOPE DE LEADS (F3)
-- ============================================================
-- El scope duro de leads se define por asignación: un Member solo ve los
-- contactos donde figura como setter o vendedor, y las conversaciones donde
-- figura como agente asignado (`conversations.assigned_to`, que ya existe).
--
-- El documento de requerimientos ubica `setter_id` y `vendedor_id` en la
-- extensión completa de `contacts` del Bloque 3. Se adelantan acá porque sin
-- ellas las policies de F3 no se pueden escribir. El resto de los campos de
-- `contacts` sigue en el Bloque 3, en su propia migración e idempotente, así
-- que no hay conflicto con estas dos.
--
-- Idempotente: se puede correr dos veces sin efecto.
-- ============================================================

-- ── contacts: asignación ────────────────────────────────────────────────────
-- on delete set null y no cascade: si se borra el usuario, el lead se queda
-- sin asignar, no se borra el lead.

alter table contacts
  add column if not exists setter_id uuid references auth.users(id) on delete set null,
  add column if not exists vendedor_id uuid references auth.users(id) on delete set null;

comment on column contacts.setter_id is
  'Setter asignado. Define el scope de lectura del lead para un Member (F3).';
comment on column contacts.vendedor_id is
  'Vendedor asignado. Define el scope de lectura del lead para un Member (F3).';

-- ── workspaces: visibilidad de los leads sin asignar ────────────────────────
-- Por defecto false: un lead sin setter ni vendedor lo ven solo Owner y Admin.

alter table workspaces
  add column if not exists unassigned_leads_visible_to_members boolean not null default false;

comment on column workspaces.unassigned_leads_visible_to_members is
  'false (default): los leads sin asignar los ven solo Owner y Admin. true: los ve cualquier Member.';

-- ── Índices ─────────────────────────────────────────────────────────────────
-- Sin cláusula WHERE a propósito: además de resolver `setter_id = $1`, el
-- listado de contactos del Bloque 3 filtra por "sin asignar" (`is null`), y un
-- índice parcial que excluya los NULL no sirve para eso.

create index if not exists idx_contacts_setter on contacts(setter_id);
create index if not exists idx_contacts_vendedor on contacts(vendedor_id);
create index if not exists idx_conversations_assigned_to on conversations(assigned_to);
