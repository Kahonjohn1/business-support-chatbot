alter table public.tasks drop constraint if exists tasks_owner_project_fk;

alter table public.tasks add constraint tasks_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete restrict;

create or replace function public.is_active_marque_employee(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.employee_profiles ep
      where ep.id = p_user_id
        and ep.status = 'active'
    )
    and exists (
      select 1
      from public.company_memberships cm
      where cm.user_id = p_user_id
        and cm.company_id = '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'
        and cm.status = 'active'
    );
$$;

create or replace function public.is_marque_manager_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.employee_profiles ep
      where ep.id = p_user_id
        and ep.status = 'active'
        and ep.role = any (array['manager'::public.employee_role, 'admin'::public.employee_role])
    )
    and exists (
      select 1
      from public.company_memberships cm
      where cm.user_id = p_user_id
        and cm.company_id = '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'
        and cm.status = 'active'
        and cm.role = any (array['owner'::public.company_role, 'admin'::public.company_role])
    );
$$;

create or replace function public.is_marque_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null
    and exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and public.is_active_marque_employee(p.user_id)
    );
$$;

create or replace function public.can_manage_marque_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_marque_project(p_project_id)
    and public.is_marque_manager_admin(auth.uid());
$$;

create or replace function public.can_read_delegated_task(p_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_user_id is not null
    and public.is_active_marque_employee(auth.uid())
    and public.is_active_marque_employee(p_owner_user_id);
$$;

create or replace function public.can_assign_task_to(p_assignee_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_assignee_user_id is not null
    and public.is_marque_manager_admin(auth.uid())
    and public.is_active_marque_employee(p_assignee_user_id);
$$;

create or replace function public.can_manage_marque_task_owner(p_task_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_task_owner_user_id is not null
    and public.is_marque_manager_admin(auth.uid())
    and public.is_active_marque_employee(p_task_owner_user_id);
$$;

create or replace function public.can_read_marque_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_marque_project(p_project_id)
    or (
      public.is_marque_project(p_project_id)
      and public.is_active_marque_employee(auth.uid())
      and exists (
        select 1
        from public.tasks t
        where t.project_id = p_project_id
          and t.assignee_id = auth.uid()
          and public.can_read_delegated_task(t.user_id)
      )
    );
$$;

create or replace function public.update_my_marque_task_status(p_task_id uuid, p_status public.task_status)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_status is null or p_status not in (
    'todo'::public.task_status,
    'in_progress'::public.task_status,
    'done'::public.task_status
  ) then
    raise exception 'valid task status required';
  end if;

  if not public.is_active_marque_employee(auth.uid()) then
    raise exception 'active Marque employee required';
  end if;

  select t.*
  into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.assignee_id = auth.uid()
    and public.is_marque_project(t.project_id)
    and public.is_active_marque_employee(t.user_id)
  for update;

  if not found then
    raise exception 'task not found or not assigned to current employee';
  end if;

  update public.tasks t
  set status = p_status,
      updated_at = now()
  where t.id = p_task_id
    and t.assignee_id = auth.uid()
  returning t.* into v_task;

  return v_task;
end;
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
    raise exception 'assignee must be the task owner or an active Marque employee';
  end if;

  return new;
end;
$$;

revoke all on function public.is_active_marque_employee(uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_marque_manager_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_marque_project(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_manage_marque_project(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_read_delegated_task(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_assign_task_to(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_manage_marque_task_owner(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_read_marque_project(uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_my_marque_task_status(uuid, public.task_status) from public, anon, authenticated, service_role;
revoke all on function public.validate_task_assignment() from public, anon, authenticated, service_role;

grant execute on function public.is_active_marque_employee(uuid) to authenticated;
grant execute on function public.is_marque_manager_admin(uuid) to authenticated;
grant execute on function public.is_marque_project(uuid) to authenticated;
grant execute on function public.can_manage_marque_project(uuid) to authenticated;
grant execute on function public.can_read_delegated_task(uuid) to authenticated;
grant execute on function public.can_assign_task_to(uuid) to authenticated;
grant execute on function public.can_manage_marque_task_owner(uuid) to authenticated;
grant execute on function public.can_read_marque_project(uuid) to authenticated;
grant execute on function public.update_my_marque_task_status(uuid, public.task_status) to authenticated;

drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

drop function if exists public.task_project_owner_matches(uuid, uuid);
drop function if exists public.can_manage_company_task_owner(uuid);

create policy "projects_select"
on public.projects
for select
to authenticated
using (
  (user_id = auth.uid() and public.is_active_marque_employee(auth.uid()))
  or public.can_read_marque_project(id)
);

create policy "projects_insert"
on public.projects
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_marque_manager_admin(auth.uid())
);

create policy "projects_update"
on public.projects
for update
to authenticated
using (public.can_manage_marque_project(id))
with check (public.can_manage_marque_project(id));

create policy "projects_delete"
on public.projects
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_marque_project(id)
);

create policy "tasks_insert"
on public.tasks
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_marque_manager_admin(auth.uid())
  and public.is_marque_project(project_id)
  and (
    assignee_id is null
    or assignee_id = user_id
    or public.can_assign_task_to(assignee_id)
  )
);

create policy "tasks_select"
on public.tasks
for select
to authenticated
using (
  public.is_marque_project(project_id)
  and (
    (user_id = auth.uid() and public.is_active_marque_employee(auth.uid()))
    or (assignee_id = auth.uid() and public.can_read_delegated_task(user_id))
    or public.can_manage_marque_task_owner(user_id)
  )
);

create policy "tasks_update"
on public.tasks
for update
to authenticated
using (
  public.is_marque_project(project_id)
  and (
    (user_id = auth.uid() and public.is_active_marque_employee(auth.uid()))
    or public.can_manage_marque_task_owner(user_id)
  )
)
with check (
  public.is_marque_project(project_id)
  and (
    (user_id = auth.uid() and public.is_active_marque_employee(auth.uid()))
    or public.can_manage_marque_task_owner(user_id)
  )
);

create policy "tasks_delete"
on public.tasks
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_marque_project(project_id)
);
