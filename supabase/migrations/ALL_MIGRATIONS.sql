-- =============================================
-- ZERNFLOW - COMBINED MIGRATIONS
-- Generated from supabase/migrations/*.sql, in order.
-- Paste this entire file into Supabase SQL Editor
-- https://supabase.com/dashboard/project/_/sql/new
-- =============================================

-- ============================================================
-- MIGRATION 1: INITIAL SCHEMA
-- ============================================================
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- WORKSPACES
-- ============================================================
create table workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  late_api_key_encrypted text,
  global_keywords jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index idx_workspace_members_user on workspace_members(user_id);

-- ============================================================
-- CHANNELS
-- ============================================================
create table channels (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit')),
  late_account_id text not null,
  username text,
  display_name text,
  profile_picture text,
  webhook_id text,
  webhook_secret text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, late_account_id)
);

create index idx_channels_workspace on channels(workspace_id);

-- ============================================================
-- CONTACTS (CRM)
-- ============================================================
create table contacts (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  is_subscribed boolean not null default true,
  last_interaction_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_workspace on contacts(workspace_id);
create index idx_contacts_last_interaction on contacts(workspace_id, last_interaction_at desc);

create table contact_channels (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  platform_sender_id text not null,
  platform_username text,
  created_at timestamptz not null default now(),
  unique (channel_id, platform_sender_id)
);

create index idx_contact_channels_contact on contact_channels(contact_id);

create table tags (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text default '#6366f1',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table custom_field_definitions (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  type text not null default 'text' check (type in ('text', 'number', 'boolean', 'date', 'url', 'email')),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table contact_custom_fields (
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references custom_field_definitions(id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_id)
);

-- ============================================================
-- FLOWS
-- ============================================================
create table flows (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  viewport jsonb,
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flows_workspace on flows(workspace_id);
create index idx_flows_status on flows(workspace_id, status);

create table triggers (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid references channels(id) on delete set null,
  type text not null check (type in ('keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword')),
  config jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_triggers_channel_type on triggers(channel_id, type, is_active);
create index idx_triggers_flow on triggers(flow_id);

create table flow_sessions (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  flow_stack jsonb not null default '[]'::jsonb,
  waiting_until timestamptz,
  waiting_for_input boolean not null default false,
  human_takeover_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flow_sessions_contact_active on flow_sessions(contact_id, channel_id) where status = 'active';

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  late_conversation_id text,
  platform text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'snoozed')),
  assigned_to uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  is_automation_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id)
);

create index idx_conversations_workspace on conversations(workspace_id, last_message_at desc);
create index idx_conversations_status on conversations(workspace_id, status);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  text text,
  attachments jsonb,
  quick_reply_payload text,
  postback_payload text,
  callback_data text,
  platform_message_id text,
  sent_by_flow_id uuid references flows(id) on delete set null,
  sent_by_node_id text,
  sent_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'sent' check (status in ('pending', 'sent', 'delivered', 'failed')),
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- ============================================================
-- BROADCASTS
-- ============================================================
create table broadcasts (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  message_content jsonb not null default '{}'::jsonb,
  segment_filter jsonb,
  scheduled_for timestamptz,
  total_recipients integer not null default 0,
  sent integer not null default 0,
  delivered integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_broadcasts_workspace on broadcasts(workspace_id);

create table broadcast_recipients (
  id uuid primary key default uuid_generate_v4(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text
);

create index idx_broadcast_recipients_broadcast on broadcast_recipients(broadcast_id, status);

-- ============================================================
-- JOBS & ANALYTICS
-- ============================================================
create table scheduled_jobs (
  id uuid primary key default uuid_generate_v4(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index idx_scheduled_jobs_pending on scheduled_jobs(run_at) where status = 'pending';

create table analytics_events (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  flow_id uuid references flows(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_analytics_workspace on analytics_events(workspace_id, created_at desc);
create index idx_analytics_flow on analytics_events(flow_id, created_at desc);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on workspaces for each row execute function update_updated_at();
create trigger set_updated_at before update on channels for each row execute function update_updated_at();
create trigger set_updated_at before update on contacts for each row execute function update_updated_at();
create trigger set_updated_at before update on flows for each row execute function update_updated_at();
create trigger set_updated_at before update on flow_sessions for each row execute function update_updated_at();
create trigger set_updated_at before update on conversations for each row execute function update_updated_at();
create trigger set_updated_at before update on broadcasts for each row execute function update_updated_at();

-- ============================================================
-- AUTO-CREATE WORKSPACE ON SIGNUP
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
begin
  user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (user_name || '''s Workspace', workspace_slug)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
exception when others then
  raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- MIGRATION 2: RLS POLICIES
-- ============================================================
-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================
-- All tables are filtered by workspace_id.
-- Users can only access rows in workspaces they belong to.
-- Service role key bypasses RLS (used in webhook handler).
-- ============================================================

-- Helper function: check if user belongs to workspace
create or replace function is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ============================================================
-- WORKSPACES
-- ============================================================
alter table workspaces enable row level security;

create policy "Users can view their workspaces"
  on workspaces for select
  using (is_workspace_member(id));

create policy "Users can update their workspaces"
  on workspaces for update
  using (is_workspace_member(id));

-- ============================================================
-- WORKSPACE MEMBERS
-- ============================================================
alter table workspace_members enable row level security;

-- SELECT uses direct user_id check to avoid infinite recursion
-- (is_workspace_member queries workspace_members, which would trigger RLS again)
create policy "Members can view their workspace memberships"
  on workspace_members for select
  using (user_id = auth.uid());

create policy "Owners can insert members"
  on workspace_members for insert
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can update members"
  on workspace_members for update
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can delete members"
  on workspace_members for delete
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ============================================================
-- CHANNELS
-- ============================================================
alter table channels enable row level security;

create policy "Users can view channels in their workspaces"
  on channels for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage channels in their workspaces"
  on channels for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACTS
-- ============================================================
alter table contacts enable row level security;

create policy "Users can view contacts in their workspaces"
  on contacts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage contacts in their workspaces"
  on contacts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CHANNELS
-- ============================================================
alter table contact_channels enable row level security;

create policy "Users can view contact channels via contact"
  on contact_channels for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact channels"
  on contact_channels for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- TAGS
-- ============================================================
alter table tags enable row level security;

create policy "Users can view tags in their workspaces"
  on tags for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage tags in their workspaces"
  on tags for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT TAGS
-- ============================================================
alter table contact_tags enable row level security;

create policy "Users can view contact tags"
  on contact_tags for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact tags"
  on contact_tags for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- CUSTOM FIELD DEFINITIONS
-- ============================================================
alter table custom_field_definitions enable row level security;

create policy "Users can view custom fields in their workspaces"
  on custom_field_definitions for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage custom fields in their workspaces"
  on custom_field_definitions for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CUSTOM FIELDS
-- ============================================================
alter table contact_custom_fields enable row level security;

create policy "Users can view contact custom fields"
  on contact_custom_fields for select
  using (
    exists (
      select 1 from contacts c
      join contact_custom_fields ccf on ccf.contact_id = c.id
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact custom fields"
  on contact_custom_fields for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- FLOWS
-- ============================================================
alter table flows enable row level security;

create policy "Users can view flows in their workspaces"
  on flows for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage flows in their workspaces"
  on flows for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- TRIGGERS
-- ============================================================
alter table triggers enable row level security;

create policy "Users can view triggers via flow"
  on triggers for select
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

create policy "Users can manage triggers via flow"
  on triggers for all
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- FLOW SESSIONS
-- ============================================================
alter table flow_sessions enable row level security;

create policy "Users can view flow sessions via flow"
  on flow_sessions for select
  using (
    exists (
      select 1 from flows f
      where f.id = flow_sessions.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- CONVERSATIONS
-- ============================================================
alter table conversations enable row level security;

create policy "Users can view conversations in their workspaces"
  on conversations for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage conversations in their workspaces"
  on conversations for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- MESSAGES
-- ============================================================
alter table messages enable row level security;

create policy "Users can view messages via conversation"
  on messages for select
  using (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

create policy "Users can insert messages via conversation"
  on messages for insert
  with check (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

-- ============================================================
-- BROADCASTS
-- ============================================================
alter table broadcasts enable row level security;

create policy "Users can view broadcasts in their workspaces"
  on broadcasts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage broadcasts in their workspaces"
  on broadcasts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- BROADCAST RECIPIENTS
-- ============================================================
alter table broadcast_recipients enable row level security;

create policy "Users can view broadcast recipients"
  on broadcast_recipients for select
  using (
    exists (
      select 1 from broadcasts b
      where b.id = broadcast_recipients.broadcast_id
        and is_workspace_member(b.workspace_id)
    )
  );

-- ============================================================
-- SCHEDULED JOBS (service role only, no user RLS needed)
-- ============================================================
alter table scheduled_jobs enable row level security;

-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================
alter table analytics_events enable row level security;

create policy "Users can view analytics in their workspaces"
  on analytics_events for select
  using (is_workspace_member(workspace_id));

create policy "Users can insert analytics in their workspaces"
  on analytics_events for insert
  with check (is_workspace_member(workspace_id));

-- ============================================================
-- MIGRATION 3: RPC FUNCTIONS
-- ============================================================
-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- Increment unread count and update conversation preview
create or replace function increment_unread(conv_id uuid, preview text)
returns void as $$
begin
  update conversations
  set unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  where id = conv_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast sent counter
create or replace function increment_broadcast_sent(b_id uuid)
returns void as $$
begin
  update broadcasts
  set sent = sent + 1,
      delivered = delivered + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast failed counter
create or replace function increment_broadcast_failed(b_id uuid)
returns void as $$
begin
  update broadcasts
  set failed = failed + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- ============================================================
-- MIGRATION 4: COMMENT AUTOMATION
-- ============================================================
-- ============================================================
-- COMMENT AUTOMATION
-- ============================================================

-- Add comment polling cursor to channels
alter table channels
  add column if not exists last_comment_cursor text,
  add column if not exists comment_rules jsonb default '[]'::jsonb;

-- Comment processing log
create table if not exists comment_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id text, -- Late post ID the comment belongs to
  platform_comment_id text not null,
  author_id text,
  author_name text,
  author_username text,
  comment_text text not null,
  matched_trigger_id uuid references triggers(id) on delete set null,
  dm_sent boolean not null default false,
  reply_sent boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

-- Indexes for efficient lookups
create index if not exists idx_comment_logs_channel_id on comment_logs(channel_id);
create index if not exists idx_comment_logs_workspace_id on comment_logs(workspace_id);
create index if not exists idx_comment_logs_platform_comment_id on comment_logs(platform_comment_id);
create index if not exists idx_comment_logs_created_at on comment_logs(created_at desc);

-- Unique constraint to avoid processing the same comment twice
create unique index if not exists idx_comment_logs_unique_comment
  on comment_logs(channel_id, platform_comment_id);

-- RLS policies for comment_logs
alter table comment_logs enable row level security;

create policy "Users can view comment logs in their workspace"
  on comment_logs for select
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ============================================================
-- MIGRATION 5: SEQUENCES
-- ============================================================
-- Sequences: drip campaigns
CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequences_workspace" ON sequences
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id),
  current_step_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_step_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, contact_id)
);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enrollments_via_sequence" ON sequence_enrollments
  FOR ALL USING (
    sequence_id IN (
      SELECT id FROM sequences WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- MIGRATION 6: WORKSPACE INVITES
-- ============================================================
-- ============================================================
-- WORKSPACE INVITES
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- Members of the workspace can view invites
CREATE POLICY "workspace_invites_select" ON workspace_invites
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Only workspace owners can create invites
CREATE POLICY "workspace_invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can delete invites
CREATE POLICY "workspace_invites_delete" ON workspace_invites
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can update invite status
CREATE POLICY "workspace_invites_update" ON workspace_invites
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
    OR
    -- Allow the invited user to accept their own invite
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================
-- MIGRATION 7: OPENAI API KEY
-- ============================================================
-- Add OpenAI API key column to workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- ============================================================
-- MIGRATION 8: AI PROVIDER
-- ============================================================
-- Rename openai_api_key to ai_api_key and add ai_provider column
ALTER TABLE workspaces RENAME COLUMN openai_api_key TO ai_api_key;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'openai';

-- ============================================================
-- MIGRATION 9: FIX BROADCAST RLS
-- ============================================================
-- Fix broadcast_recipients: add INSERT/UPDATE/DELETE policies
CREATE POLICY "Users can insert broadcast recipients" ON broadcast_recipients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

CREATE POLICY "Users can update broadcast recipients" ON broadcast_recipients
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

-- Fix scheduled_jobs: add full CRUD policies for workspace members
-- Jobs are workspace-agnostic (system-level), so allow authenticated users
CREATE POLICY "Authenticated users can insert jobs" ON scheduled_jobs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read jobs" ON scheduled_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update jobs" ON scheduled_jobs
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- MIGRATION 10: FLOW VERSIONS
-- ============================================================
-- Flow version history: stores a snapshot of nodes/edges on each publish
create table flow_versions (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references flows(id) on delete cascade,
  version integer not null,
  nodes jsonb not null,
  edges jsonb not null,
  viewport jsonb,
  name text not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);

create index idx_flow_versions_flow on flow_versions(flow_id, version desc);

-- RLS
alter table flow_versions enable row level security;

create policy "flow_versions_select" on flow_versions for select
  using (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

create policy "flow_versions_insert" on flow_versions for insert
  with check (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

-- ============================================================
-- MIGRATION 11: WORKSPACE WEBHOOK SECRET
-- ============================================================
-- Add workspace-level webhook secret for Zernio HMAC signature verification.
-- Zernio exposes a single webhook per profile/API key, so the secret lives at the
-- workspace level (not per-channel). Used by /api/webhooks/late to verify signatures.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- ============================================================
-- MIGRATION 12: WEBHOOK EVENTS
-- ============================================================
-- Idempotency ledger for inbound Zernio webhook deliveries. Zernio retries a
-- delivery with the same event id whenever our 200 doesn't arrive within its 5s
-- timeout; /api/webhooks/late claims the id here before processing so retries
-- and redeliveries never re-run a flow (which was double-sending DMs).
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rows are only needed for the retry window (hours); allow cheap pruning.
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events (received_at);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MIGRATION 13: SEQUENCE ENROLLMENTS CHANNEL CASCADE
-- ============================================================
-- sequence_enrollments.channel_id was declared without an ON DELETE action
-- (00005_sequences.sql), so deleting a channel with enrollments failed with a
-- 23503 FK violation. Every other channel FK cascades (or sets null); align
-- this one so channel deletion works.
ALTER TABLE sequence_enrollments
  DROP CONSTRAINT sequence_enrollments_channel_id_fkey,
  ADD CONSTRAINT sequence_enrollments_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

-- ============================================================
-- MIGRATION 14: SCHEDULED JOBS CLAIMED AT
-- ============================================================
-- The cron claims a job by flipping status to 'processing'. If that UPDATE
-- commits but the response is lost, the job is stranded: the fetch only read
-- 'pending' rows. claimed_at lets the cron reclaim 'processing' jobs whose
-- claim is older than a few minutes.
ALTER TABLE scheduled_jobs ADD COLUMN claimed_at timestamptz;

CREATE INDEX idx_scheduled_jobs_processing ON scheduled_jobs(claimed_at)
  WHERE status = 'processing';

-- ============================================================
-- MIGRATION 15: BACKFILL CLAIMED AT
-- ============================================================
-- 00014 added claimed_at but did not backfill rows already stuck in
-- 'processing', and old-code invocations claim without stamping it. Stamp
-- existing NULL claims so the cron's staleness clock (claimed_at older than
-- 5 minutes) applies to them; genuinely stranded rows become reclaimable
-- shortly after this runs, while a claim still live at migration time gets
-- the full window to finish before being reclaimed.
UPDATE scheduled_jobs
SET claimed_at = now()
WHERE status = 'processing' AND claimed_at IS NULL;

-- ============================================================
-- MIGRATION 16: WHATSAPP CHANNEL PLATFORM
-- ============================================================
-- WhatsApp was advertised on the site, offered in the channel picker and
-- already handled by the flow engine, but 00001's platform check constraint
-- never listed it, so the channel row could not be stored (issue #16).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_platform_check;

ALTER TABLE channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit', 'whatsapp'));

-- ============================================================
-- MIGRATION 17: LEAD SCOPE COLUMNS
-- ============================================================
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

-- ============================================================
-- MIGRATION 18: VAULT SETUP
-- ============================================================
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

-- ============================================================
-- MIGRATION 19: LEAD SCOPE RLS
-- ============================================================
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

-- ============================================================
-- MIGRATION 20: WORKSPACE MEMBERS MANAGER SELECT
-- ============================================================
-- ============================================================
-- WORKSPACE_MEMBERS: UN MANAGER VE A TODO SU EQUIPO
-- ============================================================
-- La 00019 le dio al manager una policy de UPDATE sobre `workspace_members`
-- para que pudiera cambiar el rol de un miembro. No alcanzaba, y el modo de
-- fallar era silencioso.
--
-- POR QUÉ: Postgres aplica también las policies de SELECT cuando un UPDATE o un
-- DELETE referencia columnas de la tabla, y PostgREST siempre arma un WHERE. La
-- policy de SELECT que trae el fork es `user_id = auth.uid()`: cada quien ve
-- solo su propia fila. Entonces un Owner que intentaba cambiarle el rol a otra
-- persona no veía esa fila, el UPDATE afectaba cero filas, y PostgREST
-- respondía 204 igual. Éxito aparente, rol sin cambiar.
--
-- Encontrado probando con un Member invitado de verdad: la comprobación "un
-- Manager SÍ puede cambiar el rol de un miembro" devolvía 204 y el rol seguía
-- en 'member'. La policy de UPDATE de la 00019 era letra muerta.
--
-- EL ARREGLO: que el manager vea las membresías de su workspace. Además de
-- destrabar el UPDATE, es lo correcto por sí solo: la pantalla de equipo ya
-- muestra ese listado, y hoy tiene que armarlo con el service client porque la
-- RLS no se lo permite.
--
-- POR QUÉ NO HAY RECURSIÓN: el comentario del fork en la 00002 advierte que
-- consultar `workspace_members` desde su propia policy vuelve a disparar la
-- RLS. Por eso la rama nueva no consulta la tabla directamente: llama a
-- `is_workspace_manager`, que es `security definer` y corre como el dueño de la
-- tabla, que no está sujeto a RLS. Es el mismo mecanismo que ya usan
-- `is_workspace_member` y las funciones del scope de leads.
--
-- Lo que NO cambia: quién puede escribir. El UPDATE sigue siendo de manager
-- (00019) y el DELETE sigue siendo solo del Owner (00002). Esto es únicamente
-- lectura.
--
-- Idempotente: `drop policy if exists` + `create policy`.
-- ============================================================

drop policy if exists "Members can view their workspace memberships" on workspace_members;

create policy "workspace_members: la propia fila, y el equipo si sos manager"
  on workspace_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_workspace_manager(workspace_id)
  );

-- ============================================================
-- MIGRATION 21: DROP PLAINTEXT KEY COLUMNS
-- ============================================================
-- ============================================================
-- BORRADO DE LAS COLUMNAS DE CLAVES EN TEXTO PLANO (F2, fase de contraer)
-- ============================================================
-- Cierre del expandir-y-contraer que empezó la 00018.
--
-- La 00018 copió los valores de `workspaces.late_api_key_encrypted` y
-- `workspaces.ai_api_key` a Vault y NO borró nada, a propósito: los dos
-- mecanismos tenían que convivir mientras se reescribían las 16 lecturas del
-- código. Si esa reescritura salía mal, el dato viejo todavía estaba.
--
-- Ahora Vault está probado en todos los caminos: la UI de settings, el webhook,
-- el motor de flujos, el procesador de secuencias, el nodo de IA y el cron. Ya
-- ningún archivo de `app/`, `lib/` ni `components/` lee ni escribe estas dos
-- columnas; lo único que queda son los tipos, que se borran en este mismo
-- commit.
--
-- POR QUÉ IMPORTA BORRARLAS Y NO SOLO DEJAR DE LEERLAS
-- Mientras la columna existe, el valor existe. En esta base se vaciaron a mano
-- al cerrar la Sesión A, pero en una instalación desde cero la 00018 deja el
-- texto plano sentado en la fila hasta acá: la migración copia, no mueve. Un
-- `select *` sobre `workspaces` —el que hacían las seis consultas que se
-- corrigieron— lo traía entero. Borrar la columna es lo que hace que el dato
-- deje de existir, y recién con eso se cumple el criterio de F2: "consultar
-- select * from workspaces no devuelve ninguna clave de API".
--
-- NO TOCA `webhook_secret`. Es el tercer secreto de la tabla, pero está en uso:
-- `lib/zernio-webhook.ts` lo necesita para validar la firma HMAC de los
-- webhooks entrantes. Sigue protegido por `lib/safe-columns.ts`, que prohíbe el
-- `select("*")` y el nombre de la columna fuera del allowlist.
--
-- Idempotente: `drop column if exists`.
-- ============================================================

alter table workspaces
  drop column if exists late_api_key_encrypted,
  drop column if exists ai_api_key;

-- Deja constancia en el esquema de dónde viven ahora, para quien mire la tabla
-- buscando la clave y no la encuentre.
comment on table workspaces is
  'Workspace del sistema. Las API keys (Zernio, AI Gateway) NO viven acá: están en Supabase Vault, bajo el nombre ws:<workspace_id>:<nombre>. Se leen y escriben con las funciones read_secret / store_secret / delete_secret (00018).';


-- ============================================================
-- MIGRATION 22: EVOLUTION CHANNEL AND WEBHOOK ALERTS
-- ============================================================
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


-- ============================================================
-- MIGRATION 23: WEBHOOK ALERTS REVISION
-- ============================================================
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


-- ============================================================
-- MIGRATION 24: INTEGRATION CONFIGS
-- ============================================================
-- ============================================================
-- CONFIGURACIÓN Y ESTADO DE LAS INTEGRACIONES (F24)
-- ============================================================
-- Una fila por integración de cada workspace: los canales, el correo y los
-- proveedores de IA. La pantalla de `/settings/integrations` se arma leyendo
-- esta tabla, así que un canal agregado como fila aparece sin tocar código
-- (decidido el 22 de septiembre de 2026, ver el plano, §0).
--
-- QUÉ NO VA ACÁ: ninguna clave. Las claves viven en Vault, bajo el nombre que
-- el código deriva del proveedor. Esta tabla guarda solo lo que se puede
-- mostrar: el nombre, el estado, cuándo se verificó y el último error, y en
-- `config` datos no secretos como el modelo por defecto.
--
-- EL ESTADO, y por qué son cuatro y no dos. `sin_verificar` significa que no se
-- pudo preguntar (el proveedor no respondió, o respondió algo que no es un sí
-- ni un no), y nunca se muestra como `desconectado`: decir "desconectado"
-- cuando en realidad no sabemos es mentir con confianza. `sin_configurar` es
-- que falta la clave. Se detecta al abrir la pantalla y cuando una operación
-- real falla por credenciales o conexión; no hay tarea periódica, a propósito
-- (el motivo está en F24).
--
-- QUIÉN LA VE: solo Owner y Admin, en las cuatro operaciones. La pantalla es de
-- configuración, y el estado de una integración le dice a quien lo lea qué
-- claves hay cargadas. Realtime evalúa la misma política de SELECT, así que un
-- Member suscrito tampoco recibe los cambios; lo comprueba
-- `scripts/verify-integration-configs.mjs`, con canario.
--
-- Idempotente: `if not exists`, `drop ... if exists` y un bloque `do $$` con
-- check previo para la publicación de Realtime.
-- ============================================================

create table if not exists integration_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  tipo text not null check (tipo in ('canal', 'correo', 'ia')),
  proveedor text not null,
  nombre text not null,
  orden integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  estado text not null default 'sin_configurar' check (estado in ('conectado', 'desconectado', 'sin_verificar', 'sin_configurar')),
  verificado_el timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, proveedor)
);

create index if not exists integration_configs_workspace_idx on integration_configs (workspace_id, orden);

comment on table integration_configs is
  'Una fila por integración del workspace (F24). Sin claves: las claves van a Vault. La pantalla de integraciones se arma leyendo esta tabla.';
comment on column integration_configs.estado is
  'conectado, desconectado, sin_verificar (no se pudo preguntar; nunca se muestra como desconectado) o sin_configurar (falta la clave).';
comment on column integration_configs.config is
  'Datos no secretos de la integración, como el modelo por defecto. Nunca una clave.';
comment on column integration_configs.ultimo_error is
  'Motivo corto del último fallo, en lenguaje claro. Nunca una clave ni el cuerpo de una respuesta del proveedor.';

alter table integration_configs enable row level security;

drop policy if exists "integration_configs: managers leen" on integration_configs;
create policy "integration_configs: managers leen"
  on integration_configs for select to authenticated
  using (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers crean" on integration_configs;
create policy "integration_configs: managers crean"
  on integration_configs for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers modifican" on integration_configs;
create policy "integration_configs: managers modifican"
  on integration_configs for update to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));

drop policy if exists "integration_configs: managers borran" on integration_configs;
create policy "integration_configs: managers borran"
  on integration_configs for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

-- Realtime: la pantalla abierta se entera de los cambios de estado sin
-- recargar. `alter publication ... add table` falla si la tabla ya está, así
-- que se pregunta antes. La 00001 lo hizo sin check para `conversations` y
-- `messages`; acá no, porque esta migración tiene que poder correr dos veces.
--
-- LÍMITE CONOCIDO, el mismo que documenta `verify-realtime-scope.mjs`: los
-- eventos de DELETE no los filtra la RLS y le llegan a todo suscriptor de la
-- tabla, con la clave primaria y sin contenido.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'integration_configs'
  ) then
    alter publication supabase_realtime add table integration_configs;
  end if;
end $$;


-- ============================================================
-- MIGRATION 25: CHANNELS KEEP HISTORY
-- ============================================================
-- ============================================================
-- BORRAR UN CANAL NO PUEDE BORRAR SU HISTORIAL (F24)
-- ============================================================
-- Las claves foráneas de `channel_id` hacia `channels` en las tablas con
-- historia pasan de ON DELETE CASCADE a ON DELETE NO ACTION. Con eso, la base
-- rechaza borrar un canal que tiene conversaciones (y por ellas, mensajes),
-- identidad de contacto, registro de comentarios, inscripciones a secuencias,
-- destinatarios de difusiones o sesiones de flujo.
--
-- NO ACTION Y NO RESTRICT, decidido el 05/10/2026. Los dos rechazan borrar un
-- canal con historial. La diferencia es cuándo revisan: RESTRICT en el momento,
-- NO ACTION al final de la operación. Borrar un workspace entero es una
-- decisión legítima del Owner, y su cascada borra canales y conversaciones en
-- la misma operación: con RESTRICT podría trabarse según el orden en que se
-- procesen las filas; con NO ACTION, al final ya no queda ninguna conversación
-- que apunte al canal. Lo comprueba `scripts/verify-channels-restrict.mjs`.
--
-- POR QUÉ EN LA BASE. La ruta heredada `DELETE /api/v1/channels/[channelId]`
-- borraba la fila del canal y todo eso se iba en cascada. El 05/10/2026 la
-- ruta pasó a responder 405, pero la protección que no depende de la interfaz
-- ni de una ruta es esta: el historial vive en la base local por decisión
-- cerrada del proyecto. Desconectar es marcar el canal inactivo.
--
-- QUÉ NO SE TOCA, a propósito:
--   - Las claves de `contact_id`. La purga de F30 borra contactos y se lleva su
--     historia en cascada, y eso es intencional.
--   - `triggers.channel_id` y `webhook_alerts.channel_id`, que ya son SET NULL:
--     borrar el canal no borra esas filas.
--
-- Idempotente y sin suponer nombres: si la clave de una tabla tiene otro
-- nombre, primero se renombra al esperado (`<tabla>_channel_id_fkey`), después
-- se recrea con `drop ... if exists` + `add`, y al final un bloque comprueba
-- contra el catálogo que cada tabla tiene exactamente una clave hacia
-- `channels` y que es NO ACTION. Si no, la migración falla entera.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select t.relname as tabla, c.conname as nombre
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class f on f.oid = c.confrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and f.relname = 'channels'
      and t.relname in ('conversations', 'contact_channels', 'comment_logs', 'sequence_enrollments', 'broadcast_recipients', 'flow_sessions')
      and c.conname <> t.relname || '_channel_id_fkey'
  loop
    execute format('alter table public.%I rename constraint %I to %I', r.tabla, r.nombre, r.tabla || '_channel_id_fkey');
  end loop;
end $$;

alter table conversations drop constraint if exists conversations_channel_id_fkey;
alter table conversations add constraint conversations_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

alter table contact_channels drop constraint if exists contact_channels_channel_id_fkey;
alter table contact_channels add constraint contact_channels_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

alter table comment_logs drop constraint if exists comment_logs_channel_id_fkey;
alter table comment_logs add constraint comment_logs_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

alter table sequence_enrollments drop constraint if exists sequence_enrollments_channel_id_fkey;
alter table sequence_enrollments add constraint sequence_enrollments_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

alter table broadcast_recipients drop constraint if exists broadcast_recipients_channel_id_fkey;
alter table broadcast_recipients add constraint broadcast_recipients_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

alter table flow_sessions drop constraint if exists flow_sessions_channel_id_fkey;
alter table flow_sessions add constraint flow_sessions_channel_id_fkey
  foreign key (channel_id) references channels(id) on delete no action;

-- Comprobación contra el catálogo, no contra lo que se escribió arriba: cada
-- tabla tiene exactamente una clave hacia channels, y es NO ACTION ('a').
do $$
declare
  t text;
  cuantas int;
  sin_accion int;
begin
  foreach t in array array['conversations', 'contact_channels', 'comment_logs', 'sequence_enrollments', 'broadcast_recipients', 'flow_sessions']
  loop
    select count(*), count(*) filter (where c.confdeltype = 'a')
      into cuantas, sin_accion
    from pg_constraint c
    join pg_class tb on tb.oid = c.conrelid
    join pg_class f on f.oid = c.confrelid
    join pg_namespace n on n.oid = tb.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and f.relname = 'channels' and tb.relname = t;
    if cuantas <> 1 or sin_accion <> 1 then
      raise exception 'channels: % tiene % claves hacia channels y % en NO ACTION; se esperaba exactamente una en NO ACTION', t, cuantas, sin_accion;
    end if;
  end loop;
end $$;


-- ============================================================
-- MIGRATION 26: CHANNELS EXCEDE PLAN
-- ============================================================
-- ============================================================
-- UNA CUENTA QUE EXCEDE EL PLAN DE ZERNIO NO SE DESACTIVA (§15, 06/10/2026)
-- ============================================================
-- Antes, la sincronización pedía las cuentas a Zernio sin `includeOverLimit`,
-- así que una cuenta de un perfil que excede el límite del plan no venía en la
-- lista y su canal se desactivaba. Ahora se piden todas, y el exceso de plan es
-- un estado propio del canal: se muestra en su tarjeta y no lo desactiva.
--
-- La marca la escribe solo `POST /api/v1/channels/sync`, a partir de
-- `Profile.isOverLimit` del SDK de Zernio. Los canales de Evolution la tienen
-- siempre en false.
--
-- Idempotente: solo agrega una columna con valor por defecto, y el código
-- anterior a esta migración no la lee.
alter table channels
  add column if not exists excede_plan_zernio boolean not null default false;

comment on column channels.excede_plan_zernio is
  'La cuenta de Zernio es de un perfil que excede el límite del plan (Profile.isOverLimit). No desactiva el canal. Si una cuenta excedida sigue recibiendo mensajes no está verificado.';


-- ============================================================
-- MIGRATION 27: EMAIL LOG
-- ============================================================
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


-- ============================================================
-- MIGRATION 28: AUDIT LOG
-- ============================================================
-- ============================================================
-- HISTORIAL DE AUDITORÍA (F31)
-- ============================================================
-- Quién hizo qué y cuándo. Una fila por evento: contacto creado, editado o
-- reconciliado; canal conectado, desconectado, con error o reemplazado; cambios
-- de configuración; movimientos de equipo. Es lo que lee la pestaña «Historial
-- de cambios» de Configuración (§11).
--
-- NUNCA SE ELIMINA, Y LO HACE CUMPLIR LA BASE. No hay policies de escritura
-- para usuarios, y un trigger rechaza UPDATE, DELETE y TRUNCATE para todos,
-- incluida la clave de servicio. Tampoco tiene borrado suave: no hay
-- `deleted_at`. La purga a 30 días del borrado suave de F30 no la toca.
--
-- SIN CLAVES FORÁNEAS, A PROPÓSITO. `workspace_id`, `actor_id` y `entity_id`
-- son identificadores sueltos. Con una clave foránea, borrar un contacto (la
-- purga de F30, la limpieza de los verificadores) o fallaría o se llevaría su
-- historial en cascada, y las dos cosas contradicen "nunca se elimina". Por lo
-- mismo, el nombre de quien actuó y el de la entidad se guardan como texto en
-- el momento (`actor_label`, `entity_label`): sobreviven aunque el usuario o el
-- contacto dejen de existir.
--
-- QUIÉN ESCRIBE. Solo el servidor, con la clave de servicio: `lib/auditoria.ts`
-- y las funciones SQL que hacen el cambio y su registro en una sola operación
-- (la reconciliación y la fusión de F26). Se decidió escribir desde el código y
-- no con triggers sobre cada tabla porque los verificadores escriben directo
-- contra la base real, y con triggers cada corrida dejaría en el espacio real,
-- para siempre, filas de contactos y miembros de prueba.
--
-- QUIÉN LEE. Owner y Admin, todo su espacio. Un Member, solo las filas donde
-- él es el actor (criterio de F31).
--
-- LA LISTA DE ACCIONES ES CERRADA. Un evento nuevo necesita esta migración o
-- una posterior que reemplace el `check`, no solo código. Las que faltan las
-- suma cada funcionalidad: eliminado y restaurado (F30), asignado (F41), no
-- contactar (F34), importaciones (F37).
--
-- Idempotente: `if not exists`, `drop ... if exists` y `create or replace`.
-- ============================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  actor_id uuid,
  actor_label text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  changes jsonb not null default '{}',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log add constraint audit_log_action_check check (action in (
  'contacto.creado',
  'contacto.editado',
  'contacto.reconciliado',
  'contacto.fusionado',
  'canal.conectado',
  'canal.desconectado',
  'canal.error',
  'canal.reemplazado',
  'configuracion.cambiada',
  'equipo.invitado',
  'equipo.invitacion_revocada',
  'equipo.ingreso',
  'equipo.rol_cambiado',
  'equipo.removido'
));

alter table audit_log drop constraint if exists audit_log_entity_type_check;
alter table audit_log add constraint audit_log_entity_type_check check (entity_type in (
  'contacto', 'canal', 'espacio', 'integracion', 'miembro', 'invitacion'
));

create index if not exists audit_log_workspace_idx on audit_log (workspace_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);
create index if not exists audit_log_created_idx on audit_log (created_at);
-- Para la lectura del Member, que filtra por actor.
create index if not exists audit_log_actor_idx on audit_log (actor_id, created_at desc);

comment on table audit_log is
  'Historial de auditoría (F31). Nunca se elimina: un trigger rechaza UPDATE, DELETE y TRUNCATE. Sin claves foráneas a propósito.';
comment on column audit_log.actor_id is
  'Quién actuó. Nulo es el Sistema: un webhook, la sincronización, una tarea automática.';
comment on column audit_log.changes is
  'Campo → {antes, despues}. Nunca el valor de una clave ni de un secreto: para eso, solo "guardada" o "borrada".';

-- ── Inmutable ────────────────────────────────────────────────────────────
create or replace function public.audit_log_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log no se modifica ni se borra (F31): % rechazado', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_sin_cambios on audit_log;
create trigger audit_log_sin_cambios
  before update or delete on audit_log
  for each row execute function public.audit_log_inmutable();

drop trigger if exists audit_log_sin_truncate on audit_log;
create trigger audit_log_sin_truncate
  before truncate on audit_log
  for each statement execute function public.audit_log_inmutable();

-- ── Quién lee ────────────────────────────────────────────────────────────
alter table audit_log enable row level security;

drop policy if exists "audit_log: managers leen todo, members lo propio" on audit_log;
create policy "audit_log: managers leen todo, members lo propio"
  on audit_log for select to authenticated
  using (
    public.is_workspace_manager(workspace_id)
    or (actor_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

revoke insert, update, delete, truncate on audit_log from anon, authenticated;


-- ============================================================
-- MIGRATION 29: CONTACTO EXTENDIDO
-- ============================================================
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


-- ============================================================
-- MIGRATION 30: CONTACTO ESTADO COMERCIAL
-- ============================================================
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


-- ============================================================
-- MIGRATION 31: IDENTIDAD DE CANAL
-- ============================================================
-- ============================================================
-- IDENTIDAD DE CANAL Y RECONCILIACIÓN DE TELÉFONOS (F26)
-- ============================================================
-- Cuatro cosas:
--
-- 1. EL IDENTIFICADOR CRUDO. `contact_channels.raw_jid` guarda el
--    identificador tal como llegó, sin transformar, y `addressing_mode` cómo se
--    direccionó (`pn` o `lid` en WhatsApp). `messages.remote_jid` guarda el
--    identificador con que llegó cada mensaje. Ninguno se sobrescribe una vez
--    escrito: lo frena un trigger. Es lo que permite reconciliar después y
--    reconstruir qué pasó.
--
--    `raw_jid` queda NULLABLE en esta migración, a propósito. §7.1 lo pide
--    obligatorio, y lo va a ser: el NOT NULL lo pone la migración de F27,
--    cuando el código que lo escribe ya esté desplegado. Ponerlo ahora haría
--    fallar cada contacto nuevo de Instagram en los minutos entre migrar y
--    desplegar, porque el código en producción todavía no lo manda. Las filas
--    existentes (todas de Instagram) se rellenan con `platform_sender_id`, que
--    es exactamente el identificador que mandó Zernio.
--
-- 2. LA IDENTIDAD DEL CANAL ES LA CUENTA, NO LA RANURA DEL PROVEEDOR. El
--    22/09/2026 Zernio le dio a otra cuenta de Instagram el mismo `_id` que
--    tenía la anterior, y la sincronización renombró la fila. Ahora:
--    `platform_account_id` guarda el `platformUserId` de la cuenta, y el
--    `unique (workspace_id, late_account_id)` del fork pasa a ser un índice
--    único SOLO SOBRE CANALES ACTIVOS. Así una ranura reusada se resuelve
--    desactivando la fila vieja y creando otra, sin perder el historial que
--    colgaba de la vieja (`decidirCanalDeCuenta`, `lib/channel-rules.ts`).
--    Ningún código usaba ese unique como `onConflict`: verificado en el repo.
--
-- 3. LA RECONCILIACIÓN. `reconciliar_telefono` carga el teléfono de un
--    contacto, saca la marca de "sin resolver" y lo registra en el historial
--    de auditoría, en la misma operación. Tres vías: un mensaje posterior y el
--    aviso de contacto de Evolution (solo el servidor, F27 las llama), y la
--    carga manual desde la ficha (el usuario que ve el contacto). Si el
--    teléfono ya es de otro contacto, NO escribe: devuelve el conflicto para
--    que una persona confirme la fusión. Y a un Member no le dice cuál es el
--    otro contacto si no es suyo: mostrarlo rompería el scope de leads.
--
-- 4. LA FUSIÓN. `fusionar_contactos` la confirma una persona, nunca es
--    automática, y solo la hacen Owner y Admin: borra un contacto, y deshacerla
--    es caro. Une canales, conversaciones (si chocan en el mismo canal, mueve
--    los mensajes a la que queda), etiquetas, campos propios, inscripciones,
--    sesiones de flujo, destinatarios de difusiones, eventos y atribución (el
--    primer clic más viejo y el último más nuevo). Antes de borrar el absorbido
--    comprueba en el catálogo que NINGUNA tabla con clave hacia `contacts` le
--    siga apuntando: cuando F30 sume `contact_notes`, la fusión falla a los
--    gritos hasta que se las incluya, en vez de borrarlas en cascada. Deja en el
--    historial una foto completa del absorbido, para poder reconstruir qué se
--    unió si se confirmó por error (Flujo 2).
--
-- Y el contador de F26: `contar_mensajes_sin_telefono` cuenta los entrantes de
-- WhatsApp de un período y cuántos llegaron sin teléfono. "Sin teléfono" es un
-- `remote_jid` que termina en `@lid`: Evolution reemplaza el `@lid` por el JID
-- con teléfono cuando lo tiene (investigación de Evolution, verificado en su
-- código), así que el que queda en `@lid` es el que llegó sin número.
--
-- Idempotente: `add column if not exists`, `drop ... if exists`,
-- `create index if not exists` y `create or replace`.
-- ============================================================


-- ── 1. Identificador crudo ───────────────────────────────────────────────

alter table contact_channels
  add column if not exists raw_jid text,
  add column if not exists addressing_mode text;

update contact_channels set raw_jid = platform_sender_id where raw_jid is null;

alter table messages add column if not exists remote_jid text;

comment on column contact_channels.raw_jid is
  'Identificador tal como llegó, sin transformar (F26). No se sobrescribe. NOT NULL lo pone F27.';
comment on column contact_channels.addressing_mode is
  'Cómo se direccionó en WhatsApp: pn o lid (key.addressingMode de Evolution). Nulo en Instagram.';
comment on column messages.remote_jid is
  'Identificador con que llegó el mensaje (F26). No se sobrescribe.';

create or replace function public.identificador_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_viejo text := to_jsonb(old) ->> tg_argv[0];
  v_nuevo text := to_jsonb(new) ->> tg_argv[0];
begin
  if v_viejo is not null and v_nuevo is distinct from v_viejo then
    raise exception '%.% guarda el identificador tal como llegó y no se sobrescribe (F26)', tg_table_name, tg_argv[0]
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_channels_raw_jid_inmutable on contact_channels;
create trigger contact_channels_raw_jid_inmutable
  before update of raw_jid on contact_channels
  for each row execute function public.identificador_inmutable('raw_jid');

drop trigger if exists messages_remote_jid_inmutable on messages;
create trigger messages_remote_jid_inmutable
  before update of remote_jid on messages
  for each row execute function public.identificador_inmutable('remote_jid');


-- ── 2. Identidad del canal ───────────────────────────────────────────────

alter table channels add column if not exists platform_account_id text;

comment on column channels.platform_account_id is
  'Identidad del canal: platformUserId de la cuenta en Zernio (F26). late_account_id es la ranura, que Zernio reusa.';

alter table channels drop constraint if exists channels_workspace_id_late_account_id_key;

create unique index if not exists channels_ranura_activa_key
  on channels (workspace_id, late_account_id)
  where is_active and late_account_id is not null;

create unique index if not exists channels_cuenta_activa_key
  on channels (workspace_id, platform, platform_account_id)
  where is_active and platform_account_id is not null;


-- ── Quién actúa, para el historial ───────────────────────────────────────
-- El nombre se toma en el momento, igual que `actorDe` en lib/auditoria.ts.
create or replace function public.etiqueta_de_actor(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    u.email,
    p_user::text
  )
  from auth.users u where u.id = p_user;
$$;

revoke all on function public.etiqueta_de_actor(uuid) from public, anon, authenticated;


-- ── 3. Reconciliar un teléfono ───────────────────────────────────────────

create or replace function public.reconciliar_telefono(
  p_contacto uuid,
  p_telefono text,
  p_via text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contacts%rowtype;
  v_uid uuid := auth.uid();
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_otro public.contacts%rowtype;
  v_visible boolean;
begin
  if p_via not in ('mensaje', 'aviso_evolution', 'manual') then
    raise exception 'reconciliar_telefono: vía desconocida %', p_via using errcode = '22023';
  end if;
  if p_telefono is null or p_telefono !~ '^\+[1-9][0-9]{0,14}$' then
    raise exception 'reconciliar_telefono: el teléfono tiene que estar en E.164 (§14)' using errcode = '22023';
  end if;

  select * into v_c from public.contacts where id = p_contacto and deleted_at is null;
  if not found then
    raise exception 'reconciliar_telefono: el contacto no existe' using errcode = 'P0002';
  end if;

  -- Las vías automáticas son del servidor. La manual, de quien ve el contacto.
  if p_via <> 'manual' and not v_servidor then
    raise exception 'reconciliar_telefono: la vía % la usa solo el servidor', p_via using errcode = '42501';
  end if;
  if not v_servidor and not public.can_see_contact(v_c.workspace_id, v_c.setter_id, v_c.vendedor_id) then
    raise exception 'reconciliar_telefono: sin acceso a ese contacto' using errcode = '42501';
  end if;

  if v_c.phone = p_telefono then
    return jsonb_build_object('resultado', 'sin_cambios');
  end if;

  -- Nunca por nombre: solo por el teléfono exacto, en el mismo espacio.
  select * into v_otro from public.contacts
  where workspace_id = v_c.workspace_id and phone = p_telefono and id <> v_c.id and deleted_at is null
  order by created_at
  limit 1;

  if found then
    v_visible := v_servidor or public.can_see_contact(v_otro.workspace_id, v_otro.setter_id, v_otro.vendedor_id);
    return jsonb_build_object(
      'resultado', 'conflicto',
      'visible', v_visible,
      'otro_id', case when v_visible then v_otro.id else null end
    );
  end if;

  update public.contacts
    set phone = p_telefono, phone_resolved = true, updated_at = now()
    where id = v_c.id;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id,
    case when v_servidor then null else v_uid end,
    case when v_servidor then 'Sistema' else coalesce(public.etiqueta_de_actor(v_uid), 'Usuario') end,
    case when v_c.phone_resolved then 'contacto.editado' else 'contacto.reconciliado' end,
    'contacto',
    v_c.id,
    v_c.display_name,
    jsonb_build_object('phone', jsonb_build_object('antes', v_c.phone, 'despues', p_telefono)),
    jsonb_build_object('via', p_via)
  );

  return jsonb_build_object('resultado', 'resuelto');
end;
$$;

revoke all on function public.reconciliar_telefono(uuid, text, text) from public, anon;
grant execute on function public.reconciliar_telefono(uuid, text, text) to authenticated, service_role;


-- ── 4. Fusionar dos contactos ────────────────────────────────────────────

create or replace function public.fusionar_contactos(
  p_conservar uuid,
  p_absorber uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contacts%rowtype;
  v_a public.contacts%rowtype;
  v_uid uuid := auth.uid();
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_conv record;
  v_destino uuid;
  v_movidas uuid[] := '{}';
  v_unidas uuid[] := '{}';
  v_foto jsonb;
  v_fc jsonb;
  v_lc jsonb;
  r record;
  v_quedan bigint;
begin
  if p_conservar = p_absorber then
    raise exception 'fusionar_contactos: es el mismo contacto' using errcode = '22023';
  end if;
  select * into v_c from public.contacts where id = p_conservar and deleted_at is null for update;
  select * into v_a from public.contacts where id = p_absorber and deleted_at is null for update;
  if v_c.id is null or v_a.id is null then
    raise exception 'fusionar_contactos: alguno de los dos contactos no existe' using errcode = 'P0002';
  end if;
  if v_c.workspace_id <> v_a.workspace_id then
    raise exception 'fusionar_contactos: son de espacios distintos' using errcode = '22023';
  end if;
  if not v_servidor and not public.is_workspace_manager(v_c.workspace_id) then
    raise exception 'fusionar_contactos: solo Owner y Admin' using errcode = '42501';
  end if;

  -- La foto, antes de mover nada: es lo que permite reconstruir la fusión.
  v_foto := jsonb_build_object(
    'contacto', to_jsonb(v_a),
    'etiquetas', (select coalesce(jsonb_agg(tag_id), '[]') from public.contact_tags where contact_id = v_a.id),
    'campos', (select coalesce(jsonb_agg(jsonb_build_object('field_id', field_id, 'value', value)), '[]')
               from public.contact_custom_fields where contact_id = v_a.id),
    'canales', (select coalesce(jsonb_agg(jsonb_build_object('channel_id', channel_id, 'platform_sender_id', platform_sender_id)), '[]')
                from public.contact_channels where contact_id = v_a.id)
  );

  -- Conversaciones: una por canal y contacto. Si los dos tienen en el mismo
  -- canal, los mensajes pasan a la que queda y la otra se borra vacía.
  for v_conv in select * from public.conversations where contact_id = v_a.id loop
    select id into v_destino from public.conversations
      where contact_id = v_c.id and channel_id = v_conv.channel_id;
    if v_destino is null then
      update public.conversations set contact_id = v_c.id where id = v_conv.id;
      v_movidas := v_movidas || v_conv.id;
    else
      update public.messages set conversation_id = v_destino where conversation_id = v_conv.id;
      update public.conversations d set
        last_message_at = greatest(d.last_message_at, v_conv.last_message_at),
        last_message_preview = case when v_conv.last_message_at > d.last_message_at
                                    then v_conv.last_message_preview else d.last_message_preview end,
        unread_count = coalesce(d.unread_count, 0) + coalesce(v_conv.unread_count, 0),
        assigned_to = coalesce(d.assigned_to, v_conv.assigned_to)
      where d.id = v_destino;
      delete from public.conversations where id = v_conv.id;
      v_unidas := v_unidas || v_conv.id;
    end if;
  end loop;

  update public.contact_channels set contact_id = v_c.id where contact_id = v_a.id;

  insert into public.contact_tags (contact_id, tag_id)
    select v_c.id, tag_id from public.contact_tags where contact_id = v_a.id
    on conflict do nothing;
  delete from public.contact_tags where contact_id = v_a.id;

  -- Campos propios: manda el valor del que queda; el absorbido completa huecos.
  insert into public.contact_custom_fields (contact_id, field_id, value)
    select v_c.id, field_id, value from public.contact_custom_fields where contact_id = v_a.id
    on conflict do nothing;
  delete from public.contact_custom_fields where contact_id = v_a.id;

  -- Inscripciones: una por secuencia. Si los dos estaban, queda la del que queda.
  update public.sequence_enrollments e set contact_id = v_c.id
    where e.contact_id = v_a.id
      and not exists (select 1 from public.sequence_enrollments x where x.contact_id = v_c.id and x.sequence_id = e.sequence_id);
  delete from public.sequence_enrollments where contact_id = v_a.id;

  update public.flow_sessions set contact_id = v_c.id where contact_id = v_a.id;
  update public.broadcast_recipients set contact_id = v_c.id where contact_id = v_a.id;
  update public.analytics_events set contact_id = v_c.id where contact_id = v_a.id;

  -- La atribución: el primer clic más viejo y el último más nuevo. Es la única
  -- escritura que puede cambiar un first_click ya escrito (trigger de la 00029).
  v_fc := case
    when v_c.attribution -> 'first_click' is null then v_a.attribution -> 'first_click'
    when v_a.attribution -> 'first_click' is null then v_c.attribution -> 'first_click'
    when (v_a.attribution #>> '{first_click,captured_at}') < (v_c.attribution #>> '{first_click,captured_at}')
      then v_a.attribution -> 'first_click'
    else v_c.attribution -> 'first_click' end;
  v_lc := case
    when v_c.attribution -> 'last_click' is null then v_a.attribution -> 'last_click'
    when v_a.attribution -> 'last_click' is null then v_c.attribution -> 'last_click'
    when (v_a.attribution #>> '{last_click,captured_at}') > (v_c.attribution #>> '{last_click,captured_at}')
      then v_a.attribution -> 'last_click'
    else v_c.attribution -> 'last_click' end;

  perform set_config('app.fusion_contactos', 'on', true);
  update public.contacts set
    attribution = jsonb_strip_nulls(jsonb_build_object('first_click', v_fc, 'last_click', v_lc)),
    phone = coalesce(phone, v_a.phone),
    phone_resolved = case when coalesce(phone, v_a.phone) is not null then true else phone_resolved and v_a.phone_resolved end,
    email = coalesce(email, v_a.email),
    secondary_email = coalesce(secondary_email, v_a.secondary_email),
    country = coalesce(country, v_a.country),
    whatsapp_phone = coalesce(whatsapp_phone, v_a.whatsapp_phone),
    setter_id = coalesce(setter_id, v_a.setter_id),
    vendedor_id = coalesce(vendedor_id, v_a.vendedor_id),
    last_interaction_at = greatest(last_interaction_at, v_a.last_interaction_at),
    updated_at = now()
  where id = v_c.id;
  perform set_config('app.fusion_contactos', '', true);

  -- La guarda: nada que apunte al absorbido puede irse en cascada sin que
  -- esta función lo haya movido. Una tabla nueva con clave hacia contacts
  -- (contact_notes, de F30) hace fallar la fusión hasta que se la incluya.
  for r in
    select c.conrelid::regclass as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.contacts'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tabla, r.columna) into v_quedan using v_a.id;
    if v_quedan > 0 then
      raise exception 'fusionar_contactos: % todavía tiene % filas del contacto absorbido; hay que sumarla a la fusión', r.tabla, v_quedan
        using errcode = '55000';
    end if;
  end loop;

  delete from public.contacts where id = v_a.id;

  insert into public.audit_log
    (workspace_id, actor_id, actor_label, action, entity_type, entity_id, entity_label, changes, detail)
  values (
    v_c.workspace_id,
    case when v_servidor then null else v_uid end,
    case when v_servidor then 'Sistema' else coalesce(public.etiqueta_de_actor(v_uid), 'Usuario') end,
    'contacto.fusionado',
    'contacto',
    v_c.id,
    v_c.display_name,
    '{}',
    jsonb_build_object(
      'absorbido_id', v_a.id,
      'absorbido_nombre', v_a.display_name,
      'absorbido', v_foto -> 'contacto',
      'foto', v_foto,
      'conversaciones_movidas', to_jsonb(v_movidas),
      'conversaciones_unidas', to_jsonb(v_unidas)
    )
  );

  return jsonb_build_object('resultado', 'fusionado', 'conservado', v_c.id, 'absorbido', v_a.id);
end;
$$;

revoke all on function public.fusionar_contactos(uuid, uuid) from public, anon;
grant execute on function public.fusionar_contactos(uuid, uuid) to authenticated, service_role;


-- ── El contador de F26 ───────────────────────────────────────────────────
-- security invoker: cuenta lo que quien llama puede leer. La pantalla lo
-- muestra solo al Owner (§11, Canales), que lee todo su espacio.
create or replace function public.contar_mensajes_sin_telefono(
  p_workspace uuid,
  p_desde timestamptz
)
returns table (sin_telefono integer, total integer)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where m.remote_jid like '%@lid')::integer,
    count(*)::integer
  from public.messages m
  join public.conversations v on v.id = m.conversation_id
  where v.workspace_id = p_workspace
    and v.platform = 'whatsapp'
    and m.direction = 'inbound'
    and m.created_at >= p_desde;
$$;

revoke all on function public.contar_mensajes_sin_telefono(uuid, timestamptz) from public, anon;
grant execute on function public.contar_mensajes_sin_telefono(uuid, timestamptz) to authenticated, service_role;


-- ============================================================
-- MIGRATION 32: GUARDADO DE MENSAJES
-- ============================================================
-- ============================================================
-- GUARDADO DE MENSAJES ENTRANTES (F27)
-- ============================================================
-- Desde F27 la base es la fuente de verdad de la bandeja: lo que no esté en
-- `messages` no se ve. Esta migración prepara el lugar. Cinco cosas:
--
-- 1. LA UNICIDAD DE UN MENSAJE: conversación + identificador del proveedor +
--    dirección. El identificador solo no alcanza: en WhatsApp lo genera el
--    teléfono que envía y es único por conversación, no en todo el sistema.
--    La conversación es el chat, y no `remote_jid`, porque el mismo chat
--    puede llegar como `@lid` o como teléfono. Y es una RESTRICCIÓN normal,
--    no un índice parcial: PostgREST hace el upsert con `on_conflict`, que
--    solo encuentra restricciones, y Postgres no infiere un índice parcial sin
--    su predicado (probado el 08/10/2026 contra la base, con tablas
--    temporales: el parcial da 42P10). Los nulos no chocan entre sí, así que
--    los envíos fallidos sin identificador no se pisan.
--
-- 2. LO QUE §7.1 PIDE DE CADA MENSAJE: el tipo, el mensaje citado (aunque
--    todavía no exista de nuestro lado) y el estado del adjunto (F28). La
--    dirección ya existe desde el fork (`direction`): no se agrega `from_me`,
--    que podría contradecirla.
--
-- 3. EL PERFIL DEL REMITENTE (relleno de F27): `profile_status` y
--    `profile_attempts`, con techo de 3 intentos. Y `raw_jid` pasa a NOT NULL,
--    como anunció la 00031: los dos caminos que crean `contact_channels`
--    (`lib/inbox-sync.ts` y `lib/comment-processor.ts`) ya lo escriben en
--    producción. Si quedara alguna fila nula, la migración corta con error en
--    vez de inventar un valor.
--
-- 4. QUÉ HILOS ESTÁN COMPLETOS: `conversations.historial_estado`. La
--    importación del historial marca `completo` recién con la última página;
--    un corte a la mitad deja `pendiente`, y volver a sincronizar retoma solo
--    esas. Sin esta marca, la unicidad evita duplicados pero no dice qué hilo
--    quedó a medio traer.
--
-- 5. LAS MARCAS: `channels.last_inbound_at`, el último entrante por canal (lo
--    vigila F39), y `tareas_estado`, una fila por tarea del servidor: la
--    importación la usa para no correr dos veces a la vez, F39 para su marca
--    de última ejecución, y la purga de F30 para la suya. Solo la lee y la
--    escribe el servidor.
--
-- Idempotente: `if not exists`, `drop ... if exists` antes de cada `check` y
-- restricción, y `create or replace`.
-- ============================================================


-- ── 1. Unicidad de un mensaje ────────────────────────────────────────────

alter table messages drop constraint if exists messages_mensaje_unico;
alter table messages
  add constraint messages_mensaje_unico unique (conversation_id, platform_message_id, direction);


-- ── 2. Tipo, citado y adjunto ────────────────────────────────────────────

alter table messages
  add column if not exists message_type text,
  add column if not exists quoted_message_id text,
  add column if not exists media_path text,
  add column if not exists media_status text;

alter table messages drop constraint if exists messages_message_type_check;
alter table messages add constraint messages_message_type_check check (
  message_type is null or message_type in
    ('texto', 'imagen', 'audio', 'documento', 'video', 'sticker', 'ubicacion', 'otro')
);

alter table messages drop constraint if exists messages_media_status_check;
alter table messages add constraint messages_media_status_check check (
  media_status is null or media_status in ('pendiente', 'descargado', 'fallido', 'no_disponible')
);

comment on column messages.message_type is
  'Tipo del mensaje (F27). Nulo en los que escribía el fork antes de F27.';
comment on column messages.quoted_message_id is
  'Identificador del proveedor del mensaje citado. Puede no existir todavía de nuestro lado (F27).';
comment on column messages.media_status is
  'Estado del adjunto (F28). Nulo = el mensaje no tiene adjunto.';


-- ── 3. Perfil del remitente y raw_jid obligatorio ────────────────────────

alter table contact_channels
  add column if not exists profile_status text not null default 'pending',
  add column if not exists profile_attempts smallint not null default 0;

alter table contact_channels drop constraint if exists contact_channels_profile_status_check;
alter table contact_channels add constraint contact_channels_profile_status_check
  check (profile_status in ('pending', 'complete', 'unavailable'));

do $$
declare
  nulos integer;
begin
  select count(*) into nulos from contact_channels where raw_jid is null;
  if nulos > 0 then
    raise exception 'contact_channels tiene % filas con raw_jid nulo: no se pone NOT NULL inventando un valor', nulos;
  end if;
end $$;

alter table contact_channels alter column raw_jid set not null;


-- ── 4. Qué hilos están completos ─────────────────────────────────────────

alter table conversations
  add column if not exists historial_estado text not null default 'pendiente',
  add column if not exists historial_importado_at timestamptz;

alter table conversations drop constraint if exists conversations_historial_estado_check;
alter table conversations add constraint conversations_historial_estado_check
  check (historial_estado in ('pendiente', 'completo', 'incompleto', 'no_disponible'));

comment on column conversations.historial_estado is
  'Si el historial del proveedor ya está entero en la base (F27). completo solo con la última página.';


-- ── 5. Marcas ────────────────────────────────────────────────────────────

alter table channels add column if not exists last_inbound_at timestamptz;

comment on column channels.last_inbound_at is
  'Último mensaje entrante recibido por el receptor (F27). Lo vigila F39.';

create table if not exists tareas_estado (
  clave text primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  ultima_ejecucion_at timestamptz,
  ultimo_ok_at timestamptz,
  ocupada_hasta timestamptz,
  resultado jsonb not null default '{}'::jsonb,
  ultimo_error text,
  updated_at timestamptz not null default now()
);

-- RLS sin políticas: solo la clave de servicio. Las pantallas la leen en el
-- servidor, después de comprobar el rol.
alter table tareas_estado enable row level security;

-- Toma la tarea si nadie la tiene, o si quien la tenía se pasó de su plazo
-- (un redespliegue corta un `after()` sin liberar). Devuelve true si la tomó.
create or replace function public.reservar_tarea(p_clave text, p_workspace_id uuid, p_minutos integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tomada boolean;
begin
  insert into tareas_estado (clave, workspace_id, ocupada_hasta, ultima_ejecucion_at, updated_at)
  values (p_clave, p_workspace_id, now() + make_interval(mins => p_minutos), now(), now())
  on conflict (clave) do update
    set ocupada_hasta = excluded.ocupada_hasta,
        ultima_ejecucion_at = excluded.ultima_ejecucion_at,
        updated_at = now()
    where tareas_estado.ocupada_hasta is null or tareas_estado.ocupada_hasta < now()
  returning true into tomada;
  return coalesce(tomada, false);
end;
$$;

revoke all on function public.reservar_tarea(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reservar_tarea(text, uuid, integer) to service_role;
