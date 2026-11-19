create function public.invite_company_member(
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

  if not public.user_has_company_role(
    p_company_id,
    auth.uid(),
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'only an active owner or admin can invite members';
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

create function public.list_my_company_invitations()
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
  order by m.invited_at desc;
$$;

create function public.accept_company_invitation(p_company_id uuid)
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
    and m.user_id = auth.uid()
    and m.status = 'invited';

  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

revoke all on function public.invite_company_member(uuid, text, public.company_role) from public, anon, authenticated;
revoke all on function public.list_my_company_invitations() from public, anon, authenticated;
revoke all on function public.accept_company_invitation(uuid) from public, anon, authenticated;

grant execute on function public.invite_company_member(uuid, text, public.company_role) to authenticated;
grant execute on function public.list_my_company_invitations() to authenticated;
grant execute on function public.accept_company_invitation(uuid) to authenticated;
