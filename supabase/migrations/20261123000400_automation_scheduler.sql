create table if not exists public.automation_scheduler_config (
  id boolean primary key default true,
  secret_hash bytea not null,
  updated_at timestamptz not null default now(),
  constraint automation_scheduler_config_singleton check (id)
);

alter table public.automation_scheduler_config enable row level security;

revoke all on table public.automation_scheduler_config from public, anon, authenticated, service_role;

create or replace function public.set_automation_scheduler_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or char_length(btrim(p_secret)) < 32 then
    raise exception 'Scheduler secret must be at least 32 characters.';
  end if;

  insert into public.automation_scheduler_config (id, secret_hash, updated_at)
  values (true, extensions.digest(btrim(p_secret), 'sha256'), now())
  on conflict (id) do update
    set secret_hash = excluded.secret_hash,
        updated_at = now();
end;
$$;

revoke all on function public.set_automation_scheduler_secret(text) from public, anon, authenticated;
grant execute on function public.set_automation_scheduler_secret(text) to service_role;

create or replace function public.automation_scheduler_authorized(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_secret is null or char_length(p_secret) < 32 then false
    else exists (
      select 1
      from public.automation_scheduler_config c
      where c.id = true
        and c.secret_hash = extensions.digest(p_secret, 'sha256')
    )
  end;
$$;

revoke all on function public.automation_scheduler_authorized(text) from public, anon, authenticated, service_role;

create or replace function public.scheduler_list_due_automation_workflows(
  p_secret text,
  p_limit integer default 100
)
returns setof public.automation_workflows
language sql
stable
security definer
set search_path = ''
as $$
  select w.*
  from public.automation_workflows w
  where public.automation_scheduler_authorized(p_secret)
    and w.status = 'enabled'::public.automation_workflow_status
    and w.trigger_config->>'type' = 'schedule'
    and w.next_run_at is not null
    and w.next_run_at <= now()
    and (
      (w.scope = 'personal'::public.automation_scope and w.workspace_id is null)
      or (
        w.scope = 'workspace'::public.automation_scope
        and w.workspace_id is not null
        and exists (
          select 1
          from public.workspaces ws
          where ws.id = w.workspace_id
            and ws.workspace_type = 'business'::public.workspace_type
        )
        and public.workspace_has_active_membership(w.workspace_id, w.created_by_user_id, null)
      )
    )
  order by w.next_run_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.scheduler_get_automation_workflow(
  p_secret text,
  p_workflow_id uuid
)
returns public.automation_workflows
language sql
stable
security definer
set search_path = ''
as $$
  select w.*
  from public.automation_workflows w
  where public.automation_scheduler_authorized(p_secret)
    and w.id = p_workflow_id;
$$;

create or replace function public.scheduler_claim_due_automation(
  p_secret text,
  p_workflow_id uuid,
  p_context jsonb,
  p_next_run_at text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.automation_workflows%rowtype;
  v_execution public.automation_executions%rowtype;
  v_created boolean := true;
  v_scheduled_for timestamptz;
  v_next_run_at timestamptz;
  v_key text;
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  select w.* into v_workflow
  from public.automation_workflows w
  where w.id = p_workflow_id
    and w.status = 'enabled'::public.automation_workflow_status
    and w.trigger_config->>'type' = 'schedule'
    and w.next_run_at is not null
    and w.next_run_at <= now()
  for update;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  v_scheduled_for := v_workflow.next_run_at;
  v_next_run_at := p_next_run_at::timestamptz;
  if v_next_run_at is null or v_next_run_at <= v_scheduled_for then
    raise exception 'Next run must be after the scheduled slot.';
  end if;

  v_key := 'schedule:' || v_workflow.id::text || ':' ||
    to_char(v_scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  insert into public.automation_executions (
    workflow_id, owner_user_id, scope, workspace_id, trigger_type, event_type,
    idempotency_key, status, attempts, max_attempts, context, scheduled_for
  )
  values (
    v_workflow.id, v_workflow.owner_user_id, v_workflow.scope, v_workflow.workspace_id,
    'schedule'::public.automation_trigger_type, null, v_key,
    'pending'::public.automation_execution_status, 0, v_workflow.max_attempts,
    coalesce(p_context, '{}'::jsonb), v_scheduled_for
  )
  on conflict (workflow_id, idempotency_key) do nothing
  returning * into v_execution;

  if not found then
    v_created := false;
    select e.* into v_execution
    from public.automation_executions e
    where e.workflow_id = v_workflow.id
      and e.idempotency_key = v_key;
  end if;

  update public.automation_workflows w
  set next_run_at = v_next_run_at
  where w.id = v_workflow.id
    and w.next_run_at = v_scheduled_for;

  return jsonb_build_object(
    'claimed', true,
    'created', v_created,
    'execution', to_jsonb(v_execution)
  );
end;
$$;

create or replace function public.scheduler_list_due_automation_executions(
  p_secret text,
  p_limit integer default 100
)
returns setof public.automation_executions
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
  from public.automation_executions e
  where public.automation_scheduler_authorized(p_secret)
    and e.status = 'pending'::public.automation_execution_status
    and e.attempts < e.max_attempts
    and e.scheduled_for <= now()
  order by e.scheduled_for asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.scheduler_get_automation_execution(
  p_secret text,
  p_execution_id uuid
)
returns public.automation_executions
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
  from public.automation_executions e
  where public.automation_scheduler_authorized(p_secret)
    and e.id = p_execution_id;
$$;

create or replace function public.scheduler_claim_automation_execution(
  p_secret text,
  p_execution_id uuid
)
returns public.automation_executions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.automation_executions%rowtype;
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  update public.automation_executions e
  set status = 'running'::public.automation_execution_status,
      attempts = e.attempts + 1,
      started_at = now()
  where e.id = p_execution_id
    and e.status = 'pending'::public.automation_execution_status
    and e.attempts < e.max_attempts
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.scheduler_complete_automation_execution(
  p_secret text,
  p_execution_id uuid,
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
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  update public.automation_executions e
  set status = 'succeeded'::public.automation_execution_status,
      result = coalesce(p_result, '{}'::jsonb),
      error = null,
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status
  returning e.workflow_id into v_workflow_id;

  if found and v_workflow_id is not null then
    update public.automation_workflows w
    set last_run_at = now()
    where w.id = v_workflow_id;
  end if;
end;
$$;

create or replace function public.scheduler_fail_automation_execution(
  p_secret text,
  p_execution_id uuid,
  p_error text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  update public.automation_executions e
  set status = 'failed'::public.automation_execution_status,
      error = left(btrim(coalesce(p_error, 'Execution failed.')), 500),
      result = coalesce(p_result, e.result),
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status;
end;
$$;

create or replace function public.scheduler_skip_automation_execution(
  p_secret text,
  p_execution_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  update public.automation_executions e
  set status = 'skipped'::public.automation_execution_status,
      error = left(btrim(coalesce(p_reason, 'Execution skipped.')), 500),
      finished_at = now()
  where e.id = p_execution_id
    and e.status = 'running'::public.automation_execution_status;
end;
$$;

create or replace function public.scheduler_schedule_automation_retry(
  p_secret text,
  p_execution_id uuid,
  p_context jsonb,
  p_scheduled_for text,
  p_retry_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.automation_executions%rowtype;
  v_retry public.automation_executions%rowtype;
  v_created boolean := true;
  v_key text;
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  select e.* into v_execution
  from public.automation_executions e
  where e.id = p_execution_id
    and e.status = 'failed'::public.automation_execution_status;

  if not found then
    return jsonb_build_object('created', false);
  end if;

  if p_retry_number is null
    or p_retry_number < 1
    or p_retry_number >= v_execution.max_attempts then
    raise exception 'Retry number is out of bounds.';
  end if;

  v_key := left(v_execution.idempotency_key || ':retry:' || p_retry_number::text, 300);

  insert into public.automation_executions (
    workflow_id, owner_user_id, scope, workspace_id, trigger_type, event_type,
    idempotency_key, status, attempts, max_attempts, context, scheduled_for
  )
  values (
    v_execution.workflow_id, v_execution.owner_user_id, v_execution.scope,
    v_execution.workspace_id, v_execution.trigger_type, v_execution.event_type,
    v_key, 'pending'::public.automation_execution_status, 0, v_execution.max_attempts,
    coalesce(p_context, '{}'::jsonb), p_scheduled_for::timestamptz
  )
  on conflict (workflow_id, idempotency_key) do nothing
  returning * into v_retry;

  if not found then
    v_created := false;
    select e.* into v_retry
    from public.automation_executions e
    where e.workflow_id = v_execution.workflow_id
      and e.idempotency_key = v_key;
  end if;

  return jsonb_build_object('created', v_created, 'execution', to_jsonb(v_retry));
end;
$$;

create or replace function public.scheduler_record_automation_audit(
  p_secret text,
  p_workflow_id uuid,
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
  v_workflow public.automation_workflows%rowtype;
  v_result public.automation_audit_events%rowtype;
begin
  if not public.automation_scheduler_authorized(p_secret) then
    raise exception 'Unauthorized scheduler request.';
  end if;

  select w.* into v_workflow
  from public.automation_workflows w
  where w.id = p_workflow_id;

  if not found then
    raise exception 'Workflow was not found.';
  end if;

  insert into public.automation_audit_events (
    workflow_id, owner_user_id, scope, workspace_id, actor_user_id, action, outcome, details
  )
  values (
    v_workflow.id, v_workflow.owner_user_id, v_workflow.scope, v_workflow.workspace_id,
    v_workflow.owner_user_id, left(btrim(p_action), 120), p_outcome,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.record_automation_execution_failure(
  p_execution_id uuid,
  p_scope public.automation_scope,
  p_workspace_id uuid,
  p_error text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_execution public.automation_executions%rowtype;
  v_workflow public.automation_workflows%rowtype;
  v_allowed boolean := false;
begin
  if v_user_id is null then
    return;
  end if;

  select e.* into v_execution
  from public.automation_executions e
  where e.id = p_execution_id
    and e.scope = p_scope
    and e.workspace_id is not distinct from p_workspace_id;

  if not found then
    return;
  end if;

  select w.* into v_workflow
  from public.automation_workflows w
  where w.id = v_execution.workflow_id
    and w.scope = v_execution.scope
    and w.workspace_id is not distinct from v_execution.workspace_id
    and w.owner_user_id = v_execution.owner_user_id;

  if not found then
    return;
  end if;

  v_allowed := public.automation_access_allowed(
    v_execution.scope,
    v_execution.workspace_id,
    v_user_id,
    true
  ) and (
    v_execution.scope = 'workspace'::public.automation_scope
    or v_execution.owner_user_id = v_user_id
  );

  if not v_allowed then
    return;
  end if;

  update public.automation_executions e
  set status = 'failed'::public.automation_execution_status,
      error = left(btrim(coalesce(p_error, 'Execution failed.')), 500),
      result = coalesce(p_result, e.result),
      finished_at = now()
  where e.id = v_execution.id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = v_execution.scope
    and e.workspace_id is not distinct from v_execution.workspace_id;
end;
$$;

revoke all on function public.scheduler_list_due_automation_workflows(text, integer) from public;
grant execute on function public.scheduler_list_due_automation_workflows(text, integer) to anon, authenticated, service_role;

revoke all on function public.scheduler_get_automation_workflow(text, uuid) from public;
grant execute on function public.scheduler_get_automation_workflow(text, uuid) to anon, authenticated, service_role;

revoke all on function public.scheduler_claim_due_automation(text, uuid, jsonb, text) from public;
grant execute on function public.scheduler_claim_due_automation(text, uuid, jsonb, text) to anon, authenticated, service_role;

revoke all on function public.scheduler_list_due_automation_executions(text, integer) from public;
grant execute on function public.scheduler_list_due_automation_executions(text, integer) to anon, authenticated, service_role;

revoke all on function public.scheduler_get_automation_execution(text, uuid) from public;
grant execute on function public.scheduler_get_automation_execution(text, uuid) to anon, authenticated, service_role;

revoke all on function public.scheduler_claim_automation_execution(text, uuid) from public;
grant execute on function public.scheduler_claim_automation_execution(text, uuid) to anon, authenticated, service_role;

revoke all on function public.scheduler_complete_automation_execution(text, uuid, jsonb) from public;
grant execute on function public.scheduler_complete_automation_execution(text, uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.scheduler_fail_automation_execution(text, uuid, text, jsonb) from public;
grant execute on function public.scheduler_fail_automation_execution(text, uuid, text, jsonb) to anon, authenticated, service_role;

revoke all on function public.scheduler_skip_automation_execution(text, uuid, text) from public;
grant execute on function public.scheduler_skip_automation_execution(text, uuid, text) to anon, authenticated, service_role;

revoke all on function public.scheduler_schedule_automation_retry(text, uuid, jsonb, text, integer) from public;
grant execute on function public.scheduler_schedule_automation_retry(text, uuid, jsonb, text, integer) to anon, authenticated, service_role;

revoke all on function public.scheduler_record_automation_audit(text, uuid, text, public.automation_audit_outcome, jsonb) from public;
grant execute on function public.scheduler_record_automation_audit(text, uuid, text, public.automation_audit_outcome, jsonb) to anon, authenticated, service_role;

revoke all on function public.record_automation_execution_failure(uuid, public.automation_scope, uuid, text, jsonb) from public;
grant execute on function public.record_automation_execution_failure(uuid, public.automation_scope, uuid, text, jsonb) to authenticated, service_role;
