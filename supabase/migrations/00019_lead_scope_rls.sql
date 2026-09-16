-- ============================================================
-- SCOPE DURO DE LEADS POR RLS (F3)
-- ============================================================
-- La 00017 agregó `contacts.setter_id`, `contacts.vendedor_id` y el flag
-- `workspaces.unassigned_leads_visible_to_members`. Esta migración es la que
-- los convierte en una regla que la base hace cumplir.
--
-- POR QUÉ REEMPLAZAR Y NO AGREGAR
-- Las policies del fork son `for all using (is_workspace_member(...))`. Las
-- policies permisivas se combinan con OR: agregar una policy restrictiva al
-- lado de una permisiva no restringe nada, porque alcanza con que una de las
-- dos deje pasar la fila. Por eso cada bloque de acá abajo hace `drop policy`
-- antes del `create policy`. Si el drop se olvida, la migración "aplica" sin
-- errores y el scope sigue abierto: es el modo de fallar más peligroso de todo
-- este archivo.
--
-- Idempotente: `create or replace` para las funciones y `drop policy if exists`
-- + `create policy` para las policies. `create policy` no admite
-- `if not exists`, así que el par es la única forma de que correrla dos veces
-- no falle.
-- ============================================================

-- ============================================================
-- 1. FUNCIONES
-- ============================================================
-- Las tres son `security definer`: corren como el dueño de las tablas, que no
-- está sujeto a RLS. Eso es lo que evita la recursión infinita cuando la policy
-- de `conversations` necesita leer `contacts`, que a su vez tiene policy. Es el
-- mismo mecanismo con el que el fork evita la recursión en `workspace_members`.
--
-- `auth.uid()` va siempre como `(select auth.uid())`. Envuelto en un subselect
-- el planner lo evalúa una vez como InitPlan en lugar de una vez por fila.

-- ── is_workspace_member: se redefine, no se recrea ──────────────────────────
-- `create or replace` conserva el OID, así que las ~30 policies del fork que la
-- referencian (flows, tags, broadcasts, triggers, custom fields, channels...)
-- siguen funcionando sin tocarlas. La firma NO se puede cambiar por eso mismo.
--
-- El único cambio real es `set search_path = ''` y el nombre calificado. Sin
-- search_path fijo, una función `security definer` resuelve nombres contra el
-- search_path de quien la llama, que un atacante con permiso de crear esquemas
-- puede manipular para que `workspace_members` apunte a una tabla suya.

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = (select auth.uid())
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'true si el usuario actual pertenece al workspace, con cualquier rol.';

-- ── can_see_contact ─────────────────────────────────────────────────────────
-- Argumentos sueltos y no la fila entera. El criterio de F3 la describe como
-- `can_see_contact(contact_row)`; el desvío está documentado en
-- docs/requerimientos-fase1.md. En resumen: una función `security definer` no
-- se inlinea nunca, así que con cualquiera de las dos firmas la policy se
-- evalúa fila por fila; recibir la fila completa solo agrega el costo de armar
-- un valor compuesto por fila y ata la firma al rowtype de `contacts`, que el
-- Bloque 3 extiende.
--
-- El orden de las ramas es la regla de negocio:
--   1. No es miembro del workspace            → no ve nada.
--   2. Es Owner o Admin                       → ve todo el workspace.
--   3. Es el setter o el vendedor             → ve ese lead.
--   4. El lead no tiene ninguno de los dos    → decide el flag del workspace.
--   5. Resto                                  → no lo ve.
--
-- La rama 4 es solo para leads sin NINGUNA asignación. Un lead con setter ajeno
-- y vendedor vacío no es "sin asignar": cae en la rama 5.

create or replace function public.can_see_contact(
  p_workspace_id uuid,
  p_setter_id uuid,
  p_vendedor_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.is_workspace_member(p_workspace_id) then false
    when public.is_workspace_manager(p_workspace_id) then true
    when p_setter_id = (select auth.uid()) then true
    when p_vendedor_id = (select auth.uid()) then true
    when p_setter_id is null and p_vendedor_id is null then
      coalesce(
        (select w.unassigned_leads_visible_to_members
           from public.workspaces w
          where w.id = p_workspace_id),
        false
      )
    else false
  end;
$$;

comment on function public.can_see_contact(uuid, uuid, uuid) is
  'Scope de lectura de un lead: manager ve todo, Member solo donde es setter o vendedor, y los sin asignar según el flag del workspace.';

-- ── can_see_conversation ────────────────────────────────────────────────────
-- El orden importa y no es intercambiable: `assigned_to` se evalúa ANTES de
-- delegar en el contacto. Una conversación asignada a un Member sobre un lead
-- sin asignar tiene que verse aunque el flag esté en false; si el contacto se
-- consultara primero, el flag ganaría y el agente perdería su propia
-- conversación.

create or replace function public.can_see_conversation(
  p_workspace_id uuid,
  p_assigned_to uuid,
  p_contact_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.is_workspace_member(p_workspace_id) then false
    when public.is_workspace_manager(p_workspace_id) then true
    when p_assigned_to = (select auth.uid()) then true
    else exists (
      select 1 from public.contacts c
      where c.id = p_contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  end;
$$;

comment on function public.can_see_conversation(uuid, uuid, uuid) is
  'Scope de lectura de una conversación: por agente asignado, o heredado del scope del contacto.';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- `create function` otorga execute a PUBLIC, y PUBLIC incluye a `anon`. Se
-- revoca y se otorga explícito, igual que en la 00018.

revoke all on function public.can_see_contact(uuid, uuid, uuid) from public;
revoke all on function public.can_see_conversation(uuid, uuid, uuid) from public;

grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.can_see_contact(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_see_conversation(uuid, uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 2. CONTACTS
-- ============================================================

drop policy if exists "Users can view contacts in their workspaces" on contacts;
drop policy if exists "Users can manage contacts in their workspaces" on contacts;

create policy "contacts: leer solo los leads dentro del scope"
  on contacts for select to authenticated
  using (public.can_see_contact(workspace_id, setter_id, vendedor_id));

-- El `with check` de auto-asignación no es un detalle: sin él, un Member crea
-- un contacto y la policy de SELECT se lo esconde en la consulta siguiente. El
-- lead existiría, sin dueño y sin que su creador pueda verlo.
create policy "contacts: crear, un Member solo asignado a si mismo"
  on contacts for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and (
      public.is_workspace_manager(workspace_id)
      or setter_id = (select auth.uid())
      or vendedor_id = (select auth.uid())
    )
  );

-- `with check` además de `using`: sin él un Member podría editar un lead suyo y
-- en la misma operación reasignárselo a otro, quedándose sin acceso.
create policy "contacts: editar solo los leads dentro del scope"
  on contacts for update to authenticated
  using (public.can_see_contact(workspace_id, setter_id, vendedor_id))
  with check (public.can_see_contact(workspace_id, setter_id, vendedor_id));

-- Borrar es de Owner y Admin, incluso sobre los leads propios. Un lead borrado
-- se lleva por cascade sus conversaciones, sus mensajes y su historial.
create policy "contacts: borrar solo manager"
  on contacts for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- ============================================================
-- 3. CONVERSATIONS
-- ============================================================

drop policy if exists "Users can view conversations in their workspaces" on conversations;
drop policy if exists "Users can manage conversations in their workspaces" on conversations;

create policy "conversations: leer solo las del scope"
  on conversations for select to authenticated
  using (public.can_see_conversation(workspace_id, assigned_to, contact_id));

-- Esta policy de UPDATE no es opcional. La bandeja marca como leído desde el
-- NAVEGADOR (`inbox-view.tsx`, update de unread_count con el cliente del
-- usuario) y `api/v1/messages` actualiza la conversación al enviar. Sin UPDATE
-- las dos cosas fallan devolviendo 0 filas afectadas, sin error visible.
create policy "conversations: editar solo las del scope"
  on conversations for update to authenticated
  using (public.can_see_conversation(workspace_id, assigned_to, contact_id))
  with check (public.can_see_conversation(workspace_id, assigned_to, contact_id));

-- Las conversaciones nacen del webhook, que entra con service role y se saltea
-- la RLS. No hay caso legítimo de creación desde la interfaz.
create policy "conversations: crear solo manager"
  on conversations for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));

create policy "conversations: borrar solo manager"
  on conversations for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- ============================================================
-- 4. MESSAGES
-- ============================================================
-- `messages` no tiene workspace_id: el scope se hereda de la conversación.

drop policy if exists "Users can view messages via conversation" on messages;
drop policy if exists "Users can insert messages via conversation" on messages;

create policy "messages: leer los de las conversaciones del scope"
  on messages for select to authenticated
  using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and public.can_see_conversation(c.workspace_id, c.assigned_to, c.contact_id)
    )
  );

create policy "messages: escribir en las conversaciones del scope"
  on messages for insert to authenticated
  with check (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and public.can_see_conversation(c.workspace_id, c.assigned_to, c.contact_id)
    )
  );

-- ============================================================
-- 5. TABLAS SATÉLITE DEL CONTACTO
-- ============================================================
-- Sin propagar el scope acá, un Member no ve el lead ajeno pero sí su @ de la
-- red social, sus etiquetas y sus campos personalizados: es la misma fuga por
-- otra puerta. Las tres autorizan por `contact_id` contra `contacts`.
--
-- El `for all` sin `with check` usa la expresión de `using` también como
-- `with check` en INSERT y UPDATE, que es el comportamiento que se busca.

drop policy if exists "Users can view contact channels via contact" on contact_channels;
drop policy if exists "Users can manage contact channels" on contact_channels;

create policy "contact_channels: leer los del scope"
  on contact_channels for select to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

create policy "contact_channels: escribir los del scope"
  on contact_channels for all to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

drop policy if exists "Users can view contact tags" on contact_tags;
drop policy if exists "Users can manage contact tags" on contact_tags;

create policy "contact_tags: leer los del scope"
  on contact_tags for select to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

create policy "contact_tags: escribir los del scope"
  on contact_tags for all to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

drop policy if exists "Users can view contact custom fields" on contact_custom_fields;
drop policy if exists "Users can manage contact custom fields" on contact_custom_fields;

create policy "contact_custom_fields: leer los del scope"
  on contact_custom_fields for select to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

create policy "contact_custom_fields: escribir los del scope"
  on contact_custom_fields for all to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

-- ============================================================
-- 6. FLOW_SESSIONS
-- ============================================================
-- `variables jsonb` es donde el motor de flujos guarda todo lo que capturó de
-- la conversación: nombre, email, teléfono, respuestas. La policy del fork
-- autoriza vía `flows` con `is_workspace_member`, así que hoy un Member lee lo
-- capturado de cualquier lead del workspace. La tabla tiene `contact_id`, así
-- que el scope se propaga igual que en las satélite.

drop policy if exists "Users can view flow sessions via flow" on flow_sessions;

create policy "flow_sessions: leer las del scope"
  on flow_sessions for select to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = flow_sessions.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

-- ============================================================
-- 7. BROADCAST_RECIPIENTS
-- ============================================================
-- Las difusiones no se usan en la Etapa 1, pero la policy es consultable hoy y
-- la tabla tiene `contact_id`. Las de INSERT y UPDATE que agregó la 00009 no se
-- tocan: son caminos de escritura, no de lectura, y quedan anotadas como resto
-- conocido en el documento de requerimientos.

drop policy if exists "Users can view broadcast recipients" on broadcast_recipients;

create policy "broadcast_recipients: leer los del scope"
  on broadcast_recipients for select to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = broadcast_recipients.contact_id
        and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
    )
  );

-- ============================================================
-- 8. ANALYTICS_EVENTS
-- ============================================================
-- `contact_id` es nullable. Los eventos que no cuelgan de un lead (métricas de
-- flujo, del workspace) siguen siendo visibles para cualquier miembro; los que
-- sí cuelgan de un lead heredan su scope. La policy de INSERT no se toca.

drop policy if exists "Users can view analytics in their workspaces" on analytics_events;

create policy "analytics_events: leer los del scope"
  on analytics_events for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      contact_id is null
      or exists (
        select 1 from contacts c
        where c.id = analytics_events.contact_id
          and public.can_see_contact(c.workspace_id, c.setter_id, c.vendedor_id)
      )
    )
  );

-- ============================================================
-- 9. SCHEDULED_JOBS: SE BORRAN LAS TRES POLICIES, SIN REEMPLAZO
-- ============================================================
-- Es la única tabla de esta migración donde el `drop` no lleva `create` detrás,
-- y es a propósito.
--
-- Las tres policies de la 00009 autorizan con `auth.uid() is not null`: no
-- miran workspace, porque la tabla no tiene `workspace_id`. Cualquier usuario
-- autenticado del proyecto, de cualquier workspace, podía:
--   * encolar un job con el `type` que quisiera, que el cron ejecuta;
--   * marcar la cola entera como `completed`, dejando caer las secuencias y los
--     resume de flujos en silencio;
--   * leer los payloads de todos los workspaces.
--
-- Sin policies y con RLS activa, Postgres niega todo para cualquier token de
-- usuario. El cron (`/api/cron/jobs`, `/api/cron/sequences`) y el motor de
-- flujos entran con service role, que se saltea la RLS, así que siguen
-- funcionando sin cambios.
--
-- Verificado antes de borrar que ningún camino de escritura legítimo usa el
-- cliente del usuario:
--   * `lib/flow-engine/engine.ts` (executeDelay) → los tres puntos de entrada a
--     executeFlow/resumeSession son el webhook, processComment (llamado solo
--     por el webhook) y el cron: los tres con createServiceClient().
--   * `lib/scheduler.ts` (scheduleBroadcastDelivery) → recibía el cliente con
--     cookies desde `/api/v1/broadcasts/[id]/send`. Esa ruta se corrige en el
--     mismo commit: encola con service role y queda detrás de la guarda de
--     manager, porque pasa a ser el único camino que le queda a un cliente para
--     meter filas en la cola.

alter table scheduled_jobs enable row level security;

drop policy if exists "Authenticated users can insert jobs" on scheduled_jobs;
drop policy if exists "Authenticated users can read jobs" on scheduled_jobs;
drop policy if exists "Authenticated users can update jobs" on scheduled_jobs;

-- ============================================================
-- 10. SUPERFICIES DE ADMINISTRACIÓN
-- ============================================================

-- ── workspaces: configurar es de manager ────────────────────────────────────
-- El fork dejaba que cualquier miembro renombrara el workspace y editara
-- `global_keywords`, que decide qué palabras disparan desuscripción. El SELECT
-- no se toca: todo miembro necesita leer su workspace.

drop policy if exists "Users can update their workspaces" on workspaces;

create policy "workspaces: configurar solo manager"
  on workspaces for update to authenticated
  using (public.is_workspace_manager(id))
  with check (public.is_workspace_manager(id));

-- ── channels: conectar y desconectar es de manager ──────────────────────────
-- El `for all` del fork dejaba que cualquier Member borrara un canal, lo que
-- además dispara la desconexión del lado de Zernio. El SELECT del fork se
-- conserva tal cual: la bandeja necesita leer los canales con el token de
-- cualquier miembro.

drop policy if exists "Users can manage channels in their workspaces" on channels;

create policy "channels: crear solo manager"
  on channels for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));

create policy "channels: editar solo manager"
  on channels for update to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));

create policy "channels: borrar solo manager"
  on channels for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- ── workspace_invites: invitar y revocar pasa de Owner a manager ────────────
-- `workspace_invites_select` y `workspace_invites_update` NO se tocan: el
-- UPDATE tiene la rama que le permite al invitado aceptar su propia invitación
-- comparando contra su email, y romperla rompe la aceptación.

drop policy if exists "workspace_invites_insert" on workspace_invites;
drop policy if exists "workspace_invites_delete" on workspace_invites;

create policy "workspace_invites: invitar solo manager"
  on workspace_invites for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));

create policy "workspace_invites: revocar solo manager"
  on workspace_invites for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- ── workspace_members: cambiar rol es de manager, remover sigue siendo Owner ─
-- La policy de DELETE del fork ("Owners can delete members") no se toca:
-- remover a alguien del workspace no se delega en el Admin.

drop policy if exists "Owners can update members" on workspace_members;

create policy "workspace_members: cambiar rol solo manager"
  on workspace_members for update to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));
