do $$
begin
  create type public.automation_scope as enum ('personal', 'workspace');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.automation_workflow_status as enum ('draft', 'enabled', 'paused', 'disabled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.automation_trigger_type as enum ('schedule', 'event', 'manual');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.automation_execution_status as enum ('pending', 'running', 'succeeded', 'failed', 'skipped');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.automation_audit_outcome as enum ('success', 'failure', 'denied', 'pending');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  scope public.automation_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  owner_role text not null default 'operator',
  name text not null,
  description text not null default '',
  trigger_config jsonb not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null,
  max_actions integer not null default 5,
  max_attempts integer not null default 1,
  retry_delay_seconds integer not null default 60,
  status public.automation_workflow_status not null default 'draft',
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_workflows_scope_workspace_check
    check (
      (scope = 'personal'::public.automation_scope and workspace_id is null)
      or (scope = 'workspace'::public.automation_scope and workspace_id is not null)
    ),
  constraint automation_workflows_name_check
    check (char_length(btrim(name)) between 1 and 120),
  constraint automation_workflows_description_check
    check (char_length(description) <= 500),
  constraint automation_workflows_owner_role_check
    check (owner_role in ('viewer', 'operator', 'admin')),
  constraint automation_workflows_trigger_object_check
    check (jsonb_typeof(trigger_config) = 'object'),
  constraint automation_workflows_trigger_type_check
    check (trigger_config->>'type' in ('schedule', 'event', 'manual')),
  constraint automation_workflows_conditions_check
    check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 10),
  constraint automation_workflows_actions_check
    check (
      jsonb_typeof(actions) = 'array'
      and jsonb_array_length(actions) between 1 and 10
    ),
  constraint automation_workflows_max_actions_check
    check (max_actions between 1 and 10),
  constraint automation_workflows_max_attempts_check
    check (max_attempts between 1 and 3),
  constraint automation_workflows_retry_delay_check
    check (retry_delay_seconds between 0 and 3600)
);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  scope public.automation_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  trigger_type public.automation_trigger_type not null,
  event_type text,
  idempotency_key text not null,
  status public.automation_execution_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  context jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_executions_scope_workspace_check
    check (
      (scope = 'personal'::public.automation_scope and workspace_id is null)
      or (scope = 'workspace'::public.automation_scope and workspace_id is not null)
    ),
  constraint automation_executions_idempotency_check
    check (char_length(btrim(idempotency_key)) between 1 and 300),
  constraint automation_executions_event_type_check
    check (
      event_type is null
      or event_type in (
        'task.created', 'task.updated', 'task.overdue',
        'project.created', 'project.updated', 'project.overdue'
      )
    ),
  constraint automation_executions_context_object_check
    check (jsonb_typeof(context) = 'object'),
  constraint automation_executions_error_check
    check (error is null or char_length(error) <= 500),
  constraint automation_executions_attempts_check
    check (attempts between 0 and max_attempts)
);

create unique index if not exists automation_executions_idempotency_unique
  on public.automation_executions (workflow_id, idempotency_key);

create index if not exists automation_workflows_scope_status_idx
  on public.automation_workflows (scope, workspace_id, status);

create index if not exists automation_executions_workflow_created_idx
  on public.automation_executions (workflow_id, created_at desc);

create index if not exists automation_executions_scope_status_idx
  on public.automation_executions (scope, workspace_id, status, scheduled_for);

create table if not exists public.automation_audit_events (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references public.automation_workflows(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  scope public.automation_scope not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  outcome public.automation_audit_outcome not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint automation_audit_scope_workspace_check
    check (
      (scope = 'personal'::public.automation_scope and workspace_id is null)
      or (scope = 'workspace'::public.automation_scope and workspace_id is not null)
    ),
  constraint automation_audit_action_check
    check (char_length(btrim(action)) between 1 and 120),
  constraint automation_audit_details_object_check
    check (jsonb_typeof(details) = 'object')
);

create index if not exists automation_audit_scope_created_idx
  on public.automation_audit_events (scope, workspace_id, created_at desc);

drop trigger if exists automation_workflows_set_updated_at on public.automation_workflows;
create trigger automation_workflows_set_updated_at
  before update on public.automation_workflows
  for each row execute function public.set_updated_at();

create or replace function public.protect_automation_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'automation audit events are append-only';
end;
$$;

drop trigger if exists automation_audit_events_append_only on public.automation_audit_events;
create trigger automation_audit_events_append_only
  before update or delete on public.automation_audit_events
  for each row execute function public.protect_automation_audit_mutation();

create or replace function public.automation_access_allowed(
  p_scope public.automation_scope,
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

create or replace function public.list_automation_workflows(
  p_scope public.automation_scope,
  p_workspace_id uuid default null
)
returns setof public.automation_workflows
language sql
stable
security definer
set search_path = ''
as $$
  select w.*
  from public.automation_workflows w
  where public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and w.scope = p_scope
    and w.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or w.owner_user_id = auth.uid())
  order by w.created_at desc;
$$;

create or replace function public.get_automation_workflow(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid default null
)
returns public.automation_workflows
language sql
stable
security definer
set search_path = ''
as $$
  select w.*
  from public.automation_workflows w
  where w.id = p_workflow_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and w.scope = p_scope
    and w.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or w.owner_user_id = auth.uid());
$$;

create or replace function public.upsert_automation_workflow(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_name text,
  p_description text,
  p_trigger jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_max_actions integer,
  p_max_attempts integer,
  p_retry_delay_seconds integer,
  p_owner_role text,
  p_status public.automation_workflow_status,
  p_next_run_at text
)
returns public.automation_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_next_run_at timestamptz;
  v_result public.automation_workflows%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.automation_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Automation management is not permitted.';
  end if;
  if p_next_run_at is null or btrim(p_next_run_at) = '' then
    v_next_run_at := null;
  else
    v_next_run_at := p_next_run_at::timestamptz;
  end if;

  if p_workflow_id is null then
    insert into public.automation_workflows (
      owner_user_id, scope, workspace_id, created_by_user_id, owner_role, name,
      description, trigger_config, conditions, actions, max_actions, max_attempts,
      retry_delay_seconds, status, next_run_at
    )
    values (
      v_user_id, p_scope, p_workspace_id, v_user_id, p_owner_role, btrim(p_name),
      coalesce(p_description, ''), p_trigger, coalesce(p_conditions, '[]'::jsonb), p_actions,
      p_max_actions, p_max_attempts, p_retry_delay_seconds, p_status, v_next_run_at
    )
    returning * into v_result;
  else
    update public.automation_workflows w
    set
      name = btrim(p_name),
      description = coalesce(p_description, ''),
      trigger_config = p_trigger,
      conditions = coalesce(p_conditions, '[]'::jsonb),
      actions = p_actions,
      max_actions = p_max_actions,
      max_attempts = p_max_attempts,
      retry_delay_seconds = p_retry_delay_seconds,
      owner_role = p_owner_role,
      status = p_status,
      next_run_at = v_next_run_at
    where w.id = p_workflow_id
      and w.scope = p_scope
      and w.workspace_id is not distinct from p_workspace_id
      and public.automation_access_allowed(p_scope, p_workspace_id, v_user_id, true)
      and (p_scope = 'workspace' or w.owner_user_id = v_user_id)
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

create or replace function public.set_automation_workflow_status(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_status public.automation_workflow_status
)
returns public.automation_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.automation_workflows%rowtype;
begin
  update public.automation_workflows w
  set status = p_status
  where w.id = p_workflow_id
    and w.scope = p_scope
    and w.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), true)
    and (p_scope = 'workspace' or w.owner_user_id = auth.uid())
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.set_automation_next_run(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_next_run_at text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.automation_workflows w
  set next_run_at = case
    when p_next_run_at is null or btrim(p_next_run_at) = '' then null
    else p_next_run_at::timestamptz
  end
  where w.id = p_workflow_id
    and w.scope = p_scope
    and w.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), true)
    and (p_scope = 'workspace' or w.owner_user_id = auth.uid());
end;
$$;

create or replace function public.create_automation_execution(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_trigger_type public.automation_trigger_type,
  p_event_type text,
  p_idempotency_key text,
  p_context jsonb,
  p_scheduled_for text,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workflow public.automation_workflows%rowtype;
  v_result public.automation_executions%rowtype;
  v_created boolean := true;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  select * into v_workflow
  from public.automation_workflows w
  where w.id = p_workflow_id
    and w.scope = p_scope
    and w.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, v_user_id, false)
    and (p_scope = 'workspace' or w.owner_user_id = v_user_id);
  if not found then
    raise exception 'Workflow was not found.';
  end if;

  insert into public.automation_executions (
    workflow_id, owner_user_id, scope, workspace_id, trigger_type, event_type,
    idempotency_key, status, attempts, max_attempts, context, scheduled_for
  )
  values (
    p_workflow_id, v_workflow.owner_user_id, p_scope, p_workspace_id, p_trigger_type,
    p_event_type, btrim(p_idempotency_key), 'pending'::public.automation_execution_status,
    0, least(greatest(p_max_attempts, 1), 3), coalesce(p_context, '{}'::jsonb),
    p_scheduled_for::timestamptz
  )
  on conflict (workflow_id, idempotency_key) do nothing
  returning * into v_result;

  if not found then
    v_created := false;
    select * into v_result
    from public.automation_executions e
    where e.workflow_id = p_workflow_id
      and e.idempotency_key = btrim(p_idempotency_key);
  end if;

  return jsonb_build_object('execution', to_jsonb(v_result), 'created', v_created);
end;
$$;

create or replace function public.claim_automation_execution(
  p_execution_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid
)
returns public.automation_executions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.automation_executions%rowtype;
begin
  update public.automation_executions e
  set status = 'running'::public.automation_execution_status,
      attempts = e.attempts + 1,
      started_at = now()
  where e.id = p_execution_id
    and e.status = 'pending'::public.automation_execution_status
    and e.attempts < e.max_attempts
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and (p_scope = 'workspace' or e.owner_user_id = auth.uid())
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.complete_automation_execution(
  p_execution_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow_id uuid;
begin
  select e.workflow_id into v_workflow_id
  from public.automation_executions e
  where e.id = p_execution_id;

  update public.automation_executions e
  set status = 'succeeded'::public.automation_execution_status,
      result = coalesce(p_result, '{}'::jsonb),
      error = null,
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false);

  if found and v_workflow_id is not null then
    update public.automation_workflows w
    set last_run_at = now()
    where w.id = v_workflow_id;
  end if;
end;
$$;

create or replace function public.fail_automation_execution(
  p_execution_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.automation_executions e
  set status = 'failed'::public.automation_execution_status,
      error = left(btrim(coalesce(p_error, 'Execution failed.')), 500),
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false);
end;
$$;

create or replace function public.skip_automation_execution(
  p_execution_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.automation_executions e
  set status = 'skipped'::public.automation_execution_status,
      error = left(btrim(coalesce(p_error, 'Execution skipped.')), 500),
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id
    and public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false);
end;
$$;

create or replace function public.list_automation_executions(
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_workflow_id uuid,
  p_status text,
  p_limit integer
)
returns setof public.automation_executions
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
  from public.automation_executions e
  where public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or e.owner_user_id = auth.uid())
    and (p_workflow_id is null or e.workflow_id = p_workflow_id)
    and (
      p_status is null
      or e.status = p_status::public.automation_execution_status
    )
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.record_automation_audit_event(
  p_workflow_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_outcome public.automation_audit_outcome,
  p_details jsonb
)
returns public.automation_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.automation_audit_events%rowtype;
  v_user_id uuid := auth.uid();
  v_owner_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if p_workflow_id is not null then
    select w.owner_user_id into v_owner_user_id
    from public.automation_workflows w
    where w.id = p_workflow_id;
  else
    v_owner_user_id := v_user_id;
  end if;
  insert into public.automation_audit_events (
    workflow_id, owner_user_id, scope, workspace_id, actor_user_id, action, outcome, details
  )
  values (
    p_workflow_id, coalesce(v_owner_user_id, v_user_id), p_scope, p_workspace_id,
    coalesce(p_actor_user_id, v_user_id), left(btrim(p_action), 120), p_outcome,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.list_automation_audit_events(
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_limit integer
)
returns setof public.automation_audit_events
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.automation_audit_events a
  where public.automation_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and a.scope = p_scope
    and a.workspace_id is not distinct from p_workspace_id
    and (p_scope = 'workspace' or a.owner_user_id = auth.uid())
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

alter table public.automation_workflows enable row level security;
alter table public.automation_executions enable row level security;
alter table public.automation_audit_events enable row level security;

revoke all on table public.automation_workflows from anon, authenticated;
revoke all on table public.automation_executions from anon, authenticated;
revoke all on table public.automation_audit_events from anon, authenticated;

revoke all on function public.automation_access_allowed(public.automation_scope, uuid, uuid, boolean) from public;
grant execute on function public.automation_access_allowed(public.automation_scope, uuid, uuid, boolean) to authenticated, service_role;

revoke all on function public.list_automation_workflows(public.automation_scope, uuid) from public;
grant execute on function public.list_automation_workflows(public.automation_scope, uuid) to authenticated, service_role;

revoke all on function public.get_automation_workflow(uuid, public.automation_scope, uuid) from public;
grant execute on function public.get_automation_workflow(uuid, public.automation_scope, uuid) to authenticated, service_role;

revoke all on function public.upsert_automation_workflow(uuid, public.automation_scope, uuid, text, text, jsonb, jsonb, jsonb, integer, integer, integer, text, public.automation_workflow_status, text) from public;
grant execute on function public.upsert_automation_workflow(uuid, public.automation_scope, uuid, text, text, jsonb, jsonb, jsonb, integer, integer, integer, text, public.automation_workflow_status, text) to authenticated, service_role;

revoke all on function public.set_automation_workflow_status(uuid, public.automation_scope, uuid, public.automation_workflow_status) from public;
grant execute on function public.set_automation_workflow_status(uuid, public.automation_scope, uuid, public.automation_workflow_status) to authenticated, service_role;

revoke all on function public.set_automation_next_run(uuid, public.automation_scope, uuid, text) from public;
grant execute on function public.set_automation_next_run(uuid, public.automation_scope, uuid, text) to authenticated, service_role;

revoke all on function public.create_automation_execution(uuid, public.automation_scope, uuid, public.automation_trigger_type, text, text, jsonb, text, integer) from public;
grant execute on function public.create_automation_execution(uuid, public.automation_scope, uuid, public.automation_trigger_type, text, text, jsonb, text, integer) to authenticated, service_role;

revoke all on function public.claim_automation_execution(uuid, public.automation_scope, uuid) from public;
grant execute on function public.claim_automation_execution(uuid, public.automation_scope, uuid) to authenticated, service_role;

revoke all on function public.complete_automation_execution(uuid, public.automation_scope, uuid, jsonb) from public;
grant execute on function public.complete_automation_execution(uuid, public.automation_scope, uuid, jsonb) to authenticated, service_role;

revoke all on function public.fail_automation_execution(uuid, public.automation_scope, uuid, text) from public;
grant execute on function public.fail_automation_execution(uuid, public.automation_scope, uuid, text) to authenticated, service_role;

revoke all on function public.skip_automation_execution(uuid, public.automation_scope, uuid, text) from public;
grant execute on function public.skip_automation_execution(uuid, public.automation_scope, uuid, text) to authenticated, service_role;

revoke all on function public.list_automation_executions(public.automation_scope, uuid, uuid, text, integer) from public;
grant execute on function public.list_automation_executions(public.automation_scope, uuid, uuid, text, integer) to authenticated, service_role;

revoke all on function public.record_automation_audit_event(uuid, public.automation_scope, uuid, uuid, text, public.automation_audit_outcome, jsonb) from public;
grant execute on function public.record_automation_audit_event(uuid, public.automation_scope, uuid, uuid, text, public.automation_audit_outcome, jsonb) to authenticated, service_role;

revoke all on function public.list_automation_audit_events(public.automation_scope, uuid, integer) from public;
grant execute on function public.list_automation_audit_events(public.automation_scope, uuid, integer) to authenticated, service_role;

revoke all on function public.protect_automation_audit_mutation() from public;
