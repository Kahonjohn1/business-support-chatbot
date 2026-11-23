create table if not exists public.legacy_company_projects_20261119 (
  id uuid primary key,
  company_id uuid,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.legacy_company_tasks_20261119 (
  id uuid primary key,
  company_id uuid,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.legacy_company_approvals_20261119 (
  id uuid primary key,
  company_id uuid,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.legacy_company_audit_events_20261119 (
  id uuid primary key,
  company_id uuid,
  user_id uuid,
  approval_id uuid not null,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

alter table public.approvals
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create or replace function public.approval_resources_owned_by(
  p_user_id uuid,
  p_conversation_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and (
      p_conversation_id is null
      or exists (
        select 1
        from public.conversations c
        where c.id = p_conversation_id
          and c.user_id = p_user_id
          and c.company_id is null
      )
    )
    and (
      p_task_id is null
      or exists (
        select 1
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = p_task_id
          and t.user_id = p_user_id
          and p.company_id is null
          and p.user_id = p_user_id
      )
    );
$$;

insert into public.legacy_company_audit_events_20261119 (id, company_id, user_id, approval_id, payload)
select ae.id, ae.company_id, ae.user_id, ae.approval_id, to_jsonb(ae)
from public.audit_events ae
where ae.approval_id is not null
  and exists (
    select 1
    from public.approvals a
    where a.id = ae.approval_id
      and a.company_id = ae.company_id
      and (
        a.company_id is not null
        or a.user_id is null
        or (a.requested_by is not null and a.requested_by <> a.user_id)
        or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id)
      )
  );

do $$
declare
  v_missing bigint;
begin
  select count(*)
  into v_missing
  from public.audit_events ae
  left join public.legacy_company_audit_events_20261119 l
    on l.id = ae.id
   and l.approval_id is not distinct from ae.approval_id
   and l.payload = to_jsonb(ae)
  where ae.approval_id is not null
    and exists (
      select 1
      from public.approvals a
      where a.id = ae.approval_id
        and a.company_id = ae.company_id
        and (
          a.company_id is not null
          or a.user_id is null
          or (a.requested_by is not null and a.requested_by <> a.user_id)
          or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id)
        )
    )
    and l.id is null;

  if v_missing > 0 then
    raise exception 'audit event approval archive verification failed for % row(s)', v_missing;
  end if;
end $$;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
drop policy if exists approvals_select on public.approvals;
drop policy if exists approvals_insert on public.approvals;

drop trigger if exists projects_protect_created_by on public.projects;
drop trigger if exists projects_prevent_scope_change on public.projects;
drop trigger if exists projects_protect_personal_ownership on public.projects;
drop trigger if exists tasks_protect_created_by on public.tasks;
drop trigger if exists tasks_prevent_scope_change on public.tasks;
drop trigger if exists tasks_protect_personal_ownership on public.tasks;
drop trigger if exists tasks_validate_assignee on public.tasks;
drop trigger if exists approvals_prevent_scope_change on public.approvals;
drop trigger if exists approvals_protect_identity on public.approvals;
drop trigger if exists approvals_validate_decision_user on public.approvals;
drop trigger if exists approvals_audit_events on public.approvals;

insert into public.legacy_company_approvals_20261119 (id, company_id, payload)
select a.id, a.company_id, to_jsonb(a)
from public.approvals a
where a.company_id is not null
   or a.user_id is null
   or (a.requested_by is not null and a.requested_by <> a.user_id)
   or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id);

insert into public.legacy_company_tasks_20261119 (id, company_id, payload)
select t.id, t.company_id, to_jsonb(t)
from public.tasks t
where t.company_id is not null
   or t.user_id is null
   or (t.created_by is not null and t.created_by <> t.user_id)
   or (t.assignee_id is not null and t.assignee_id <> t.user_id)
   or not exists (
     select 1
     from public.projects p
     where p.id = t.project_id
       and p.company_id is null
       and p.user_id = t.user_id
   );

insert into public.legacy_company_projects_20261119 (id, company_id, payload)
select p.id, p.company_id, to_jsonb(p)
from public.projects p
where p.company_id is not null
   or p.user_id is null
   or (p.created_by is not null and p.created_by <> p.user_id);

do $$
declare
  v_missing bigint;
begin
  select count(*)
  into v_missing
  from public.approvals a
  left join public.legacy_company_approvals_20261119 l
    on l.id = a.id
   and l.payload = to_jsonb(a)
  where (
    a.company_id is not null
    or a.user_id is null
    or (a.requested_by is not null and a.requested_by <> a.user_id)
    or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id)
  )
  and l.id is null;

  if v_missing > 0 then
    raise exception 'approval archive verification failed for % row(s)', v_missing;
  end if;
end $$;

do $$
declare
  v_missing bigint;
begin
  select count(*)
  into v_missing
  from public.tasks t
  left join public.legacy_company_tasks_20261119 l
    on l.id = t.id
   and l.payload = to_jsonb(t)
  where (
    t.company_id is not null
    or t.user_id is null
    or (t.created_by is not null and t.created_by <> t.user_id)
    or (t.assignee_id is not null and t.assignee_id <> t.user_id)
    or not exists (
      select 1
      from public.projects p
      where p.id = t.project_id
        and p.company_id is null
        and p.user_id = t.user_id
    )
  )
  and l.id is null;

  if v_missing > 0 then
    raise exception 'task archive verification failed for % row(s)', v_missing;
  end if;
end $$;

do $$
declare
  v_missing bigint;
begin
  select count(*)
  into v_missing
  from public.projects p
  left join public.legacy_company_projects_20261119 l
    on l.id = p.id
   and l.payload = to_jsonb(p)
  where (
    p.company_id is not null
    or p.user_id is null
    or (p.created_by is not null and p.created_by <> p.user_id)
  )
  and l.id is null;

  if v_missing > 0 then
    raise exception 'project archive verification failed for % row(s)', v_missing;
  end if;
end $$;

delete from public.approvals a
where a.company_id is not null
   or a.user_id is null
   or (a.requested_by is not null and a.requested_by <> a.user_id)
   or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id);

delete from public.tasks t
where t.company_id is not null
   or t.user_id is null
   or (t.created_by is not null and t.created_by <> t.user_id)
   or (t.assignee_id is not null and t.assignee_id <> t.user_id)
   or not exists (
     select 1
     from public.projects p
     where p.id = t.project_id
       and p.company_id is null
       and p.user_id = t.user_id
   );

delete from public.projects p
where p.company_id is not null
   or p.user_id is null
   or (p.created_by is not null and p.created_by <> p.user_id);

do $$
begin
  if exists (
    select 1
    from public.approvals a
    where a.company_id is not null
       or a.user_id is null
       or (a.requested_by is not null and a.requested_by <> a.user_id)
       or not public.approval_resources_owned_by(a.user_id, a.conversation_id, a.task_id)
  ) then
    raise exception 'invalid approval rows remain after archive';
  end if;

  if exists (
    select 1
    from public.tasks t
    where t.company_id is not null
       or t.user_id is null
       or (t.created_by is not null and t.created_by <> t.user_id)
       or (t.assignee_id is not null and t.assignee_id <> t.user_id)
       or not exists (
         select 1
         from public.projects p
         where p.id = t.project_id
           and p.company_id is null
           and p.user_id = t.user_id
       )
  ) then
    raise exception 'invalid task rows remain after archive';
  end if;

  if exists (
    select 1
    from public.projects p
    where p.company_id is not null
       or p.user_id is null
       or (p.created_by is not null and p.created_by <> p.user_id)
  ) then
    raise exception 'invalid project rows remain after archive';
  end if;
end $$;

alter table public.audit_events
  drop constraint if exists audit_events_approval_fk;

alter table public.approvals
  drop constraint if exists approvals_conversation_fk;

alter table public.approvals
  drop constraint if exists approvals_task_fk;

alter table public.tasks
  drop constraint if exists tasks_personal_project_fk;

alter table public.tasks
  drop constraint if exists tasks_company_project_fk;

alter table public.projects
  drop constraint if exists projects_company_code_unique;

alter table public.projects
  drop constraint if exists projects_company_id_unique;

alter table public.projects
  drop constraint if exists projects_personal_scope_check;

alter table public.tasks
  drop constraint if exists tasks_company_code_unique;

alter table public.tasks
  drop constraint if exists tasks_company_id_unique;

alter table public.tasks
  drop constraint if exists tasks_personal_scope_check;

alter table public.approvals
  drop constraint if exists approvals_company_id_unique;

drop index if exists public.projects_company_status_idx;
drop index if exists public.tasks_company_project_idx;
drop index if exists public.tasks_company_status_idx;
drop index if exists public.approvals_company_status_idx;
drop index if exists public.approvals_company_request_idx;
drop index if exists public.approvals_company_expiry_idx;

alter table public.projects
  drop column if exists company_id;

alter table public.tasks
  drop column if exists company_id;

alter table public.approvals
  drop column if exists company_id;

create or replace function public.approval_resources_owned_by(
  p_user_id uuid,
  p_conversation_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and (
      p_conversation_id is null
      or exists (
        select 1
        from public.conversations c
        where c.id = p_conversation_id
          and c.user_id = p_user_id
          and c.company_id is null
      )
    )
    and (
      p_task_id is null
      or exists (
        select 1
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = p_task_id
          and t.user_id = p_user_id
          and p.user_id = p_user_id
      )
    );
$$;

alter table public.projects
  alter column user_id set not null;

alter table public.tasks
  alter column user_id set not null;

alter table public.approvals
  alter column user_id set not null;

alter table public.tasks
  drop constraint if exists tasks_owner_project_fk;

alter table public.tasks
  add constraint tasks_owner_project_fk
  foreign key (user_id, project_id)
  references public.projects (user_id, id)
  on delete cascade;

alter table public.approvals
  add constraint approvals_conversation_fk
  foreign key (conversation_id)
  references public.conversations (id)
  on delete set null;

alter table public.approvals
  add constraint approvals_task_fk
  foreign key (task_id)
  references public.tasks (id)
  on delete set null;

alter table public.audit_events
  add constraint audit_events_approval_fk
  foreign key (approval_id)
  references public.approvals (id)
  on delete set null;

alter table public.projects
  drop constraint if exists projects_creator_owner_check;

alter table public.projects
  add constraint projects_creator_owner_check
  check (created_by is null or created_by = user_id);

alter table public.tasks
  drop constraint if exists tasks_creator_owner_check;

alter table public.tasks
  add constraint tasks_creator_owner_check
  check (created_by is null or created_by = user_id);

alter table public.tasks
  drop constraint if exists tasks_assignee_owner_check;

alter table public.tasks
  add constraint tasks_assignee_owner_check
  check (assignee_id is null or assignee_id = user_id);

alter table public.approvals
  drop constraint if exists approvals_requester_owner_check;

alter table public.approvals
  add constraint approvals_requester_owner_check
  check (requested_by is null or requested_by = user_id);

drop index if exists public.approvals_user_status_idx;
drop index if exists public.approvals_user_request_idx;
drop index if exists public.approvals_user_pending_expiry_idx;

create index approvals_user_status_idx on public.approvals (user_id, status);
create index approvals_user_request_idx on public.approvals (user_id, request_id);
create index approvals_user_pending_expiry_idx
  on public.approvals (user_id, expires_at) where status = 'pending';

create or replace function public.protect_personal_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'personal record ownership cannot be changed';
    end if;

    return new;
  end if;

  if current_user::text not in ('anon', 'authenticated') and auth.uid() is null then
    return new;
  end if;

  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'personal record owner must be the authenticated user';
  end if;

  return new;
end;
$$;

create or replace function public.protect_personal_created_by()
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

  if new.created_by is not null
    and (auth.uid() is null or new.created_by <> auth.uid())
  then
    raise exception 'created_by must be the authenticated user';
  end if;

  return new;
end;
$$;

create or replace function public.protect_personal_requester()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.requested_by is distinct from old.requested_by then
      if new.requested_by is null
        and old.requested_by is not null
        and current_user::text not in ('anon', 'authenticated')
        and auth.uid() is null
      then
        return new;
      end if;

      raise exception 'approval requester cannot be changed';
    end if;

    return new;
  end if;

  if new.requested_by is not null
    and (auth.uid() is null or new.requested_by <> auth.uid())
  then
    raise exception 'approval requester must be the authenticated user';
  end if;

  return new;
end;
$$;

create or replace function public.protect_approval_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approval_ref is distinct from old.approval_ref
    or new.request_id is distinct from old.request_id
    or new.tool_name is distinct from old.tool_name
    or new.raw_arguments is distinct from old.raw_arguments
    or new.summary is distinct from old.summary
    or new.details is distinct from old.details
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.requested_by is distinct from old.requested_by
    and not (
      new.requested_by is null
      and old.requested_by is not null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.conversation_id is distinct from old.conversation_id
    and not (
      new.conversation_id is null
      and old.conversation_id is not null
      and new.task_id is not distinct from old.task_id
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.task_id is distinct from old.task_id
    and not (
      new.task_id is null
      and old.task_id is not null
      and new.conversation_id is not distinct from old.conversation_id
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if old.decision_by is not null and new.decision_by is distinct from old.decision_by then
    raise exception 'approval decision text cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.protect_approval_resources()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.approval_resources_owned_by(
    new.user_id,
    new.conversation_id,
    new.task_id
  ) then
    raise exception 'approval resources must belong to the authenticated owner';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_protect_personal_ownership on public.projects;
drop trigger if exists projects_protect_created_by on public.projects;
drop trigger if exists tasks_protect_personal_ownership on public.tasks;
drop trigger if exists tasks_protect_created_by on public.tasks;
drop trigger if exists approvals_protect_personal_ownership on public.approvals;
drop trigger if exists approvals_protect_requester on public.approvals;
drop trigger if exists approvals_protect_identity on public.approvals;
drop trigger if exists approvals_protect_resources on public.approvals;

create trigger projects_protect_personal_ownership
before insert or update of user_id on public.projects
for each row execute function public.protect_personal_ownership();

create trigger projects_protect_created_by
before insert or update of created_by on public.projects
for each row execute function public.protect_personal_created_by();

create trigger tasks_protect_personal_ownership
before insert or update of user_id on public.tasks
for each row execute function public.protect_personal_ownership();

create trigger tasks_protect_created_by
before insert or update of created_by on public.tasks
for each row execute function public.protect_personal_created_by();

create trigger approvals_protect_personal_ownership
before insert or update of user_id on public.approvals
for each row execute function public.protect_personal_ownership();

create trigger approvals_protect_requester
before insert or update of requested_by on public.approvals
for each row execute function public.protect_personal_requester();

create trigger approvals_protect_identity
before update on public.approvals
for each row execute function public.protect_approval_identity();

create trigger approvals_protect_resources
before insert or update of user_id, conversation_id, task_id on public.approvals
for each row execute function public.protect_approval_resources();

drop function if exists public.record_approval_audit_event();

create policy projects_select on public.projects
for select to authenticated
using (user_id = auth.uid());

create policy projects_insert on public.projects
for insert to authenticated
with check (user_id = auth.uid());

create policy projects_update on public.projects
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy projects_delete on public.projects
for delete to authenticated
using (user_id = auth.uid());

create policy tasks_select on public.tasks
for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = tasks.project_id
      and p.user_id = auth.uid()
  )
);

create policy tasks_insert on public.tasks
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = tasks.project_id
      and p.user_id = auth.uid()
  )
);

create policy tasks_update on public.tasks
for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = tasks.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = tasks.project_id
      and p.user_id = auth.uid()
  )
);

create policy tasks_delete on public.tasks
for delete to authenticated
using (user_id = auth.uid());

create policy approvals_select on public.approvals
for select to authenticated
using (
  user_id = auth.uid()
  and public.approval_resources_owned_by(auth.uid(), conversation_id, task_id)
);

create policy approvals_insert on public.approvals
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.approval_resources_owned_by(auth.uid(), conversation_id, task_id)
  and (requested_by is null or requested_by = auth.uid())
  and status = 'pending'
  and decision_by is null
  and decision_by_user_id is null
  and decision_at is null
  and execution_started_at is null
  and execution_completed_at is null
  and execution_result is null
  and failure_reason is null
);

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision public.approval_status
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

  if v_approval.user_id <> v_user_id
    or not public.approval_resources_owned_by(
      v_user_id,
      v_approval.conversation_id,
      v_approval.task_id
    )
  then
    raise exception 'approval request not found';
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

  if v_approval.user_id <> v_user_id
    or not public.approval_resources_owned_by(
      v_user_id,
      v_approval.conversation_id,
      v_approval.task_id
    )
  then
    raise exception 'approval request not found';
  end if;

  if v_approval.status in ('executing', 'executed', 'failed') then
    return v_approval;
  end if;

  if now() >= v_approval.expires_at then
    raise exception 'approval request has expired';
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

  if v_approval.user_id <> v_user_id
    or not public.approval_resources_owned_by(
      v_user_id,
      v_approval.conversation_id,
      v_approval.task_id
    )
  then
    raise exception 'approval request not found';
  end if;

  if v_approval.status in ('executed', 'failed') then
    return v_approval;
  end if;

  if now() >= v_approval.expires_at then
    raise exception 'approval request has expired';
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

  if v_approval.user_id <> v_user_id
    or not public.approval_resources_owned_by(
      v_user_id,
      v_approval.conversation_id,
      v_approval.task_id
    )
  then
    raise exception 'approval request not found';
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

revoke all on function public.protect_personal_ownership() from public, anon, authenticated;
revoke all on function public.protect_personal_created_by() from public, anon, authenticated;
revoke all on function public.protect_personal_requester() from public, anon, authenticated;
revoke all on function public.protect_approval_resources() from public, anon, authenticated;
revoke all on function public.approval_resources_owned_by(uuid, uuid, uuid) from public, anon;
grant execute on function public.approval_resources_owned_by(uuid, uuid, uuid) to authenticated, service_role;
revoke all on table public.legacy_company_projects_20261119 from public, anon, authenticated;
revoke all on table public.legacy_company_tasks_20261119 from public, anon, authenticated;
revoke all on table public.legacy_company_approvals_20261119 from public, anon, authenticated;
revoke all on table public.legacy_company_audit_events_20261119 from public, anon, authenticated;
