alter table public.tasks add column if not exists due_date timestamptz;

create index if not exists tasks_assignee_idx
  on public.tasks (assignee_id)
  where assignee_id is not null;

create or replace function public.task_project_owner_matches(
  p_project_id uuid,
  p_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.user_id = p_owner_user_id
  );
$$;

create or replace function public.can_read_delegated_task(p_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_user_id is not null
    and public.current_employee_role() is not null
    and exists (
      select 1
      from public.company_memberships assignee_membership
      join public.company_memberships owner_membership
        on owner_membership.company_id = assignee_membership.company_id
       and owner_membership.user_id = p_owner_user_id
       and owner_membership.status = 'active'
      where assignee_membership.user_id = auth.uid()
        and assignee_membership.status = 'active'
    );
$$;

create or replace function public.can_assign_task_to(p_assignee_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_assignee_user_id is not null
    and exists (
      select 1
      from public.employee_profiles employee_profile
      where employee_profile.id = p_assignee_user_id
        and employee_profile.status = 'active'
    )
    and public.current_employee_role() in (
      'manager'::public.employee_role,
      'admin'::public.employee_role
    )
    and exists (
      select 1
      from public.company_memberships manager_membership
      join public.company_memberships assignee_membership
        on assignee_membership.company_id = manager_membership.company_id
       and assignee_membership.user_id = p_assignee_user_id
       and assignee_membership.status = 'active'
      where manager_membership.user_id = auth.uid()
        and manager_membership.status = 'active'
        and manager_membership.role = any (
          array['owner'::public.company_role, 'admin'::public.company_role]
        )
    );
$$;

create or replace function public.can_manage_company_task_owner(p_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_user_id is not null
    and public.current_employee_role() in (
      'manager'::public.employee_role,
      'admin'::public.employee_role
    )
    and exists (
      select 1
      from public.company_memberships manager_membership
      join public.company_memberships owner_membership
        on owner_membership.company_id = manager_membership.company_id
       and owner_membership.user_id = p_owner_user_id
       and owner_membership.status = 'active'
      join public.employee_profiles owner_profile
        on owner_profile.id = p_owner_user_id
       and owner_profile.status = 'active'
      where manager_membership.user_id = auth.uid()
        and manager_membership.status = 'active'
        and manager_membership.role = any (
          array['owner'::public.company_role, 'admin'::public.company_role]
        )
    );
$$;

create or replace function public.validate_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and new.assignee_id <> new.user_id
     and not public.can_assign_task_to(new.assignee_id)
  then
    raise exception 'assignee must be the task owner or an active employee in the same company';
  end if;

  return new;
end;
$$;

revoke all on function public.task_project_owner_matches(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_delegated_task(uuid) from public, anon, authenticated;
revoke all on function public.can_assign_task_to(uuid) from public, anon, authenticated;
revoke all on function public.can_manage_company_task_owner(uuid) from public, anon, authenticated;
revoke all on function public.validate_task_assignment() from public, anon, authenticated;

grant execute on function public.task_project_owner_matches(uuid, uuid) to authenticated;
grant execute on function public.can_read_delegated_task(uuid) to authenticated;
grant execute on function public.can_assign_task_to(uuid) to authenticated;
grant execute on function public.can_manage_company_task_owner(uuid) to authenticated;

alter table public.tasks drop constraint if exists tasks_assignee_owner_check;

drop trigger if exists tasks_validate_assignment on public.tasks;

create trigger tasks_validate_assignment
  before insert or update of assignee_id on public.tasks
  for each row execute function public.validate_task_assignment();

drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert"
  on public.tasks
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.task_project_owner_matches(project_id, user_id)
    and (
      assignee_id is null
      or assignee_id = user_id
      or public.can_assign_task_to(assignee_id)
    )
  );

drop policy if exists "tasks_select" on public.tasks;

create policy "tasks_select"
  on public.tasks
  for select
  to authenticated
  using (
    (
      user_id = auth.uid()
      and public.task_project_owner_matches(project_id, user_id)
    )
    or (
      assignee_id = auth.uid()
      and public.can_read_delegated_task(user_id)
    )
    or public.can_manage_company_task_owner(user_id)
  );

drop policy if exists "tasks_update" on public.tasks;

create policy "tasks_update"
  on public.tasks
  for update
  to authenticated
  using (
    public.task_project_owner_matches(project_id, user_id)
    and (
      user_id = auth.uid()
      or public.can_manage_company_task_owner(user_id)
    )
  )
  with check (
    public.task_project_owner_matches(project_id, user_id)
    and (
      user_id = auth.uid()
      or public.can_manage_company_task_owner(user_id)
    )
  );

drop policy if exists "Managers and admins can read employee profiles" on public.employee_profiles;
drop policy if exists "Authorised task managers can read active company employees" on public.employee_profiles;

create policy "Authorised task managers can read active company employees"
  on public.employee_profiles
  for select
  to authenticated
  using (
    status = 'active'
    and public.can_assign_task_to(id)
  );
