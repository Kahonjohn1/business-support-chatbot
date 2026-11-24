-- MANUAL PROCEDURES (not executed by this migration)
--
-- Bootstrap the first Admin:
-- 1. Create or identify one confirmed Supabase Auth user.
-- 2. After applying this migration, run this as a privileged SQL role with the real UUID:
--
--    insert into public.employee_profiles (id, full_name, role, status)
--    values ('<auth-user-uuid>', 'First Admin', 'admin', 'active')
--    on conflict (id) do update
--    set full_name = excluded.full_name,
--        role = 'admin',
--        status = 'active',
--        updated_at = now();
--
-- 3. Sign in as that user and invite subsequent employees from /admin/employees.
--
-- Controlled backfill for pre-existing Supabase Auth users:
-- Do not insert all auth.users. Only provision reviewed UUIDs:
--
--    with approved_users(id, full_name, role) as (
--      values
--        ('<auth-user-uuid>', 'Full Name', 'viewer'::public.employee_role)
--    )
--    insert into public.employee_profiles (id, full_name, role, status)
--    select id, full_name, role, 'active'
--    from approved_users
--    on conflict (id) do update
--    set full_name = excluded.full_name,
--        role = excluded.role,
--        status = 'active',
--        updated_at = now();
--
-- All other Supabase users remain unprovisioned and cannot access the employee workspace.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'employee_role'
  ) then
    execute 'create type public.employee_role as enum (''viewer'', ''staff'', ''manager'', ''admin'')';
  end if;

  if (
    select array_agg(e.enumlabel order by e.enumsortorder)
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'employee_role'
  ) is distinct from array['viewer', 'staff', 'manager', 'admin']::text[] then
    raise exception 'Existing public.employee_role values do not match expected roles';
  end if;
end $$;

create table if not exists public.employee_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default 'Employee',
  role public.employee_role not null default 'viewer',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if (
    select count(*)
    from pg_attribute
    where attrelid = 'public.employee_profiles'::regclass
      and attname::text = any(array['id', 'full_name', 'role', 'status', 'created_at', 'updated_at']::text[])
      and not attisdropped
  ) <> 6 then
    raise exception 'Existing public.employee_profiles schema is missing required columns';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.employee_profiles'::regclass
      and attname = 'role'
      and atttypid = 'public.employee_role'::regtype
      and not attisdropped
  ) then
    raise exception 'Existing public.employee_profiles.role is not public.employee_role';
  end if;
end $$;

create or replace function public.current_employee_role()
returns public.employee_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.employee_profiles
  where id = (select auth.uid())
    and status = 'active';
$$;

create or replace function public.set_employee_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.employee_profiles'::regclass
      and tgname = 'employee_profiles_set_updated_at'
      and not tgisinternal
  ) then
    execute $ddl$
      create trigger employee_profiles_set_updated_at
      before update on public.employee_profiles
      for each row execute function public.set_employee_profile_updated_at()
    $ddl$;
  end if;
end $$;

create or replace function public.handle_new_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text := nullif(trim(new.raw_user_meta_data ->> 'role'), '');
  invited_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  if new.invited_at is null
    or coalesce(new.raw_user_meta_data ->> 'employee_invite', '') <> 'true'
    or invited_role is null
    or invited_role not in ('viewer', 'staff', 'manager', 'admin') then
    return new;
  end if;

  insert into public.employee_profiles (id, full_name, role, status)
  values (
    new.id,
    coalesce(invited_name, split_part(new.email, '@', 1), 'Employee'),
    invited_role::public.employee_role,
    'active'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created_employee_profile'
      and not tgisinternal
  ) then
    execute $ddl$
      create trigger on_auth_user_created_employee_profile
      after insert on auth.users
      for each row execute function public.handle_new_employee()
    $ddl$;
  end if;
end $$;

alter table public.employee_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policy
    where polrelid = 'public.employee_profiles'::regclass
      and polname = 'Employees can read their own profile'
  ) then
    execute $ddl$
      create policy "Employees can read their own profile"
      on public.employee_profiles
      for select
      to authenticated
      using ((select auth.uid()) = id)
    $ddl$;
  end if;

  if not exists (
    select 1
    from pg_policy
    where polrelid = 'public.employee_profiles'::regclass
      and polname = 'Managers and admins can read employee profiles'
  ) then
    execute $ddl$
      create policy "Managers and admins can read employee profiles"
      on public.employee_profiles
      for select
      to authenticated
      using (
        public.current_employee_role() in ('manager', 'admin')
        and status = 'active'
      )
    $ddl$;
  end if;

  if not exists (
    select 1
    from pg_policy
    where polrelid = 'public.employee_profiles'::regclass
      and polname = 'Admins can update employee profiles'
  ) then
    execute $ddl$
      create policy "Admins can update employee profiles"
      on public.employee_profiles
      for update
      to authenticated
      using (public.current_employee_role() = 'admin')
      with check (public.current_employee_role() = 'admin')
    $ddl$;
  end if;
end $$;

revoke all on function public.current_employee_role() from public, anon, authenticated;

grant execute on function public.current_employee_role() to authenticated;

revoke all on function public.handle_new_employee() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_employee() to supabase_auth_admin';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.handle_new_employee() to service_role';
  end if;
end $$;

grant usage on schema public to authenticated;

grant usage on type public.employee_role to authenticated;

grant select, update on public.employee_profiles to authenticated;
