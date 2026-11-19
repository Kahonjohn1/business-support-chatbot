alter type public.company_role add value if not exists 'customer';

create or replace function public.is_marque_company(p_company_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_company_id = '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'::uuid;
$$;

create or replace function public.is_marque_employee(
  p_company_id uuid,
  p_user_id uuid,
  p_roles public.company_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_marque_company(p_company_id)
    and p_user_id is not null
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    and exists (
      select 1
      from public.company_memberships m
      where m.company_id = p_company_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and m.role::text in ('owner', 'admin', 'operator', 'viewer')
        and (p_roles is null or m.role = any(p_roles))
    );
$$;

create or replace function public.current_marque_employee(
  p_company_id uuid,
  p_roles public.company_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_marque_employee(p_company_id, auth.uid(), p_roles);
$$;

create or replace function public.is_support_customer(p_company_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_marque_company(p_company_id)
    and p_user_id is not null
    and exists (
      select 1
      from public.company_memberships m
      where m.company_id = p_company_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and m.role::text = 'customer'
    );
$$;

create or replace function public.set_marque_employee_status(
  p_user_id uuid,
  p_is_employee boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_is_employee is null then
    raise exception 'invalid employee status arguments';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'authenticated user not found';
  end if;

  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('is_employee', p_is_employee)
  where u.id = p_user_id;

  return true;
end;
$$;

create or replace function public.protect_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by then
      if new.created_by is null
        and old.created_by is not null
        and current_user::text not in ('anon', 'authenticated')
        and auth.uid() is null
      then
        return new;
      end if;

      raise exception 'created_by cannot be changed after creation';
    end if;

    return new;
  end if;

  if new.created_by is not null then
    if auth.uid() is null or new.created_by <> auth.uid() then
      raise exception 'created_by must be the authenticated user';
    end if;

    if tg_table_name <> 'companies'
      and not public.current_marque_employee(new.company_id)
    then
      raise exception 'created_by must be an authorised Marque employee';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_company_user_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text;
  v_user_id uuid;
begin
  foreach v_column in array tg_argv loop
    v_user_id := nullif(to_jsonb(new) ->> v_column, '')::uuid;

    if v_user_id is not null
      and not public.is_marque_employee(new.company_id, v_user_id)
    then
      raise exception '% must reference an active Marque employee of the same company', v_column;
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.validate_conversation_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_marque_employee(new.company_id, new.user_id) then
    raise exception 'conversation owner must be an authorised Marque employee';
  end if;

  return new;
end;
$$;

create or replace function public.transfer_company_owner(p_company_id uuid, p_new_owner_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_locked_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.is_marque_company(p_company_id) then
    raise exception 'only the Marque company can be managed';
  end if;

  select c.id into v_locked_company_id
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'company not found';
  end if;

  if not public.is_marque_employee(p_company_id, v_user_id, array['owner']::public.company_role[]) then
    raise exception 'only an active Marque owner can transfer company ownership';
  end if;

  if not public.is_marque_employee(p_company_id, p_new_owner_user_id) then
    raise exception 'new owner must be an active Marque employee';
  end if;

  if p_new_owner_user_id = v_user_id then
    return true;
  end if;

  update public.company_memberships as m
  set role = 'owner',
      status = 'active',
      joined_at = coalesce(m.joined_at, now())
  where m.company_id = p_company_id
    and m.user_id = p_new_owner_user_id;

  update public.company_memberships as m
  set role = 'admin'
  where m.company_id = p_company_id
    and m.user_id = v_user_id
    and m.role = 'owner'
    and m.status = 'active';

  return true;
end;
$$;

create or replace function public.decide_approval(p_approval_id uuid, p_decision public.approval_status)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_decision is null
    or p_decision not in ('approved'::public.approval_status, 'rejected'::public.approval_status)
  then
    raise exception 'decision must be approved or rejected';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.is_marque_employee(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval decision requires an authorised Marque owner or admin';
  end if;

  if v_approval.status <> 'pending' then
    return v_approval;
  end if;

  if now() >= v_approval.expires_at then
    raise exception 'approval request has expired';
  end if;

  update public.approvals a
  set status = p_decision,
      decision_by = v_user_id::text,
      decision_by_user_id = v_user_id,
      decision_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create or replace function public.begin_approval_execution(p_approval_id uuid)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.is_marque_employee(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval execution requires an authorised Marque owner or admin';
  end if;

  if v_approval.status in ('executing', 'executed', 'failed') then
    return v_approval;
  end if;

  if v_approval.status <> 'approved' then
    raise exception 'approval request is not approved';
  end if;

  update public.approvals a
  set status = 'executing',
      execution_started_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create or replace function public.complete_approval_execution(
  p_approval_id uuid,
  p_execution_result jsonb,
  p_failure_reason text default null
)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_failure_reason is not null and char_length(p_failure_reason) > 500 then
    raise exception 'failure reason must be at most 500 characters';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.is_marque_employee(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval execution requires an authorised Marque owner or admin';
  end if;

  if v_approval.status in ('executed', 'failed') then
    return v_approval;
  end if;

  if v_approval.status = 'approved' then
    update public.approvals a
    set status = 'executing',
        execution_started_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  end if;

  if v_approval.status <> 'executing' then
    return v_approval;
  end if;

  if p_failure_reason is null then
    update public.approvals a
    set status = 'executed',
        execution_result = coalesce(p_execution_result, '{}'::jsonb),
        execution_completed_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  else
    update public.approvals a
    set status = 'failed',
        execution_result = coalesce(p_execution_result, '{}'::jsonb),
        failure_reason = p_failure_reason,
        execution_completed_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  end if;

  return v_approval;
end;
$$;

create or replace function public.expire_approval(p_approval_id uuid)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.is_marque_employee(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval expiration requires an authorised Marque owner or admin';
  end if;

  if v_approval.status <> 'pending' then
    return v_approval;
  end if;

  if now() < v_approval.expires_at then
    raise exception 'approval request has not expired';
  end if;

  update public.approvals a
  set status = 'expired',
      decision_by = 'system',
      decision_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create or replace function public.record_audit_event(
  p_company_id uuid,
  p_action text,
  p_outcome public.audit_outcome,
  p_request_id text default null,
  p_tool_name text default null,
  p_operation text default null,
  p_permission_allowed boolean default null,
  p_required_permission text default null,
  p_approval_id uuid default null,
  p_error_code text default null,
  p_duration_ms integer default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_audit_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.is_marque_employee(
    p_company_id,
    v_user_id,
    array['owner', 'admin', 'operator']::public.company_role[]
  ) then
    raise exception 'audit event creation requires an authorised Marque owner, admin, or operator';
  end if;

  if p_action is null or p_outcome is null then
    raise exception 'audit action and outcome are required';
  end if;

  if not (
    (p_action = 'permission_check' and p_outcome in ('permitted', 'denied'))
    or (p_action = 'tool_dispatch' and p_outcome = 'denied')
    or (p_action = 'tool_execution' and p_outcome in ('executed', 'failed'))
  ) then
    raise exception 'unsupported audit action and outcome combination';
  end if;

  if p_action = 'permission_check' and p_permission_allowed is null then
    raise exception 'permission audit events require a permission decision';
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'audit duration cannot be negative';
  end if;

  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'audit details must be a json object';
  end if;

  insert into public.audit_events (
    company_id,
    user_id,
    request_id,
    tool_name,
    operation,
    action,
    outcome,
    permission_allowed,
    required_permission,
    approval_id,
    error_code,
    duration_ms,
    details
  )
  values (
    p_company_id,
    v_user_id,
    public.sanitize_audit_text(p_request_id),
    public.sanitize_audit_text(p_tool_name),
    public.sanitize_audit_text(p_operation),
    p_action,
    p_outcome,
    p_permission_allowed,
    p_required_permission,
    p_approval_id,
    public.sanitize_audit_text(p_error_code),
    p_duration_ms,
    v_details
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

create or replace function public.invite_company_member(
  p_company_id uuid,
  p_email text,
  p_role public.company_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_marque_employee(
    p_company_id,
    auth.uid(),
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'only an active Marque owner or admin can invite employees';
  end if;

  if p_role not in ('admin'::public.company_role, 'operator'::public.company_role, 'viewer'::public.company_role) then
    raise exception 'invited role must be admin, operator or viewer';
  end if;

  if p_email is null or char_length(btrim(p_email)) not between 3 and 320 then
    raise exception 'invite email must be between 3 and 320 characters';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email));

  if not found then
    raise exception 'no account exists for that email address';
  end if;

  insert into public.company_memberships as m (
    company_id,
    user_id,
    role,
    status,
    invited_by,
    invited_at
  )
  values (
    p_company_id,
    v_user_id,
    p_role,
    'invited',
    auth.uid(),
    now()
  )
  on conflict (company_id, user_id) do update
  set role = excluded.role,
      status = 'invited',
      invited_by = excluded.invited_by,
      invited_at = now()
  where m.status <> 'active'
  returning m.id into v_membership_id;

  if v_membership_id is null then
    raise exception 'that user is already an active company member';
  end if;

  return v_membership_id;
end;
$$;

create or replace function public.list_my_company_invitations()
returns table (
  company_id uuid,
  company_name text,
  company_slug text,
  role public.company_role,
  invited_at timestamptz,
  invited_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.slug,
    m.role,
    m.invited_at,
    p.display_name
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  left join public.profiles p on p.id = m.invited_by
  where m.user_id = auth.uid()
    and m.status = 'invited'
    and public.is_marque_company(m.company_id)
    and m.role::text in ('admin', 'operator', 'viewer')
  order by m.invited_at desc;
$$;

create or replace function public.accept_company_invitation(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.company_memberships m
  set status = 'active',
      joined_at = coalesce(m.joined_at, now())
  where m.company_id = p_company_id
    and public.is_marque_company(m.company_id)
    and m.user_id = auth.uid()
    and m.status = 'invited'
    and m.role::text in ('admin', 'operator', 'viewer');

  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

drop policy if exists companies_select on public.companies;

create policy companies_select on public.companies
for select to authenticated
using (
  public.is_marque_company(id)
  and public.current_marque_employee(id)
);

drop policy if exists companies_update on public.companies;

create policy companies_update on public.companies
for update to authenticated
using (
  public.is_marque_company(id)
  and public.current_marque_employee(id, array['owner']::public.company_role[])
)
with check (
  public.is_marque_company(id)
  and public.current_marque_employee(id, array['owner']::public.company_role[])
);

drop policy if exists company_memberships_select on public.company_memberships;

create policy company_memberships_select on public.company_memberships
for select to authenticated
using (
  public.is_marque_company(company_id)
  and (
    user_id = auth.uid()
    or public.current_marque_employee(company_id)
  )
);

drop policy if exists company_memberships_insert on public.company_memberships;

create policy company_memberships_insert on public.company_memberships
for insert to authenticated
with check (
  public.is_marque_company(company_id)
  and public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
  and role::text not in ('owner', 'customer')
  and not (user_id = auth.uid() and role = 'admin')
  and (invited_by is null or invited_by = auth.uid())
);

drop policy if exists company_memberships_update on public.company_memberships;

create policy company_memberships_update on public.company_memberships
for update to authenticated
using (
  public.is_marque_company(company_id)
  and public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
)
with check (
  public.is_marque_company(company_id)
  and public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
);

drop policy if exists company_memberships_delete on public.company_memberships;

create policy company_memberships_delete on public.company_memberships
for delete to authenticated
using (
  public.is_marque_company(company_id)
  and public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
);

drop policy if exists projects_select on public.projects;

create policy projects_select on public.projects
for select to authenticated
using (public.current_marque_employee(company_id));

drop policy if exists projects_insert on public.projects;

create policy projects_insert on public.projects
for insert to authenticated
with check (
  public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
);

drop policy if exists projects_update on public.projects;

create policy projects_update on public.projects
for update to authenticated
using (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
)
with check (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
);

drop policy if exists projects_delete on public.projects;

create policy projects_delete on public.projects
for delete to authenticated
using (
  public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
);

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks
for select to authenticated
using (public.current_marque_employee(company_id));

drop policy if exists tasks_insert on public.tasks;

create policy tasks_insert on public.tasks
for insert to authenticated
with check (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
);

drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks
for update to authenticated
using (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
)
with check (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
);

drop policy if exists tasks_delete on public.tasks;

create policy tasks_delete on public.tasks
for delete to authenticated
using (
  public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
);

drop policy if exists conversations_select on public.conversations;

create policy conversations_select on public.conversations
for select to authenticated
using (
  public.is_marque_company(company_id)
  and (
    public.current_marque_employee(company_id, array['owner', 'admin']::public.company_role[])
    or (
      user_id = auth.uid()
      and public.current_marque_employee(company_id)
    )
  )
);

drop policy if exists conversations_insert on public.conversations;

create policy conversations_insert on public.conversations
for insert to authenticated
with check (
  public.is_marque_company(company_id)
  and user_id = auth.uid()
  and public.current_marque_employee(company_id)
);

drop policy if exists conversations_update on public.conversations;

create policy conversations_update on public.conversations
for update to authenticated
using (
  public.is_marque_company(company_id)
  and user_id = auth.uid()
  and public.current_marque_employee(company_id)
)
with check (
  public.is_marque_company(company_id)
  and user_id = auth.uid()
  and public.current_marque_employee(company_id)
);

drop policy if exists conversations_delete on public.conversations;

create policy conversations_delete on public.conversations
for delete to authenticated
using (
  public.is_marque_company(company_id)
  and user_id = auth.uid()
  and public.current_marque_employee(company_id)
);

drop policy if exists messages_select on public.messages;

create policy messages_select on public.messages
for select to authenticated
using (
  public.is_marque_company(company_id)
  and exists (
    select 1
    from public.conversations c
    where c.company_id = messages.company_id
      and c.id = messages.conversation_id
      and (
        public.current_marque_employee(c.company_id, array['owner', 'admin']::public.company_role[])
        or (
          c.user_id = auth.uid()
          and public.current_marque_employee(c.company_id)
        )
      )
  )
);

drop policy if exists messages_insert on public.messages;

create policy messages_insert on public.messages
for insert to authenticated
with check (
  public.is_marque_company(company_id)
  and (sender_id is null or sender_id = auth.uid())
  and exists (
    select 1
    from public.conversations c
    where c.company_id = messages.company_id
      and c.id = messages.conversation_id
      and (
        public.current_marque_employee(c.company_id, array['owner', 'admin']::public.company_role[])
        or (
          c.user_id = auth.uid()
          and public.current_marque_employee(c.company_id)
        )
      )
  )
);

drop policy if exists approvals_select on public.approvals;

create policy approvals_select on public.approvals
for select to authenticated
using (public.current_marque_employee(company_id));

drop policy if exists approvals_insert on public.approvals;

create policy approvals_insert on public.approvals
for insert to authenticated
with check (
  requested_by = auth.uid()
  and public.current_marque_employee(company_id, array['owner', 'admin', 'operator']::public.company_role[])
  and status = 'pending'
  and decision_by is null
  and decision_by_user_id is null
  and decision_at is null
  and execution_started_at is null
  and execution_completed_at is null
  and execution_result is null
  and failure_reason is null
);

drop policy if exists audit_events_select on public.audit_events;

create policy audit_events_select on public.audit_events
for select to authenticated
using (public.current_marque_employee(company_id));

revoke all on function public.is_marque_company(uuid) from public, anon, authenticated;
revoke all on function public.is_marque_employee(uuid, uuid, public.company_role[]) from public, anon, authenticated;
revoke all on function public.current_marque_employee(uuid, public.company_role[]) from public, anon, authenticated;
revoke all on function public.is_support_customer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_marque_employee_status(uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_company_with_owner(text, text) from public, anon, authenticated;

grant execute on function public.is_marque_company(uuid) to authenticated;
grant execute on function public.is_marque_employee(uuid, uuid, public.company_role[]) to authenticated;
grant execute on function public.current_marque_employee(uuid, public.company_role[]) to authenticated;
grant execute on function public.set_marque_employee_status(uuid, boolean) to service_role;
