create table if not exists public.approval_requests (
  approval_ref text primary key check (approval_ref ~ '^appr_[A-Za-z0-9_-]+$'),
  request_id text not null check (btrim(request_id) <> ''),
  tool_name text not null check (btrim(tool_name) <> ''),
  raw_arguments text not null check (btrim(raw_arguments) <> ''),
  summary text not null check (btrim(summary) <> ''),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text,
  workspace_id uuid references public.workspaces(id) on delete restrict,
  workspace_kind text not null check (workspace_kind in ('personal', 'shared')),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'executing', 'executed', 'expired', 'failed')
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decision_by uuid,
  decision_at timestamptz,
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  execution_result jsonb,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  constraint approval_requests_expiry_check check (expires_at > created_at),
  constraint approval_requests_scope_check check (
    (workspace_kind = 'personal' and workspace_id is null)
    or (workspace_kind = 'shared' and workspace_id is not null)
  )
);

create index if not exists approval_requests_user_status_idx
  on public.approval_requests (user_id, status, expires_at desc);
create index if not exists approval_requests_workspace_status_idx
  on public.approval_requests (workspace_id, status, expires_at desc)
  where workspace_id is not null;

create table if not exists public.approval_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('personal', 'shared')),
  workspace_id uuid references public.workspaces(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  request_id text,
  tool_name text,
  operation text not null check (btrim(operation) <> ''),
  status text not null check (
    status in ('permitted', 'denied', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed')
  ),
  permission_decision jsonb,
  approval_ref text,
  approval_decision jsonb,
  execution_outcome jsonb,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  constraint approval_audit_scope_check check (
    (scope = 'personal' and workspace_id is null)
    or (scope = 'shared' and workspace_id is not null)
  ),
  constraint approval_audit_json_check check (
    (permission_decision is null or jsonb_typeof(permission_decision) = 'object')
    and (approval_decision is null or jsonb_typeof(approval_decision) = 'object')
    and (execution_outcome is null or jsonb_typeof(execution_outcome) = 'object')
  )
);

create index if not exists approval_audit_owner_occurred_idx
  on public.approval_audit_events (owner_user_id, occurred_at desc);
create index if not exists approval_audit_workspace_occurred_idx
  on public.approval_audit_events (workspace_id, occurred_at desc)
  where workspace_id is not null;
create index if not exists approval_audit_request_idx
  on public.approval_audit_events (request_id, occurred_at desc)
  where request_id is not null;

create or replace function public.approval_request_tool_allowed(p_tool_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p_tool_name, '')) in (
    'create_project',
    'update_project',
    'create_project_task',
    'update_project_task',
    'prepare_integration_email_draft',
    'prepare_integration_calendar_event',
    'prepare_automation_workflow'
  );
$$;

create or replace function public.approval_request_personal_owner(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.workspaces w
    where w.workspace_type = 'personal'::public.workspace_type
      and w.owner_user_id = p_user_id
  );
end;
$$;

create or replace function public.approval_request_workspace_allowed(
  p_workspace_id uuid,
  p_user_id uuid,
  p_write boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_type public.workspace_type;
begin
  if p_workspace_id is null or p_user_id is null then
    return false;
  end if;

  select w.workspace_type into v_workspace_type
  from public.workspaces w
  where w.id = p_workspace_id;

  if v_workspace_type is distinct from 'business'::public.workspace_type then
    return false;
  end if;

  if coalesce(p_write, false) then
    return public.workspace_has_active_membership(
      p_workspace_id,
      p_user_id,
      array['staff'::public.workspace_member_role, 'manager'::public.workspace_member_role]
    );
  end if;

  return public.workspace_has_active_membership(
    p_workspace_id,
    p_user_id,
    array[
      'viewer'::public.workspace_member_role,
      'staff'::public.workspace_member_role,
      'manager'::public.workspace_member_role
    ]
  );
end;
$$;

create or replace function public.approval_request_access_allowed(
  p_owner_user_id uuid,
  p_scope text,
  p_workspace_id uuid,
  p_user_id uuid,
  p_write boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_owner_user_id is null then
    return false;
  end if;

  if p_scope = 'personal' then
    return p_owner_user_id = p_user_id
      and p_workspace_id is null
      and public.approval_request_personal_owner(p_user_id);
  end if;

  if p_scope = 'shared' then
    return public.approval_request_workspace_allowed(
      p_workspace_id,
      p_user_id,
      coalesce(p_write, false)
    );
  end if;

  return false;
end;
$$;

create or replace function public.approval_request_decision_allowed(
  p_tool_name text,
  p_owner_user_id uuid,
  p_scope text,
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.approval_request_tool_allowed(p_tool_name)
    and public.approval_request_access_allowed(
      p_owner_user_id,
      p_scope,
      p_workspace_id,
      p_user_id,
      true
    );
end;
$$;

create or replace function public.insert_approval_audit_event(
  p_owner_user_id uuid,
  p_scope text,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_request_id text,
  p_tool_name text,
  p_operation text,
  p_status text,
  p_permission_decision jsonb,
  p_approval_ref text,
  p_approval_decision jsonb,
  p_execution_outcome jsonb,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.approval_audit_events (
    owner_user_id,
    scope,
    workspace_id,
    actor_user_id,
    request_id,
    tool_name,
    operation,
    status,
    permission_decision,
    approval_ref,
    approval_decision,
    execution_outcome,
    details
  )
  values (
    p_owner_user_id,
    p_scope,
    p_workspace_id,
    p_actor_user_id,
    p_request_id,
    p_tool_name,
    p_operation,
    p_status,
    p_permission_decision,
    p_approval_ref,
    p_approval_decision,
    p_execution_outcome,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.approval_request_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_operation text;
  v_status text;
  v_approved boolean;
begin
  if v_actor is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.insert_approval_audit_event(
      new.user_id,
      new.workspace_kind,
      new.workspace_id,
      v_actor,
      new.request_id,
      new.tool_name,
      'approval_requested',
      'pending_approval',
      null,
      new.approval_ref,
      jsonb_build_object('approvalId', new.approval_ref, 'approved', false),
      null,
      jsonb_build_object('summary', new.summary)
    );
    return null;
  end if;

  if old.status is distinct from new.status then
    v_status := new.status;
    if v_status = 'approved' then
      v_operation := 'approval_decision';
      v_approved := true;
    elsif v_status = 'rejected' then
      v_operation := 'approval_decision';
      v_approved := false;
    elsif v_status = 'executing' then
      v_operation := 'approval_execution';
      v_approved := true;
    elsif v_status = 'executed' then
      v_operation := 'tool_execution';
      v_approved := true;
    elsif v_status = 'failed' then
      v_operation := 'approval_execution';
      v_approved := true;
    elsif v_status = 'expired' then
      v_operation := 'approval_expired';
      v_approved := false;
    else
      return null;
    end if;

    perform public.insert_approval_audit_event(
      new.user_id,
      new.workspace_kind,
      new.workspace_id,
      coalesce(new.decision_by, v_actor),
      new.request_id,
      new.tool_name,
      v_operation,
      v_status,
      null,
      new.approval_ref,
      jsonb_build_object(
        'approvalId', new.approval_ref,
        'approved', v_approved,
        'decisionBy', coalesce(new.decision_by::text, v_actor::text)
      ),
      case
        when v_status = 'executed' then jsonb_build_object('ok', true)
        when v_status = 'failed' then jsonb_build_object('ok', false, 'reason', new.failure_reason)
        else null
      end,
      jsonb_build_object('summary', new.summary)
    );
  end if;

  return null;
end;
$$;

drop trigger if exists approval_requests_audit_lifecycle on public.approval_requests;
create trigger approval_requests_audit_lifecycle
after insert or update of status, decision_by, execution_result, failure_reason
on public.approval_requests
for each row execute function public.approval_request_audit_trigger();

create or replace function public.protect_approval_audit_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Approval audit events are append-only.';
end;
$$;

drop trigger if exists approval_audit_events_append_only on public.approval_audit_events;
create trigger approval_audit_events_append_only
before update or delete on public.approval_audit_events
for each row execute function public.protect_approval_audit_events();
drop trigger if exists approval_audit_events_no_truncate on public.approval_audit_events;
create trigger approval_audit_events_no_truncate
before truncate on public.approval_audit_events
for each statement execute function public.protect_approval_audit_events();

create or replace function public.create_approval_request(
  p_request_id text,
  p_tool_name text,
  p_raw_arguments text,
  p_summary text,
  p_details jsonb,
  p_resource_id text,
  p_workspace_id uuid,
  p_workspace_kind text,
  p_ttl_ms integer
)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope text := lower(btrim(coalesce(p_workspace_kind, 'personal')));
  v_ttl integer := least(greatest(coalesce(p_ttl_ms, 900000), 1), 86400000);
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.approval_request_tool_allowed(p_tool_name) then
    raise exception 'This tool cannot be approved.';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'A request id is required.';
  end if;
  if btrim(coalesce(p_raw_arguments, '')) = '' then
    raise exception 'Approval arguments are required.';
  end if;
  if btrim(coalesce(p_summary, '')) = '' then
    raise exception 'An approval summary is required.';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Approval details must be an object.';
  end if;
  if v_scope not in ('personal', 'shared') then
    raise exception 'Invalid approval scope.';
  end if;

  if v_scope = 'personal' then
    if p_workspace_id is not null then
      raise exception 'Personal approvals cannot carry a workspace id.';
    end if;
    if not public.approval_request_personal_owner(v_user_id) then
      raise exception 'Personal workspace ownership is required.';
    end if;
  else
    if p_workspace_id is null then
      raise exception 'A verified workspace is required.';
    end if;
    if not public.approval_request_workspace_allowed(p_workspace_id, v_user_id, true) then
      raise exception 'Unauthorized approval creation.';
    end if;
  end if;

  insert into public.approval_requests (
    approval_ref,
    request_id,
    tool_name,
    raw_arguments,
    summary,
    details,
    user_id,
    resource_id,
    workspace_id,
    workspace_kind,
    status,
    created_at,
    expires_at
  )
  values (
    'appr_' || replace(gen_random_uuid()::text, '-', ''),
    btrim(p_request_id),
    btrim(p_tool_name),
    p_raw_arguments,
    btrim(p_summary),
    p_details,
    v_user_id,
    nullif(btrim(coalesce(p_resource_id, '')), ''),
    p_workspace_id,
    v_scope,
    'pending',
    now(),
    now() + make_interval(secs => v_ttl / 1000.0)
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_approval_request(p_approval_id text)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''));

  if not found then
    return null;
  end if;

  if not public.approval_request_access_allowed(
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id,
    false
  ) then
    return null;
  end if;

  if v_row.status = 'pending' and now() > v_row.expires_at then
    update public.approval_requests a
    set status = 'expired'
    where a.approval_ref = v_row.approval_ref
      and a.status = 'pending'
      and now() > a.expires_at
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.decide_approval_request(
  p_approval_id text,
  p_decision text
)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_next_status text := lower(btrim(coalesce(p_decision, '')));
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if v_next_status not in ('approve', 'reject') then
    raise exception 'The approval decision must be approve or reject.';
  end if;
  if v_next_status = 'approve' then
    v_next_status := 'approved';
  else
    v_next_status := 'rejected';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''))
  for update;

  if not found or not public.approval_request_decision_allowed(
    v_row.tool_name,
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id
  ) then
    raise exception 'Approval request not found.';
  end if;

  if v_row.status = 'pending' and now() > v_row.expires_at then
    update public.approval_requests a
    set status = 'expired'
    where a.approval_ref = v_row.approval_ref
      and a.status = 'pending'
      and now() > a.expires_at
    returning * into v_row;
    raise exception 'Approval request has expired.';
  end if;

  if v_row.status = v_next_status then
    return v_row;
  end if;

  if v_row.status <> 'pending' then
    raise exception 'Approval request cannot be decided.';
  end if;

  update public.approval_requests a
  set status = v_next_status,
      decision_by = v_user_id,
      decision_at = now()
  where a.approval_ref = v_row.approval_ref
    and a.status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Approval request cannot be decided.';
  end if;

  return v_row;
end;
$$;

create or replace function public.begin_approval_execution_request(p_approval_id text)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''))
  for update;

  if not found or not public.approval_request_decision_allowed(
    v_row.tool_name,
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id
  ) then
    raise exception 'Approval request not found.';
  end if;

  if v_row.status = 'executing' then
    raise exception 'Approval request is already being executed.';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'Approval request cannot be executed.';
  end if;

  update public.approval_requests a
  set status = 'executing',
      execution_started_at = now()
  where a.approval_ref = v_row.approval_ref
    and a.status = 'approved'
  returning * into v_row;

  if not found then
    raise exception 'Approval request cannot be executed.';
  end if;

  return v_row;
end;
$$;

create or replace function public.complete_approval_execution_request(
  p_approval_id text,
  p_result jsonb
)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''))
  for update;

  if not found or not public.approval_request_decision_allowed(
    v_row.tool_name,
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id
  ) then
    raise exception 'Approval request not found.';
  end if;

  if v_row.status = 'executed' then
    return v_row;
  end if;
  if v_row.status not in ('approved', 'executing') then
    raise exception 'Approval request cannot be completed.';
  end if;

  update public.approval_requests a
  set status = 'executed',
      execution_completed_at = now(),
      execution_result = p_result,
      failure_reason = null
  where a.approval_ref = v_row.approval_ref
    and a.status in ('approved', 'executing')
  returning * into v_row;

  if not found then
    raise exception 'Approval request cannot be completed.';
  end if;

  return v_row;
end;
$$;

create or replace function public.fail_approval_execution_request(
  p_approval_id text,
  p_reason text
)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''))
  for update;

  if not found or not public.approval_request_decision_allowed(
    v_row.tool_name,
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id
  ) then
    raise exception 'Approval request not found.';
  end if;

  if v_row.status = 'failed' then
    return v_row;
  end if;
  if v_row.status not in ('approved', 'executing') then
    raise exception 'Approval request cannot be marked failed.';
  end if;

  update public.approval_requests a
  set status = 'failed',
      failure_reason = left(btrim(coalesce(p_reason, 'Execution failed.')), 500)
  where a.approval_ref = v_row.approval_ref
    and a.status in ('approved', 'executing')
  returning * into v_row;

  if not found then
    raise exception 'Approval request cannot be marked failed.';
  end if;

  return v_row;
end;
$$;

create or replace function public.expire_approval_request(p_approval_id text)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.approval_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select a.* into v_row
  from public.approval_requests a
  where a.approval_ref = btrim(coalesce(p_approval_id, ''))
  for update;

  if not found or not public.approval_request_access_allowed(
    v_row.user_id,
    v_row.workspace_kind,
    v_row.workspace_id,
    v_user_id,
    true
  ) then
    raise exception 'Approval request not found.';
  end if;

  if v_row.status = 'expired' then
    return v_row;
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Approval request cannot be expired.';
  end if;

  update public.approval_requests a
  set status = 'expired'
  where a.approval_ref = v_row.approval_ref
    and a.status = 'pending'
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_tool_audit_event(
  p_scope text,
  p_workspace_id uuid,
  p_request_id text,
  p_tool_name text,
  p_operation text,
  p_status text,
  p_permission_decision jsonb,
  p_approval_ref text,
  p_approval_decision jsonb,
  p_execution_outcome jsonb,
  p_details jsonb
)
returns public.approval_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope text := lower(btrim(coalesce(p_scope, 'personal')));
  v_decision jsonb := p_approval_decision;
  v_owner uuid := v_user_id;
  v_row public.approval_audit_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if btrim(coalesce(p_operation, '')) = '' then
    raise exception 'An audit operation is required.';
  end if;
  if btrim(coalesce(p_status, '')) not in (
    'permitted', 'denied', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed'
  ) then
    raise exception 'Invalid audit status.';
  end if;
  if p_details is not null and jsonb_typeof(p_details) <> 'object' then
    raise exception 'Audit details must be an object.';
  end if;
  if v_scope not in ('personal', 'shared') then
    raise exception 'Invalid audit scope.';
  end if;

  if v_scope = 'personal' then
    if p_workspace_id is not null then
      raise exception 'Personal audit events cannot carry a workspace id.';
    end if;
    if not public.approval_request_personal_owner(v_user_id) then
      raise exception 'Unauthorized audit event.';
    end if;
  else
    if p_workspace_id is null then
      raise exception 'A verified workspace is required.';
    end if;
    if not public.approval_request_workspace_allowed(p_workspace_id, v_user_id, false) then
      raise exception 'Unauthorized audit event.';
    end if;
  end if;

  if p_approval_ref is not null then
    select a.user_id into v_owner
    from public.approval_requests a
    where a.approval_ref = btrim(p_approval_ref);
    if not found or not public.approval_request_access_allowed(
      v_owner,
      v_scope,
      p_workspace_id,
      v_user_id,
      false
    ) then
      raise exception 'Unauthorized audit event.';
    end if;
  end if;

  if v_decision is not null then
    v_decision := v_decision || jsonb_build_object('decisionBy', v_user_id::text);
  end if;

  insert into public.approval_audit_events (
    owner_user_id,
    scope,
    workspace_id,
    actor_user_id,
    request_id,
    tool_name,
    operation,
    status,
    permission_decision,
    approval_ref,
    approval_decision,
    execution_outcome,
    details
  )
  values (
    v_owner,
    v_scope,
    p_workspace_id,
    v_user_id,
    nullif(btrim(coalesce(p_request_id, '')), ''),
    nullif(btrim(coalesce(p_tool_name, '')), ''),
    btrim(p_operation),
    btrim(p_status),
    p_permission_decision,
    nullif(btrim(coalesce(p_approval_ref, '')), ''),
    v_decision,
    p_execution_outcome,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.list_tool_audit_events(
  p_request_id text,
  p_tool_name text,
  p_status text,
  p_limit integer
)
returns setof public.approval_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  return query
  select a.*
  from public.approval_audit_events a
  where (
      (a.scope = 'personal' and a.owner_user_id = v_user_id)
      or (
        a.scope = 'shared'
        and public.approval_request_workspace_allowed(a.workspace_id, v_user_id, false)
      )
    )
    and (p_request_id is null or a.request_id = btrim(p_request_id))
    and (p_tool_name is null or a.tool_name = btrim(p_tool_name))
    and (p_status is null or a.status = btrim(p_status))
  order by a.occurred_at desc, a.id desc
  limit v_limit;
end;
$$;

alter table public.approval_requests enable row level security;
alter table public.approval_audit_events enable row level security;

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select
on public.approval_requests
for select
to authenticated
using (
  (workspace_kind = 'personal' and user_id = auth.uid())
  or (
    workspace_kind = 'shared'
    and public.approval_request_workspace_allowed(workspace_id, auth.uid(), false)
  )
);

drop policy if exists approval_audit_events_select on public.approval_audit_events;
create policy approval_audit_events_select
on public.approval_audit_events
for select
to authenticated
using (
  (scope = 'personal' and owner_user_id = auth.uid())
  or (
    scope = 'shared'
    and public.approval_request_workspace_allowed(workspace_id, auth.uid(), false)
  )
);

revoke all on public.approval_requests from public, anon;
revoke all on public.approval_audit_events from public, anon;
grant select on public.approval_requests to authenticated;
grant select on public.approval_audit_events to authenticated;
grant all on public.approval_requests to service_role;
grant all on public.approval_audit_events to service_role;

revoke all on function public.approval_request_tool_allowed(text) from public, anon;
revoke all on function public.approval_request_personal_owner(uuid) from public, anon;
revoke all on function public.approval_request_workspace_allowed(uuid, uuid, boolean) from public, anon;
revoke all on function public.approval_request_access_allowed(uuid, text, uuid, uuid, boolean) from public, anon;
revoke all on function public.approval_request_decision_allowed(text, uuid, text, uuid, uuid) from public, anon;
revoke all on function public.insert_approval_audit_event(uuid, text, uuid, uuid, text, text, text, text, jsonb, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.approval_request_audit_trigger() from public, anon;
revoke all on function public.protect_approval_audit_events() from public, anon;

revoke all on function public.create_approval_request(text, text, text, text, jsonb, text, uuid, text, integer) from public, anon;
revoke all on function public.get_approval_request(text) from public, anon;
revoke all on function public.decide_approval_request(text, text) from public, anon;
revoke all on function public.begin_approval_execution_request(text) from public, anon;
revoke all on function public.complete_approval_execution_request(text, jsonb) from public, anon;
revoke all on function public.fail_approval_execution_request(text, text) from public, anon;
revoke all on function public.expire_approval_request(text) from public, anon;
revoke all on function public.record_tool_audit_event(text, uuid, text, text, text, text, jsonb, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.list_tool_audit_events(text, text, text, integer) from public, anon;

grant execute on function public.approval_request_tool_allowed(text) to authenticated, service_role;
grant execute on function public.approval_request_personal_owner(uuid) to authenticated, service_role;
grant execute on function public.approval_request_workspace_allowed(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.approval_request_access_allowed(uuid, text, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.approval_request_decision_allowed(text, uuid, text, uuid, uuid) to authenticated, service_role;

grant execute on function public.create_approval_request(text, text, text, text, jsonb, text, uuid, text, integer) to authenticated, service_role;
grant execute on function public.get_approval_request(text) to authenticated, service_role;
grant execute on function public.decide_approval_request(text, text) to authenticated, service_role;
grant execute on function public.begin_approval_execution_request(text) to authenticated, service_role;
grant execute on function public.complete_approval_execution_request(text, jsonb) to authenticated, service_role;
grant execute on function public.fail_approval_execution_request(text, text) to authenticated, service_role;
grant execute on function public.expire_approval_request(text) to authenticated, service_role;
grant execute on function public.record_tool_audit_event(text, uuid, text, text, text, text, jsonb, text, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.list_tool_audit_events(text, text, text, integer) to authenticated, service_role;
