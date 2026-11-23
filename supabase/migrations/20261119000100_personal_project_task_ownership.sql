-- Personal projects and tasks are owned by one authenticated user. Company
-- records keep their existing membership-based ownership and are untouched.

alter table public.projects
  add column user_id uuid references auth.users(id) on delete cascade;

alter table public.tasks
  add column user_id uuid references auth.users(id) on delete cascade;

alter table public.projects
  add constraint projects_personal_scope_check
  check ((company_id is null) <> (user_id is null));

alter table public.tasks
  add constraint tasks_personal_scope_check
  check ((company_id is null) <> (user_id is null));

alter table public.projects
  add constraint projects_user_id_id_unique unique (user_id, id);

alter table public.projects
  add constraint projects_user_code_unique unique (user_id, project_code);

alter table public.tasks
  add constraint tasks_user_id_id_unique unique (user_id, id);

alter table public.tasks
  add constraint tasks_user_code_unique unique (user_id, task_code);

-- A personal task can only reference a personal project owned by the same
-- user. Company tasks (user_id is null) keep the original company FK.
alter table public.tasks
  add constraint tasks_personal_project_fk
  foreign key (user_id, project_id)
  references public.projects (user_id, id)
  on delete cascade;

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
      and new.company_id is not null
      and not public.has_active_company_membership(new.company_id)
    then
      raise exception 'created_by must have an active company membership';
    end if;
  end if;

  return new;
end;
$$;

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

  if new.user_id is null then
    return new;
  end if;

  if current_user::text not in ('anon', 'authenticated') and auth.uid() is null then
    return new;
  end if;

  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'personal record owner must be the authenticated user';
  end if;

  if new.company_id is not null then
    raise exception 'personal records cannot belong to a company';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_protect_personal_ownership on public.projects;

create trigger projects_protect_personal_ownership
before insert or update of company_id, user_id on public.projects
for each row execute function public.protect_personal_ownership();

drop trigger if exists tasks_protect_personal_ownership on public.tasks;

create trigger tasks_protect_personal_ownership
before insert or update of company_id, user_id on public.tasks
for each row execute function public.protect_personal_ownership();

drop trigger if exists tasks_validate_assignee on public.tasks;

create trigger tasks_validate_assignee
before insert or update of assignee_id on public.tasks
for each row when (new.company_id is not null)
execute function public.validate_company_user_reference('assignee_id');

create index projects_personal_owner_status_idx
  on public.projects (user_id, status) where user_id is not null;

create index projects_personal_owner_updated_idx
  on public.projects (user_id, updated_at desc) where user_id is not null;

create index projects_personal_owner_name_idx
  on public.projects (user_id, name) where user_id is not null;

create index tasks_personal_owner_project_idx
  on public.tasks (user_id, project_id) where user_id is not null;

create index tasks_personal_owner_status_idx
  on public.tasks (user_id, status) where user_id is not null;

drop policy if exists projects_select on public.projects;

create policy projects_select on public.projects
for select to authenticated
using (
  (company_id is not null and public.has_active_company_membership(company_id))
  or (company_id is null and user_id = auth.uid())
);

drop policy if exists projects_insert on public.projects;

create policy projects_insert on public.projects
for insert to authenticated
with check (
  (
    company_id is not null
    and public.has_company_role(company_id, array['owner', 'admin']::public.company_role[])
  )
  or (company_id is null and user_id = auth.uid())
);

drop policy if exists projects_update on public.projects;

create policy projects_update on public.projects
for update to authenticated
using (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
)
with check (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
);

drop policy if exists projects_delete on public.projects;

create policy projects_delete on public.projects
for delete to authenticated
using (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
);

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks
for select to authenticated
using (
  (company_id is not null and public.has_active_company_membership(company_id))
  or (
    company_id is null
    and user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.company_id is null
        and p.user_id = auth.uid()
    )
  )
);

drop policy if exists tasks_insert on public.tasks;

create policy tasks_insert on public.tasks
for insert to authenticated
with check (
  (
    company_id is not null
    and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[])
  )
  or (
    company_id is null
    and user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.company_id is null
        and p.user_id = auth.uid()
    )
  )
);

drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks
for update to authenticated
using (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
)
with check (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
);

drop policy if exists tasks_delete on public.tasks;

create policy tasks_delete on public.tasks
for delete to authenticated
using (
  (company_id is not null and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
  or (company_id is null and user_id = auth.uid())
);

revoke all on function public.protect_personal_ownership() from public, anon, authenticated;
