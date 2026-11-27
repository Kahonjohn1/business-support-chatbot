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

  if p_company_id is null
    or p_company_id <> '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'::uuid then
    raise exception 'only the Marque company can be managed';
  end if;

  if not exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role::text in ('owner', 'admin')
  ) then
    raise exception 'only an active owner or admin can invite members';
  end if;

  if p_role::text not in ('admin', 'operator', 'viewer') then
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

alter function public.invite_company_member(uuid, text, public.company_role) owner to postgres;

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

  if p_company_id is null
    or p_company_id <> '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'::uuid then
    raise exception 'only the Marque company can be managed';
  end if;

  update public.company_memberships m
  set status = 'active',
      joined_at = coalesce(m.joined_at, now())
  where m.company_id = p_company_id
    and m.user_id = auth.uid()
    and m.status = 'invited'
    and m.role::text in ('admin', 'operator', 'viewer');

  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

alter function public.accept_company_invitation(uuid) owner to postgres;

revoke all on function public.invite_company_member(uuid, text, public.company_role) from public, anon, authenticated, service_role;
revoke all on function public.accept_company_invitation(uuid) from public, anon, authenticated, service_role;

grant execute on function public.invite_company_member(uuid, text, public.company_role) to authenticated;
grant execute on function public.accept_company_invitation(uuid) to authenticated;
