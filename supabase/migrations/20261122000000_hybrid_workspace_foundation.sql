do $$ begin
  create type public.workspace_type as enum ('personal', 'business');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workspace_member_role as enum ('viewer', 'staff', 'manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workspace_membership_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_type public.workspace_type not null,
  name text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (char_length(btrim(name)) between 1 and 120),
  constraint workspaces_owner_scope_check check (
    (workspace_type = 'personal' and owner_user_id is not null)
    or (workspace_type = 'business' and owner_user_id is null)
  ),
  constraint workspaces_creator_owner_check check (
    workspace_type <> 'personal' or created_by = owner_user_id
  )
);

create unique index if not exists workspaces_personal_owner_unique
  on public.workspaces (owner_user_id)
  where workspace_type = 'personal';

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_member_role not null,
  status public.workspace_membership_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_memberships_unique unique (workspace_id, user_id)
);

create or replace function public.workspace_has_active_membership(
  p_workspace_id uuid,
  p_user_id uuid,
  p_roles public.workspace_member_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'::public.workspace_membership_status
      and (p_roles is null or wm.role = any(p_roles))
  );
$$;

create or replace function public.protect_workspace_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.workspace_type is distinct from old.workspace_type
      or new.owner_user_id is distinct from old.owner_user_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'workspace identity cannot be changed';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.protect_workspace_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace_type public.workspace_type;
  v_owner_user_id uuid;
begin
  select w.workspace_type, w.owner_user_id
  into v_workspace_type, v_owner_user_id
  from public.workspaces w
  where w.id = new.workspace_id;

  if not found then
    raise exception 'workspace membership requires a workspace';
  end if;

  if v_workspace_type = 'personal' then
    if new.user_id is distinct from v_owner_user_id
      or new.role <> 'manager'::public.workspace_member_role
      or new.status <> 'active'::public.workspace_membership_status
    then
      raise exception 'personal workspace membership must be the active owner';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.workspace_id is distinct from old.workspace_id
      or new.user_id is distinct from old.user_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'workspace membership identity cannot be changed';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.protect_workspace_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.workspace_id is distinct from old.workspace_id
    and not public.workspace_has_active_membership(old.workspace_id, new.user_id, null)
  then
    raise exception 'workspace scope cannot be changed without existing membership';
  end if;

  if not public.workspace_has_active_membership(new.workspace_id, new.user_id, null) then
    raise exception 'workspace record owner must be an active workspace member';
  end if;

  return new;
end;
$$;

drop trigger if exists workspaces_protect_identity on public.workspaces;
create trigger workspaces_protect_identity
before insert or update on public.workspaces
for each row execute function public.protect_workspace_identity();

drop trigger if exists workspace_memberships_protect_identity on public.workspace_memberships;
create trigger workspace_memberships_protect_identity
before insert or update on public.workspace_memberships
for each row execute function public.protect_workspace_membership_identity();

alter table public.projects
  add column if not exists workspace_id uuid;

alter table public.tasks
  add column if not exists workspace_id uuid;

alter table public.approvals
  add column if not exists workspace_id uuid;

alter table public.projects
  drop constraint if exists projects_workspace_fk;
alter table public.projects
  add constraint projects_workspace_fk
  foreign key (workspace_id) references public.workspaces(id) on delete restrict;

alter table public.tasks
  drop constraint if exists tasks_workspace_fk;
alter table public.tasks
  add constraint tasks_workspace_fk
  foreign key (workspace_id) references public.workspaces(id) on delete restrict;

alter table public.approvals
  drop constraint if exists approvals_workspace_fk;
alter table public.approvals
  add constraint approvals_workspace_fk
  foreign key (workspace_id) references public.workspaces(id) on delete restrict;

create index if not exists projects_workspace_id_idx
  on public.projects (workspace_id)
  where workspace_id is not null;

create index if not exists tasks_workspace_id_idx
  on public.tasks (workspace_id)
  where workspace_id is not null;

create index if not exists approvals_workspace_id_idx
  on public.approvals (workspace_id)
  where workspace_id is not null;

drop trigger if exists projects_protect_workspace_scope on public.projects;
create trigger projects_protect_workspace_scope
before insert or update of workspace_id, user_id on public.projects
for each row execute function public.protect_workspace_scope();

drop trigger if exists tasks_protect_workspace_scope on public.tasks;
create trigger tasks_protect_workspace_scope
before insert or update of workspace_id, user_id on public.tasks
for each row execute function public.protect_workspace_scope();

drop trigger if exists approvals_protect_workspace_scope on public.approvals;
create trigger approvals_protect_workspace_scope
before insert or update of workspace_id, user_id on public.approvals
for each row execute function public.protect_workspace_scope();

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select to authenticated
using (
  owner_user_id = auth.uid()
  or public.workspace_has_active_membership(id, auth.uid(), null)
);

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
for insert to authenticated
with check (
  (
    workspace_type = 'personal'::public.workspace_type
    and owner_user_id = auth.uid()
    and created_by = auth.uid()
  )
  or (
    workspace_type = 'business'::public.workspace_type
    and owner_user_id is null
    and created_by = auth.uid()
  )
);

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
for update to authenticated
using (
  owner_user_id = auth.uid()
  or public.workspace_has_active_membership(
    id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
)
with check (
  owner_user_id = auth.uid()
  or public.workspace_has_active_membership(
    id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
);

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
for delete to authenticated
using (
  workspace_type = 'business'::public.workspace_type
  and public.workspace_has_active_membership(
    id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
);

drop policy if exists workspace_memberships_select on public.workspace_memberships;
create policy workspace_memberships_select on public.workspace_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.workspace_has_active_membership(
    workspace_id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

drop policy if exists workspace_memberships_insert on public.workspace_memberships;
create policy workspace_memberships_insert on public.workspace_memberships
for insert to authenticated
with check (
  (
    user_id = auth.uid()
    and role = 'manager'::public.workspace_member_role
    and (
      exists (
        select 1
        from public.workspaces w
        where w.id = workspace_id
          and w.workspace_type = 'personal'::public.workspace_type
          and w.owner_user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id = workspace_id
          and w.workspace_type = 'business'::public.workspace_type
          and w.created_by = auth.uid()
      )
    )
  )
  or (
    user_id <> auth.uid()
    and role <> 'manager'::public.workspace_member_role
    and public.workspace_has_active_membership(
      workspace_id,
      auth.uid(),
      array['manager'::public.workspace_member_role]
    )
  )
);

drop policy if exists workspace_memberships_update on public.workspace_memberships;
create policy workspace_memberships_update on public.workspace_memberships
for update to authenticated
using (
  user_id = auth.uid()
  or public.workspace_has_active_membership(
    workspace_id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  public.workspace_has_active_membership(
    workspace_id,
    auth.uid(),
    array['manager'::public.workspace_member_role]
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
  or (
    user_id = auth.uid()
    and status = 'inactive'::public.workspace_membership_status
    and role <> 'manager'::public.workspace_member_role
  )
);

drop policy if exists workspace_memberships_delete on public.workspace_memberships;
create policy workspace_memberships_delete on public.workspace_memberships
for delete to authenticated
using (
  not exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.workspace_type = 'personal'::public.workspace_type
      and w.owner_user_id = workspace_memberships.user_id
  )
  and (
    public.workspace_has_active_membership(
      workspace_id,
      auth.uid(),
      array['manager'::public.workspace_member_role]
    )
    or (
      user_id = auth.uid()
      and role <> 'manager'::public.workspace_member_role
    )
  )
);

revoke all on function public.workspace_has_active_membership(uuid, uuid, public.workspace_member_role[]) from public;
grant execute on function public.workspace_has_active_membership(uuid, uuid, public.workspace_member_role[]) to authenticated, service_role;

revoke all on table public.workspaces, public.workspace_memberships from public, anon, authenticated;
grant select, insert, update, delete on table public.workspaces, public.workspace_memberships to authenticated;
grant all on table public.workspaces, public.workspace_memberships to service_role;
