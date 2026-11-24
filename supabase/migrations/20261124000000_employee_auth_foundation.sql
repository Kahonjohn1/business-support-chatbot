create type public.employee_role as enum ('viewer', 'staff', 'manager', 'admin');

create table public.employee_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default 'Employee',
  role public.employee_role not null default 'viewer',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create trigger employee_profiles_set_updated_at
before update on public.employee_profiles
for each row execute function public.set_employee_profile_updated_at();

create or replace function public.handle_new_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text := nullif(trim(new.raw_user_meta_data ->> 'role'), '');
  invited_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  resolved_role public.employee_role := 'viewer';
begin
  if invited_role in ('viewer', 'staff', 'manager', 'admin') then
    resolved_role := invited_role::public.employee_role;
  end if;

  insert into public.employee_profiles (id, full_name, role, status)
  values (
    new.id,
    coalesce(invited_name, split_part(new.email, '@', 1), 'Employee'),
    resolved_role,
    'active'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created_employee_profile
after insert on auth.users
for each row execute function public.handle_new_employee();

alter table public.employee_profiles enable row level security;

create policy "Employees can read their own profile"
on public.employee_profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Managers and admins can read employee profiles"
on public.employee_profiles
for select
to authenticated
using (
  public.current_employee_role() in ('manager', 'admin')
  and status = 'active'
);

create policy "Admins can update employee profiles"
on public.employee_profiles
for update
to authenticated
using (public.current_employee_role() = 'admin')
with check (public.current_employee_role() = 'admin');

grant usage on schema public to authenticated;

grant usage on type public.employee_role to authenticated;

grant select, update on public.employee_profiles to authenticated;

grant execute on function public.current_employee_role() to authenticated;
