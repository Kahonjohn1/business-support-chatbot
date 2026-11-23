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
  set status = 'succeeded'::public.automation_execution_status,
      result = coalesce(p_result, '{}'::jsonb),
      error = null,
      finished_at = now()
  where e.id = v_execution.id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = v_execution.scope
    and e.workspace_id is not distinct from v_execution.workspace_id;

  if found then
    update public.automation_workflows w
    set last_run_at = now()
    where w.id = v_execution.workflow_id;
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
      finished_at = now()
  where e.id = v_execution.id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = v_execution.scope
    and e.workspace_id is not distinct from v_execution.workspace_id;
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
  set status = 'skipped'::public.automation_execution_status,
      error = left(btrim(coalesce(p_error, 'Execution skipped.')), 500),
      finished_at = now()
  where e.id = v_execution.id
    and e.status = 'running'::public.automation_execution_status
    and e.scope = v_execution.scope
    and e.workspace_id is not distinct from v_execution.workspace_id;
end;
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
  v_user_id uuid := auth.uid();
  v_workflow public.automation_workflows%rowtype;
  v_scope public.automation_scope;
  v_workspace_id uuid;
  v_owner_user_id uuid;
  v_allowed boolean := false;
  v_result public.automation_audit_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_workflow_id is not null then
    select w.* into v_workflow
    from public.automation_workflows w
    where w.id = p_workflow_id;

    if not found then
      raise exception 'Workflow was not found.';
    end if;

    if p_scope is distinct from v_workflow.scope
      or not (p_workspace_id is not distinct from v_workflow.workspace_id) then
      raise exception 'Unauthorized automation audit event.';
    end if;

    v_scope := v_workflow.scope;
    v_workspace_id := v_workflow.workspace_id;
    v_owner_user_id := v_workflow.owner_user_id;
    v_allowed := public.automation_access_allowed(
      v_scope,
      v_workspace_id,
      v_user_id,
      true
    ) and (
      v_scope = 'workspace'::public.automation_scope
      or v_owner_user_id = v_user_id
    );
  else
    if p_scope is null then
      raise exception 'Unauthorized automation audit event.';
    end if;

    v_scope := p_scope;
    v_workspace_id := p_workspace_id;
    v_owner_user_id := v_user_id;
    v_allowed := public.automation_access_allowed(
      v_scope,
      v_workspace_id,
      v_user_id,
      true
    );
  end if;

  if not v_allowed then
    raise exception 'Unauthorized automation audit event.';
  end if;

  insert into public.automation_audit_events (
    workflow_id, owner_user_id, scope, workspace_id, actor_user_id, action, outcome, details
  )
  values (
    p_workflow_id, v_owner_user_id, v_scope, v_workspace_id, v_user_id,
    left(btrim(p_action), 120), p_outcome, coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.complete_automation_execution(uuid, public.automation_scope, uuid, jsonb) from public;
grant execute on function public.complete_automation_execution(uuid, public.automation_scope, uuid, jsonb) to authenticated, service_role;

revoke all on function public.fail_automation_execution(uuid, public.automation_scope, uuid, text) from public;
grant execute on function public.fail_automation_execution(uuid, public.automation_scope, uuid, text) to authenticated, service_role;

revoke all on function public.skip_automation_execution(uuid, public.automation_scope, uuid, text) from public;
grant execute on function public.skip_automation_execution(uuid, public.automation_scope, uuid, text) to authenticated, service_role;

revoke all on function public.record_automation_audit_event(uuid, public.automation_scope, uuid, uuid, text, public.automation_audit_outcome, jsonb) from public;
grant execute on function public.record_automation_audit_event(uuid, public.automation_scope, uuid, uuid, text, public.automation_audit_outcome, jsonb) to authenticated, service_role;
