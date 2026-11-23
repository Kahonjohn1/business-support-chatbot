create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_member_role not null,
  status text not null default 'pending',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  invited_by uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invitations_email_not_blank
    check (char_length(btrim(email)) between 3 and 254),
  constraint workspace_invitations_status_check
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled'))
);

create unique index if not exists workspace_invitations_pending_unique
  on public.workspace_invitations (workspace_id, lower(email))
  where status = 'pending';

create index if not exists workspace_invitations_workspace_status_idx
  on public.workspace_invitations (workspace_id, status, created_at desc);

create index if not exists workspace_invitations_token_idx
  on public.workspace_invitations (token);

create or replace function public.workspace_is_owner(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
      and (
        w.owner_user_id = p_user_id
        or (w.workspace_type = 'business'::public.workspace_type and w.created_by = p_user_id)
      )
  );
$$;

create or replace function public.create_business_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_workspace public.workspaces;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception 'Workspace name must be between 1 and 120 characters.';
  end if;

  insert into public.workspaces (workspace_type, name, owner_user_id, created_by)
  values ('business'::public.workspace_type, v_name, null, v_user_id)
  returning * into v_workspace;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, created_by)
  values (v_workspace.id, v_user_id, 'manager'::public.workspace_member_role, 'active'::public.workspace_membership_status, v_user_id);

  return v_workspace;
end;
$$;

create or replace function public.list_workspace_members(p_workspace_id uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.workspace_member_role,
  status public.workspace_membership_status,
  is_owner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    wm.id,
    wm.user_id,
    u.email,
    coalesce(
      p.display_name,
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(u.email, '@', 1), ''),
      wm.user_id::text
    ) as display_name,
    wm.role,
    wm.status,
    public.workspace_is_owner(w.id, wm.user_id) as is_owner
  from public.workspace_memberships wm
  join public.workspaces w on w.id = wm.workspace_id
  left join public.profiles p on p.id = wm.user_id
  left join auth.users u on u.id = wm.user_id
  where wm.workspace_id = p_workspace_id
    and w.workspace_type = 'business'::public.workspace_type
    and public.workspace_has_active_membership(p_workspace_id, auth.uid(), null)
  order by
    case wm.role when 'manager' then 0 when 'staff' then 1 else 2 end,
    coalesce(p.display_name, u.email, wm.user_id::text);
$$;

create or replace function public.list_workspace_invitations(p_workspace_id uuid)
returns table (
  id uuid,
  workspace_id uuid,
  email text,
  role public.workspace_member_role,
  status text,
  expires_at timestamptz,
  invited_at timestamptz,
  invited_by uuid,
  invited_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    wi.id,
    wi.workspace_id,
    wi.email,
    wi.role,
    wi.status,
    wi.expires_at,
    wi.created_at as invited_at,
    wi.invited_by,
    coalesce(p.display_name, u.email, 'Former member') as invited_by_name,
    wi.created_at
  from public.workspace_invitations wi
  join public.workspaces w on w.id = wi.workspace_id
  left join public.profiles p on p.id = wi.invited_by
  left join auth.users u on u.id = wi.invited_by
  where wi.workspace_id = p_workspace_id
    and w.workspace_type = 'business'::public.workspace_type
    and public.workspace_has_active_membership(
      p_workspace_id,
      auth.uid(),
      array['manager']::public.workspace_member_role[]
    )
  order by wi.created_at desc;
$$;

create or replace function public.list_my_workspace_invitations()
returns table (
  id uuid,
  workspace_id uuid,
  workspace_name text,
  email text,
  role public.workspace_member_role,
  status text,
  token text,
  expires_at timestamptz,
  invited_at timestamptz,
  invited_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    wi.id,
    w.id as workspace_id,
    w.name as workspace_name,
    wi.email,
    wi.role,
    wi.status,
    wi.token,
    wi.expires_at,
    wi.created_at as invited_at,
    coalesce(p.display_name, u.email, 'Former member') as invited_by_name
  from public.workspace_invitations wi
  join public.workspaces w on w.id = wi.workspace_id
  left join public.profiles p on p.id = wi.invited_by
  left join auth.users u on u.id = wi.invited_by
  where wi.status = 'pending'
    and wi.expires_at > now()
    and w.workspace_type = 'business'::public.workspace_type
    and (
      wi.invited_user_id = auth.uid()
      or lower(wi.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by wi.created_at desc;
$$;

create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_member_role
)
returns public.workspace_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_target_id uuid;
  v_workspace_type public.workspace_type;
  v_row public.workspace_invitations;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'A valid email address is required.';
  end if;

  select w.workspace_type into v_workspace_type
  from public.workspaces w
  where w.id = p_workspace_id;
  if not found or v_workspace_type <> 'business'::public.workspace_type then
    raise exception 'A business workspace is required.';
  end if;
  if not public.workspace_has_active_membership(
    p_workspace_id,
    v_actor_id,
    array['manager']::public.workspace_member_role[]
  ) then
    raise exception 'Manager access is required.';
  end if;
  if p_role = 'manager'::public.workspace_member_role
    and not public.workspace_is_owner(p_workspace_id, v_actor_id) then
    raise exception 'Only the workspace owner can invite managers.';
  end if;

  select u.id into v_target_id
  from auth.users u
  where lower(u.email) = v_email;
  if v_target_id = v_actor_id then
    raise exception 'You cannot invite yourself.';
  end if;
  if v_target_id is not null and public.workspace_has_active_membership(p_workspace_id, v_target_id, null) then
    raise exception 'That person is already an active member.';
  end if;

  update public.workspace_invitations wi
  set
    role = p_role,
    status = 'pending',
    token = encode(gen_random_bytes(24), 'hex'),
    expires_at = now() + interval '7 days',
    invited_by = v_actor_id,
    invited_user_id = v_target_id,
    updated_at = now()
  where wi.workspace_id = p_workspace_id
    and lower(wi.email) = v_email
    and wi.status = 'pending'
  returning * into v_row;

  if not found then
    insert into public.workspace_invitations (
      workspace_id,
      email,
      role,
      status,
      invited_by,
      invited_user_id
    )
    values (p_workspace_id, v_email, p_role, 'pending', v_actor_id, v_target_id)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.accept_workspace_invitation(p_token text)
returns table (workspace_id uuid, workspace_name text, role public.workspace_member_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation public.workspace_invitations;
  v_current_role public.workspace_member_role;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user_id;
  if v_email is null then
    raise exception 'A verified email address is required.';
  end if;

  select wi.* into v_invitation
  from public.workspace_invitations wi
  where wi.token = p_token
    and wi.status = 'pending'
    and wi.expires_at > now()
    and (
      wi.invited_user_id = v_user_id
      or lower(wi.email) = v_email
    )
  for update;
  if not found then
    raise exception 'Invitation not found or expired.';
  end if;

  if public.workspace_has_active_membership(v_invitation.workspace_id, v_user_id, null) then
    select wm.role into v_current_role
    from public.workspace_memberships wm
    where wm.workspace_id = v_invitation.workspace_id
      and wm.user_id = v_user_id;
  else
    insert into public.workspace_memberships (workspace_id, user_id, role, status, created_by)
    values (v_invitation.workspace_id, v_user_id, v_invitation.role, 'active'::public.workspace_membership_status, v_invitation.invited_by)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role,
          status = 'active'::public.workspace_membership_status,
          updated_at = now()
    returning role into v_current_role;
  end if;

  update public.workspace_invitations wi
  set status = 'accepted', invited_user_id = v_user_id, updated_at = now()
  where wi.id = v_invitation.id;

  return query
  select w.id, w.name, v_current_role
  from public.workspaces w
  where w.id = v_invitation.workspace_id;
end;
$$;

create or replace function public.decline_workspace_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user_id;
  if v_email is null then
    raise exception 'A verified email address is required.';
  end if;

  select wi.id into v_invitation_id
  from public.workspace_invitations wi
  where wi.token = p_token
    and wi.status = 'pending'
    and (
      wi.invited_user_id = v_user_id
      or lower(wi.email) = v_email
    )
  for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;

  update public.workspace_invitations wi
  set status = 'declined', invited_user_id = v_user_id, updated_at = now()
  where wi.id = v_invitation_id;
end;
$$;

create or replace function public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_member_role
)
returns public.workspace_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target public.workspace_memberships;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;
  if v_user_id = v_actor_id then
    raise exception 'You cannot change your own role.';
  end if;
  if not public.workspace_has_active_membership(
    p_workspace_id,
    v_actor_id,
    array['manager']::public.workspace_member_role[]
  ) then
    raise exception 'Manager access is required.';
  end if;
  if public.workspace_is_owner(p_workspace_id, v_user_id) then
    raise exception 'The workspace owner cannot be changed.';
  end if;

  select wm.* into v_target
  from public.workspace_memberships wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'::public.workspace_membership_status
  for update;
  if not found then
    raise exception 'Active workspace member not found.';
  end if;
  if v_target.role = 'manager'::public.workspace_member_role
    and not public.workspace_is_owner(p_workspace_id, v_actor_id) then
    raise exception 'Only the workspace owner can change managers.';
  end if;
  if p_role = 'manager'::public.workspace_member_role
    and not public.workspace_is_owner(p_workspace_id, v_actor_id) then
    raise exception 'Only the workspace owner can appoint managers.';
  end if;

  update public.workspace_memberships wm
  set role = p_role, updated_at = now()
  where wm.id = v_target.id
  returning * into v_target;
  return v_target;
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target public.workspace_memberships;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;
  if v_user_id = v_actor_id then
    raise exception 'You cannot remove yourself.';
  end if;
  if not public.workspace_has_active_membership(
    p_workspace_id,
    v_actor_id,
    array['manager']::public.workspace_member_role[]
  ) then
    raise exception 'Manager access is required.';
  end if;
  if public.workspace_is_owner(p_workspace_id, v_user_id) then
    raise exception 'The workspace owner cannot be removed.';
  end if;

  select wm.* into v_target
  from public.workspace_memberships wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Workspace member not found.';
  end if;
  if v_target.role = 'manager'::public.workspace_member_role
    and not public.workspace_is_owner(p_workspace_id, v_actor_id) then
    raise exception 'Only the workspace owner can remove managers.';
  end if;

  if v_target.status = 'active'::public.workspace_membership_status then
    update public.workspace_memberships wm
    set status = 'inactive'::public.workspace_membership_status, updated_at = now()
    where wm.id = v_target.id;
  end if;
end;
$$;

create or replace function public.protect_task_assignee_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assignee_id is null then
    return new;
  end if;
  if new.workspace_id is null then
    if new.assignee_id is distinct from new.user_id then
      raise exception 'Personal tasks can only be assigned to their owner.';
    end if;
    return new;
  end if;
  if not public.workspace_has_active_membership(new.workspace_id, new.user_id, null) then
    raise exception 'Task owner must be an active workspace member.';
  end if;
  if not public.workspace_has_active_membership(new.workspace_id, new.assignee_id, null) then
    raise exception 'Task assignee must be an active member of this workspace.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_protect_assignee_membership on public.tasks;
create trigger tasks_protect_assignee_membership
before insert or update of assignee_id, workspace_id, user_id on public.tasks
for each row execute function public.protect_task_assignee_membership();

alter table public.workspace_invitations enable row level security;

revoke all on public.workspace_invitations from anon, authenticated;
grant select on public.workspace_invitations to authenticated;
grant all on public.workspace_invitations to service_role;

drop policy if exists workspace_invitations_select on public.workspace_invitations;
create policy workspace_invitations_select on public.workspace_invitations
for select to authenticated
using (
  (
    status = 'pending'
    and expires_at > now()
    and (
      invited_user_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  or public.workspace_has_active_membership(
    workspace_id,
    auth.uid(),
    array['manager']::public.workspace_member_role[]
  )
);

revoke all on function public.create_business_workspace(text) from public;
revoke all on function public.list_workspace_members(uuid) from public;
revoke all on function public.list_workspace_invitations(uuid) from public;
revoke all on function public.list_my_workspace_invitations() from public;
revoke all on function public.create_workspace_invitation(uuid, text, public.workspace_member_role) from public;
revoke all on function public.accept_workspace_invitation(text) from public;
revoke all on function public.decline_workspace_invitation(text) from public;
revoke all on function public.update_workspace_member_role(uuid, uuid, public.workspace_member_role) from public;
revoke all on function public.remove_workspace_member(uuid, uuid) from public;

grant execute on function public.create_business_workspace(text) to authenticated;
grant execute on function public.list_workspace_members(uuid) to authenticated;
grant execute on function public.list_workspace_invitations(uuid) to authenticated;
grant execute on function public.list_my_workspace_invitations() to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, public.workspace_member_role) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
grant execute on function public.decline_workspace_invitation(text) to authenticated;
grant execute on function public.update_workspace_member_role(uuid, uuid, public.workspace_member_role) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
