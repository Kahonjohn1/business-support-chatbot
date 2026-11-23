create or replace function public.protect_record_workspace_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.workspace_id is distinct from old.workspace_id
  then
    raise exception 'workspace scope cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.protect_task_project_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  select *
  into v_project
  from public.projects
  where id = new.project_id;

  if not found then
    raise exception 'task project not found';
  end if;

  if new.workspace_id is distinct from v_project.workspace_id then
    raise exception 'task workspace must match project workspace';
  end if;

  if v_project.workspace_id is null
    and new.user_id is distinct from v_project.user_id
  then
    raise exception 'personal task owner must match personal project owner';
  end if;

  return new;
end;
$$;

alter table public.tasks
  drop constraint if exists tasks_owner_project_fk;

alter table public.tasks
  drop constraint if exists tasks_project_fk;

alter table public.tasks
  add constraint tasks_project_fk
  foreign key (project_id) references public.projects (id)
  on delete cascade;

drop trigger if exists projects_protect_workspace_identity on public.projects;
create trigger projects_protect_workspace_identity
before update of workspace_id on public.projects
for each row execute function public.protect_record_workspace_identity();

drop trigger if exists tasks_protect_workspace_identity on public.tasks;
create trigger tasks_protect_workspace_identity
before update of workspace_id on public.tasks
for each row execute function public.protect_record_workspace_identity();

drop trigger if exists tasks_protect_project_scope on public.tasks;
create trigger tasks_protect_project_scope
before insert or update of workspace_id, project_id, user_id on public.tasks
for each row execute function public.protect_task_project_scope();

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select to authenticated
using (
  (workspace_id is null and user_id = auth.uid())
  or (
    workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = projects.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      projects.workspace_id,
      auth.uid(),
      null
    )
  )
);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
for insert to authenticated
with check (
  (workspace_id is null and user_id = auth.uid())
  or (
    workspace_id is not null
    and user_id = auth.uid()
    and exists (
      select 1
      from public.workspaces w
      where w.id = projects.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      projects.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
  )
);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
for update to authenticated
using (
  (workspace_id is null and user_id = auth.uid())
  or (
    workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = projects.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      projects.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
  )
)
with check (
  (workspace_id is null and user_id = auth.uid())
  or (
    workspace_id is not null
    and user_id = auth.uid()
    and exists (
      select 1
      from public.workspaces w
      where w.id = projects.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      projects.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
  )
);

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
for delete to authenticated
using (
  (workspace_id is null and user_id = auth.uid())
  or (
    workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = projects.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      projects.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
  )
);

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
for select to authenticated
using (
  (
    tasks.workspace_id is null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id is null
        and p.user_id = auth.uid()
    )
  )
  or (
    tasks.workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = tasks.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      tasks.workspace_id,
      auth.uid(),
      null
    )
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id = tasks.workspace_id
    )
  )
);

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
for insert to authenticated
with check (
  (
    tasks.workspace_id is null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id is null
        and p.user_id = auth.uid()
    )
  )
  or (
    tasks.workspace_id is not null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.workspaces w
      where w.id = tasks.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      tasks.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id = tasks.workspace_id
    )
  )
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
for update to authenticated
using (
  (
    tasks.workspace_id is null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id is null
        and p.user_id = auth.uid()
    )
  )
  or (
    tasks.workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = tasks.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      tasks.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id = tasks.workspace_id
    )
  )
)
with check (
  (
    tasks.workspace_id is null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id is null
        and p.user_id = auth.uid()
    )
  )
  or (
    tasks.workspace_id is not null
    and tasks.user_id = auth.uid()
    and exists (
      select 1
      from public.workspaces w
      where w.id = tasks.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      tasks.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.workspace_id = tasks.workspace_id
    )
  )
);

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
for delete to authenticated
using (
  (
    tasks.workspace_id is null
    and tasks.user_id = auth.uid()
  )
  or (
    tasks.workspace_id is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = tasks.workspace_id
        and w.workspace_type = 'business'::public.workspace_type
    )
    and public.workspace_has_active_membership(
      tasks.workspace_id,
      auth.uid(),
      array[
        'staff'::public.workspace_member_role,
        'manager'::public.workspace_member_role
      ]
    )
  )
);

revoke all on function public.protect_record_workspace_identity() from public;
grant execute on function public.protect_record_workspace_identity() to authenticated, service_role;
revoke all on function public.protect_task_project_scope() from public;
grant execute on function public.protect_task_project_scope() to authenticated, service_role;
