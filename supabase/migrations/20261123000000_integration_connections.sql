do $$
begin
  create type public.integration_connection_scope as enum ('personal', 'workspace');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.integration_connection_status as enum (
    'disconnected',
    'connecting',
    'connected',
    'reconnect_required',
    'error',
    'revoked'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.integration_provider as enum ('gmail', 'google_calendar');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.integration_audit_outcome as enum ('success', 'failure', 'denied', 'pending');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  scope public.integration_connection_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_connection_status not null default 'connecting',
  account_label text,
  granted_scopes text[] not null default '{}',
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_scope_workspace_check
    check (
      (scope = 'personal' and workspace_id is null)
      or (scope = 'workspace' and workspace_id is not null)
    ),
  constraint integration_connections_account_label_check
    check (account_label is null or char_length(account_label) between 1 and 254),
  constraint integration_connections_encrypted_access_token_check
    check (char_length(btrim(encrypted_access_token)) between 1 and 8000),
  constraint integration_connections_encrypted_refresh_token_check
    check (encrypted_refresh_token is null or char_length(btrim(encrypted_refresh_token)) between 1 and 8000),
  constraint integration_connections_granted_scopes_check
    check (coalesce(array_length(granted_scopes, 1), 0) <= 12),
  constraint integration_connections_last_error_check
    check (last_error is null or char_length(last_error) <= 500)
);

create unique index if not exists integration_connections_personal_unique
  on public.integration_connections (owner_user_id, provider)
  where scope = 'personal'::public.integration_connection_scope;

create unique index if not exists integration_connections_workspace_unique
  on public.integration_connections (workspace_id, owner_user_id, provider)
  where scope = 'workspace'::public.integration_connection_scope;

create index if not exists integration_connections_workspace_idx
  on public.integration_connections (workspace_id, provider, status);

create table if not exists public.integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  scope public.integration_connection_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider public.integration_provider not null,
  action text not null,
  outcome public.integration_audit_outcome not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint integration_audit_scope_workspace_check
    check (
      (scope = 'personal' and workspace_id is null)
      or (scope = 'workspace' and workspace_id is not null)
    ),
  constraint integration_audit_action_check
    check (char_length(btrim(action)) between 1 and 120),
  constraint integration_audit_details_object_check
    check (jsonb_typeof(details) = 'object')
);

create index if not exists integration_audit_events_scope_created_idx
  on public.integration_audit_events (scope, workspace_id, created_at desc);

create index if not exists integration_audit_events_provider_created_idx
  on public.integration_audit_events (provider, created_at desc);

drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

create or replace function public.protect_integration_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'integration audit events are append-only';
end;
$$;

drop trigger if exists integration_audit_events_append_only on public.integration_audit_events;
create trigger integration_audit_events_append_only
  before update or delete on public.integration_audit_events
  for each row execute function public.protect_integration_audit_mutation();

create or replace function public.integration_workspace_access_allowed(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_user_id uuid,
  p_manage boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then false
    when p_scope = 'personal' then p_workspace_id is null
    when p_workspace_id is null then false
    when not exists (
      select 1
      from public.workspaces w
      where w.id = p_workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    ) then false
    when not public.workspace_has_active_membership(p_workspace_id, p_user_id, null) then false
    when p_manage then public.workspace_has_active_membership(
      p_workspace_id,
      p_user_id,
      array['staff'::public.workspace_member_role, 'manager'::public.workspace_member_role]
    )
    else true
  end;
$$;

create or replace function public.list_integration_connections(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid default null
)
returns setof public.integration_connections
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.integration_connections c
  where public.integration_workspace_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or c.owner_user_id = auth.uid())
  order by c.provider, c.created_at desc;
$$;

create or replace function public.get_integration_connection(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid default null
)
returns public.integration_connections
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.integration_connections c
  where c.id = p_connection_id
    and public.integration_workspace_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or c.owner_user_id = auth.uid());
$$;

create or replace function public.upsert_integration_connection(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_provider public.integration_provider,
  p_status public.integration_connection_status,
  p_account_label text,
  p_granted_scopes text[],
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_token_expires_at text
)
returns public.integration_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.integration_connections%rowtype;
  v_expires_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;
  if p_status is null or p_provider is null then
    raise exception 'A valid provider and status are required.';
  end if;
  if char_length(btrim(coalesce(p_access_token_encrypted, ''))) = 0 then
    raise exception 'An encrypted access token is required.';
  end if;
  if coalesce(array_length(p_granted_scopes, 1), 0) > 12 then
    raise exception 'Too many granted scopes.';
  end if;
  if p_token_expires_at is null or btrim(p_token_expires_at) = '' then
    v_expires_at := null;
  else
    v_expires_at := p_token_expires_at::timestamptz;
  end if;

  if p_scope = 'personal' then
    insert into public.integration_connections (
      owner_user_id, scope, workspace_id, provider, status, account_label,
      granted_scopes, encrypted_access_token, encrypted_refresh_token, token_expires_at, last_error
    )
    values (
      v_user_id, p_scope, null, p_provider, p_status, p_account_label,
      coalesce(p_granted_scopes, '{}'), p_access_token_encrypted, p_refresh_token_encrypted, v_expires_at, null
    )
    on conflict (owner_user_id, provider) where scope = 'personal'::public.integration_connection_scope
    do update set
      status = excluded.status,
      account_label = excluded.account_label,
      granted_scopes = excluded.granted_scopes,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_expires_at = excluded.token_expires_at,
      last_error = null
    returning * into v_result;
  else
    insert into public.integration_connections (
      owner_user_id, scope, workspace_id, provider, status, account_label,
      granted_scopes, encrypted_access_token, encrypted_refresh_token, token_expires_at, last_error
    )
    values (
      v_user_id, p_scope, p_workspace_id, p_provider, p_status, p_account_label,
      coalesce(p_granted_scopes, '{}'), p_access_token_encrypted, p_refresh_token_encrypted, v_expires_at, null
    )
    on conflict (workspace_id, owner_user_id, provider) where scope = 'workspace'::public.integration_connection_scope
    do update set
      status = excluded.status,
      account_label = excluded.account_label,
      granted_scopes = excluded.granted_scopes,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_expires_at = excluded.token_expires_at,
      last_error = null
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

create or replace function public.set_integration_connection_status(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_status public.integration_connection_status,
  p_last_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_status is null then
    raise exception 'Authentication and a valid status are required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;

  update public.integration_connections c
  set status = p_status,
      last_error = nullif(btrim(coalesce(p_last_error, '')), '')
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or c.owner_user_id = v_user_id);
end;
$$;

create or replace function public.update_integration_tokens(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_token_expires_at text,
  p_granted_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_expires_at timestamptz;
begin
  if v_user_id is null or char_length(btrim(coalesce(p_access_token_encrypted, ''))) = 0 then
    raise exception 'Authentication and an encrypted access token are required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;
  if coalesce(array_length(p_granted_scopes, 1), 0) > 12 then
    raise exception 'Too many granted scopes.';
  end if;
  if p_token_expires_at is null or btrim(p_token_expires_at) = '' then
    v_expires_at := null;
  else
    v_expires_at := p_token_expires_at::timestamptz;
  end if;

  update public.integration_connections c
  set encrypted_access_token = p_access_token_encrypted,
      encrypted_refresh_token = p_refresh_token_encrypted,
      token_expires_at = v_expires_at,
      granted_scopes = coalesce(p_granted_scopes, '{}'),
      status = 'connected'::public.integration_connection_status,
      last_error = null
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or c.owner_user_id = v_user_id);
end;
$$;

create or replace function public.delete_integration_connection(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;

  delete from public.integration_connections c
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or c.owner_user_id = v_user_id);
end;
$$;

create or replace function public.record_integration_audit_event(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_provider public.integration_provider,
  p_action text,
  p_outcome public.integration_audit_outcome,
  p_details jsonb
)
returns public.integration_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.integration_audit_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, false) then
    raise exception 'Integration access is not permitted.';
  end if;
  if p_provider is null or p_outcome is null or char_length(btrim(coalesce(p_action, ''))) = 0 then
    raise exception 'A valid audit event is required.';
  end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'Audit details must be an object.';
  end if;

  insert into public.integration_audit_events (
    actor_user_id, scope, workspace_id, provider, action, outcome, details
  )
  values (
    v_user_id, p_scope, p_workspace_id, p_provider, left(btrim(p_action), 120), p_outcome,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.list_integration_audit_events(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_limit integer
)
returns setof public.integration_audit_events
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.integration_audit_events a
  where public.integration_workspace_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and a.scope = p_scope
    and a.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or a.actor_user_id = auth.uid())
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

alter table public.integration_connections enable row level security;
alter table public.integration_audit_events enable row level security;

revoke all on table public.integration_connections from anon, authenticated;
revoke all on table public.integration_audit_events from anon, authenticated;

revoke all on function public.integration_workspace_access_allowed(public.integration_connection_scope, uuid, uuid, boolean) from public;
grant execute on function public.integration_workspace_access_allowed(public.integration_connection_scope, uuid, uuid, boolean) to authenticated, service_role;

revoke all on function public.list_integration_connections(public.integration_connection_scope, uuid) from public;
grant execute on function public.list_integration_connections(public.integration_connection_scope, uuid) to authenticated, service_role;

revoke all on function public.get_integration_connection(uuid, public.integration_connection_scope, uuid) from public;
grant execute on function public.get_integration_connection(uuid, public.integration_connection_scope, uuid) to authenticated, service_role;

revoke all on function public.upsert_integration_connection(public.integration_connection_scope, uuid, public.integration_provider, public.integration_connection_status, text, text[], text, text, text) from public;
grant execute on function public.upsert_integration_connection(public.integration_connection_scope, uuid, public.integration_provider, public.integration_connection_status, text, text[], text, text, text) to authenticated, service_role;

revoke all on function public.set_integration_connection_status(uuid, public.integration_connection_scope, uuid, public.integration_connection_status, text) from public;
grant execute on function public.set_integration_connection_status(uuid, public.integration_connection_scope, uuid, public.integration_connection_status, text) to authenticated, service_role;

revoke all on function public.update_integration_tokens(uuid, public.integration_connection_scope, uuid, text, text, text, text[]) from public;
grant execute on function public.update_integration_tokens(uuid, public.integration_connection_scope, uuid, text, text, text, text[]) to authenticated, service_role;

revoke all on function public.delete_integration_connection(uuid, public.integration_connection_scope, uuid) from public;
grant execute on function public.delete_integration_connection(uuid, public.integration_connection_scope, uuid) to authenticated, service_role;

revoke all on function public.record_integration_audit_event(public.integration_connection_scope, uuid, public.integration_provider, text, public.integration_audit_outcome, jsonb) from public;
grant execute on function public.record_integration_audit_event(public.integration_connection_scope, uuid, public.integration_provider, text, public.integration_audit_outcome, jsonb) to authenticated, service_role;

revoke all on function public.list_integration_audit_events(public.integration_connection_scope, uuid, integer) from public;
grant execute on function public.list_integration_audit_events(public.integration_connection_scope, uuid, integer) to authenticated, service_role;

revoke all on function public.protect_integration_audit_mutation() from public;
