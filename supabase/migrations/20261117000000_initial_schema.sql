do $$ begin
  create type public.company_role as enum ('owner', 'admin', 'operator', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('active', 'invited', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum ('planned', 'active', 'blocked', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_approval_status as enum ('pending', 'approved', 'rejected', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected', 'executing', 'executed', 'expired', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_outcome as enum ('permitted', 'denied', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed');
exception when duplicate_object then null; end $$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_not_blank check (char_length(btrim(name)) between 1 and 120),
  constraint companies_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 120)
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null,
  status public.membership_status not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_memberships_unique unique (company_id, user_id),
  constraint company_memberships_active_joined check (status <> 'active' or joined_at is not null)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_code text not null,
  name text not null,
  status public.project_status not null default 'planned',
  progress_notes text not null default '',
  blockers jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_company_code_unique unique (company_id, project_code),
  constraint projects_company_id_unique unique (company_id, id),
  constraint projects_code_format check (project_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  constraint projects_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint projects_blockers_array check (jsonb_typeof(blockers) = 'array')
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null,
  task_code text not null,
  title text not null,
  description text,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'todo',
  assignee_id uuid references auth.users(id) on delete set null,
  assignee_label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_company_code_unique unique (company_id, task_code),
  constraint tasks_company_id_unique unique (company_id, id),
  constraint tasks_company_project_fk foreign key (company_id, project_id)
    references public.projects (company_id, id) on delete cascade,
  constraint tasks_code_format check (task_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  constraint tasks_title_not_blank check (char_length(btrim(title)) between 1 and 200)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_company_id_unique unique (company_id, id),
  constraint conversations_membership_fk foreign key (company_id, user_id)
    references public.company_memberships (company_id, user_id) on delete cascade,
  constraint conversations_title_length check (title is null or char_length(title) <= 160)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  sender_id uuid references auth.users(id) on delete set null,
  role public.message_role not null,
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  insufficient_evidence boolean not null default false,
  pending_approval boolean not null default false,
  approval_status public.message_approval_status,
  created_at timestamptz not null default now(),
  constraint messages_conversation_fk foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  constraint messages_attachments_array check (jsonb_typeof(attachments) = 'array'),
  constraint messages_sources_array check (jsonb_typeof(sources) = 'array'),
  constraint messages_content_length check (char_length(content) between 1 and 40000)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  approval_ref text not null unique,
  request_id text not null,
  conversation_id uuid,
  task_id uuid,
  requested_by uuid references auth.users(id) on delete set null,
  tool_name text not null,
  raw_arguments text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decision_by text,
  decision_by_user_id uuid references auth.users(id) on delete set null,
  decision_at timestamptz,
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  execution_result jsonb,
  failure_reason text,
  constraint approvals_company_id_unique unique (company_id, id),
  constraint approvals_conversation_fk foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete set null,
  constraint approvals_task_fk foreign key (company_id, task_id)
    references public.tasks (company_id, id) on delete set null,
  constraint approvals_ref_format check (approval_ref ~ '^appr_[A-Za-z0-9_-]+$'),
  constraint approvals_request_not_blank check (char_length(btrim(request_id)) > 0),
  constraint approvals_tool_not_blank check (char_length(btrim(tool_name)) > 0),
  constraint approvals_summary_not_blank check (char_length(btrim(summary)) > 0),
  constraint approvals_details_object check (jsonb_typeof(details) = 'object'),
  constraint approvals_expiry_after_creation check (expires_at > created_at),
  constraint approvals_failure_reason_length check (failure_reason is null or char_length(failure_reason) <= 500)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  request_id text,
  tool_name text,
  operation text,
  action text not null,
  outcome public.audit_outcome not null,
  permission_allowed boolean,
  required_permission text,
  approval_id uuid,
  error_code text,
  duration_ms integer,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_events_action_not_blank check (char_length(btrim(action)) > 0),
  constraint audit_events_approval_fk foreign key (company_id, approval_id)
    references public.approvals (company_id, id) on delete set null,
  constraint audit_events_details_object check (jsonb_typeof(details) = 'object'),
  constraint audit_events_duration_nonnegative check (duration_ms is null or duration_ms >= 0)
);

create index companies_created_at_idx on public.companies (created_at desc);
create index profiles_created_at_idx on public.profiles (created_at desc);
create index company_memberships_active_idx on public.company_memberships (company_id, user_id) where status = 'active';
create index company_memberships_user_status_idx on public.company_memberships (user_id, status);
create index company_memberships_company_role_idx on public.company_memberships (company_id, role, status);
create index projects_company_status_idx on public.projects (company_id, status);
create index tasks_company_project_idx on public.tasks (company_id, project_id);
create index tasks_company_status_idx on public.tasks (company_id, status);
create index conversations_company_user_idx on public.conversations (company_id, user_id);
create index messages_conversation_created_idx on public.messages (company_id, conversation_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id) where sender_id is not null;
create index approvals_company_status_idx on public.approvals (company_id, status);
create index approvals_company_request_idx on public.approvals (company_id, request_id);
create index approvals_company_expiry_idx on public.approvals (company_id, expires_at) where status = 'pending';
create index audit_events_company_occurred_idx on public.audit_events (company_id, occurred_at desc);
create index audit_events_company_user_idx on public.audit_events (company_id, user_id);
create index audit_events_company_action_idx on public.audit_events (company_id, action);
create index audit_events_company_approval_idx on public.audit_events (company_id, approval_id) where approval_id is not null;
create index audit_events_company_outcome_idx on public.audit_events (company_id, outcome);
create index audit_events_request_idx on public.audit_events (company_id, request_id) where request_id is not null;

create function public.user_has_active_company_membership(p_company_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = p_user_id
      and m.status = 'active'
  );
$$;

create function public.has_active_company_membership(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_active_company_membership(p_company_id, auth.uid());
$$;

create function public.user_has_company_role(p_company_id uuid, p_user_id uuid, p_roles public.company_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.role = any(p_roles)
  );
$$;

create function public.has_company_role(p_company_id uuid, p_roles public.company_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_company_role(p_company_id, auth.uid(), p_roles);
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.prevent_company_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'record id cannot be changed';
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot be changed';
  end if;

  return new;
end;
$$;

create function public.protect_membership_user_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'membership user_id cannot be changed';
  end if;

  return new;
end;
$$;

create function public.protect_created_by()
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
      and not public.has_active_company_membership(new.company_id)
    then
      raise exception 'created_by must have an active company membership';
    end if;
  end if;

  return new;
end;
$$;

create function public.protect_invited_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.invited_by is distinct from old.invited_by then
      if new.invited_by is null
        and old.invited_by is not null
        and current_user::text not in ('anon', 'authenticated')
        and auth.uid() is null
      then
        return new;
      end if;

      raise exception 'invited_by cannot be changed after creation';
    end if;

    return new;
  end if;

  if new.invited_by is not null and new.invited_by <> auth.uid() then
    raise exception 'invited_by must be the authenticated user';
  end if;

  return new;
end;
$$;

create function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_remaining integer;
begin
  select c.id into v_company_id
  from public.companies c
  where c.id = old.company_id
  for update;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'owner' and old.status = 'active' then
      select count(*) into v_remaining
      from public.company_memberships m
      where m.company_id = old.company_id
        and m.role = 'owner'
        and m.status = 'active'
        and m.id <> old.id;

      if v_remaining = 0 then
        raise exception 'cannot remove the last active owner of a company; transfer ownership first';
      end if;
    end if;

    return old;
  end if;

  if old.role = 'owner'
    and old.status = 'active'
    and (new.role <> 'owner' or new.status <> 'active')
  then
    select count(*) into v_remaining
    from public.company_memberships m
    where m.company_id = old.company_id
      and m.role = 'owner'
      and m.status = 'active'
      and m.id <> old.id;

    if v_remaining = 0 then
      raise exception 'cannot remove the last active owner of a company; transfer ownership first';
    end if;
  end if;

  return new;
end;
$$;

create function public.protect_approval_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approval_ref is distinct from old.approval_ref
    or new.company_id is distinct from old.company_id
    or new.request_id is distinct from old.request_id
    or new.tool_name is distinct from old.tool_name
    or new.raw_arguments is distinct from old.raw_arguments
    or new.summary is distinct from old.summary
    or new.details is distinct from old.details
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.requested_by is distinct from old.requested_by
    and not (
      new.requested_by is null
      and old.requested_by is not null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.conversation_id is distinct from old.conversation_id
    and not (
      new.conversation_id is null
      and old.conversation_id is not null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.task_id is distinct from old.task_id
    and not (
      new.task_id is null
      and old.task_id is not null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if old.decision_by is not null and new.decision_by is distinct from old.decision_by then
    raise exception 'approval decision text cannot be changed';
  end if;

  return new;
end;
$$;

create function public.validate_approval_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.decision_by_user_id is not null
    and new.decision_by_user_id is distinct from old.decision_by_user_id
    and not (
      new.decision_by_user_id is null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
    )
  then
    raise exception 'approval decision user cannot be changed';
  end if;

  if old.decision_at is not null and new.decision_at is distinct from old.decision_at then
    raise exception 'approval decision time cannot be changed';
  end if;

  if old.execution_started_at is not null
    and new.execution_started_at is distinct from old.execution_started_at
  then
    raise exception 'approval execution start time cannot be changed';
  end if;

  if old.execution_completed_at is not null
    and new.execution_completed_at is distinct from old.execution_completed_at
  then
    raise exception 'approval execution completion time cannot be changed';
  end if;

  if old.execution_result is not null
    and new.execution_result is distinct from old.execution_result
  then
    raise exception 'approval execution result cannot be changed';
  end if;

  if old.failure_reason is not null
    and new.failure_reason is distinct from old.failure_reason
  then
    raise exception 'approval failure reason cannot be changed';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      if now() >= old.expires_at then
        raise exception 'approval request has expired';
      end if;

      if new.decision_by_user_id is null or new.decision_at is null then
        raise exception 'approval decision requires a decision user and timestamp';
      end if;
    elsif old.status = 'pending' and new.status = 'expired' then
      if now() < old.expires_at then
        raise exception 'approval request has not expired';
      end if;

      if new.decision_by is distinct from 'system' or new.decision_at is null then
        raise exception 'expired approval requires system decision metadata';
      end if;
    elsif old.status = 'approved' and new.status = 'executing' then
      if new.execution_started_at is null then
        raise exception 'approval execution requires a start timestamp';
      end if;
    elsif old.status = 'executing' and new.status = 'executed' then
      if new.execution_completed_at is null or new.execution_result is null then
        raise exception 'executed approval requires a completion timestamp and result';
      end if;
    elsif old.status = 'executing' and new.status = 'failed' then
      if new.execution_completed_at is null or new.failure_reason is null then
        raise exception 'failed approval requires a completion timestamp and failure reason';
      end if;
    else
      raise exception 'invalid approval status transition';
    end if;
  end if;

  return new;
end;
$$;

create function public.validate_company_user_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text;
  v_user_id uuid;
begin
  foreach v_column in array tg_argv loop
    v_user_id := nullif(to_jsonb(new) ->> v_column, '')::uuid;

    if v_user_id is not null
      and not public.user_has_active_company_membership(new.company_id, v_user_id)
    then
      raise exception '% must reference an active member of the same company', v_column;
    end if;
  end loop;

  return new;
end;
$$;

create function public.validate_conversation_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_active_company_membership(new.company_id, new.user_id) then
    raise exception 'conversation owner must have an active company membership';
  end if;

  return new;
end;
$$;

create function public.is_sensitive_audit_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_key, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g')
    ~* '(^|[-_])(api[_-]?key|key|token|secret|access[_-]?token|refresh[_-]?token|auth|authorization|bearer|cookie|session|credential|credentials|password|passwd|pwd|private[_-]?key)([-_]|$)';
$$;

create function public.is_secret_like_audit_value(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'string'
    and (
      p_value #>> '{}' ~* '(^|[^a-z0-9])(sk-|rk-|pk_live_|pk_test_|ghp_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9_-]{8,}'
      or p_value #>> '{}' ~* '^Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}$'
      or p_value #>> '{}' ~* '^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$'
    );
$$;

create function public.sanitize_audit_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value ~* '(^|[^a-z0-9])(sk-|rk-|pk_live_|pk_test_|ghp_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9_-]{8,}'
      or p_value ~* '^Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}$'
      or p_value ~* '^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$'
    then '[REDACTED]'
    else p_value
  end;
$$;

create function public.sanitize_audit_details(p_details jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb := p_details;
  v_key text;
  v_value jsonb;
begin
  if p_details is null then
    return null;
  end if;

  if jsonb_typeof(p_details) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_details) loop
      if public.is_sensitive_audit_key(v_key)
        or public.is_secret_like_audit_value(v_value)
      then
        v_result := jsonb_set(v_result, array[v_key], to_jsonb('[REDACTED]'::text), false);
      else
        v_result := jsonb_set(v_result, array[v_key], public.sanitize_audit_details(v_value), false);
      end if;
    end loop;
  elsif jsonb_typeof(p_details) = 'array' then
    select coalesce(
      jsonb_agg(
        case
          when public.is_secret_like_audit_value(t.elem) then to_jsonb('[REDACTED]'::text)
          else public.sanitize_audit_details(t.elem)
        end
        order by t.ord
      ),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_details) with ordinality as t(elem, ord);
  end if;

  return v_result;
end;
$$;

create function public.sanitize_audit_event_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.details := public.sanitize_audit_details(new.details);
  return new;
end;
$$;

create function public.handle_supabase_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := nullif(new.raw_user_meta_data ->> 'full_name', '');

  if v_display_name is null then
    v_display_name := nullif(split_part(new.email, '@', 1), '');
  end if;

  v_display_name := left(v_display_name, 120);

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create function public.create_company_with_owner(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'company name must be between 1 and 120 characters';
  end if;

  if p_slug is null or char_length(btrim(p_slug)) not between 1 and 63 then
    raise exception 'company slug must be between 1 and 63 characters';
  end if;

  v_slug := lower(btrim(p_slug));

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'company slug may contain only lowercase letters, numbers and single hyphens';
  end if;

  if v_slug = 'marque-technologies' then
    raise exception 'company slug is reserved';
  end if;

  insert into public.profiles (id)
  values (v_user_id)
  on conflict (id) do nothing;

  insert into public.companies (name, slug, created_by)
  values (btrim(p_name), v_slug, v_user_id)
  returning id into v_company_id;

  insert into public.company_memberships (company_id, user_id, role, status, joined_at)
  values (v_company_id, v_user_id, 'owner', 'active', now());

  return v_company_id;
end;
$$;

create function public.claim_company_owner(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_bootstrap_company_id uuid;
  v_bootstrap_user_id uuid;
  v_locked_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_company_id is null
    or p_company_id <> '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'::uuid
  then
    raise exception 'company does not accept owner claims';
  end if;

  select nullif(coalesce(u.raw_app_meta_data ->> 'bootstrap_company_id', ''), '')::uuid,
         nullif(coalesce(u.raw_app_meta_data ->> 'bootstrap_user_id', ''), '')::uuid
  into v_bootstrap_company_id, v_bootstrap_user_id
  from auth.users u
  where u.id = v_user_id
  for share;

  if not found then
    raise exception 'authenticated user not found';
  end if;

  if v_bootstrap_company_id is distinct from p_company_id
    or v_bootstrap_user_id is distinct from v_user_id
  then
    raise exception 'no bootstrap claim for this company';
  end if;

  select c.id into v_locked_company_id
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'company not found';
  end if;

  if exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = v_user_id
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    raise exception 'company already has an active owner';
  end if;

  insert into public.profiles (id)
  values (v_user_id)
  on conflict (id) do nothing;

  insert into public.company_memberships as m (company_id, user_id, role, status, joined_at)
  values (p_company_id, v_user_id, 'owner', 'active', now())
  on conflict (company_id, user_id) do update
  set role = 'owner',
      status = 'active',
      joined_at = coalesce(m.joined_at, now());

  return true;
end;
$$;

create function public.grant_company_bootstrap_claim(p_company_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company_id is null
    or p_company_id <> '3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80'::uuid
    or p_user_id is null
  then
    raise exception 'invalid bootstrap claim grant';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'authenticated user not found';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company not found';
  end if;

  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'bootstrap_company_id', p_company_id::text,
      'bootstrap_user_id', p_user_id::text
    )
  where u.id = p_user_id;

  return true;
end;
$$;

create function public.revoke_company_bootstrap_claim(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'invalid bootstrap claim revoke';
  end if;

  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
    - 'bootstrap_company_id'
    - 'bootstrap_user_id'
  where u.id = p_user_id;

  return found;
end;
$$;

create function public.transfer_company_owner(p_company_id uuid, p_new_owner_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_locked_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select c.id into v_locked_company_id
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'company not found';
  end if;

  if not public.user_has_company_role(
    p_company_id,
    v_user_id,
    array['owner']::public.company_role[]
  ) then
    raise exception 'only an active owner can transfer company ownership';
  end if;

  if not public.user_has_active_company_membership(p_company_id, p_new_owner_user_id) then
    raise exception 'new owner must have an active company membership';
  end if;

  if p_new_owner_user_id = v_user_id then
    return true;
  end if;

  update public.company_memberships as m
  set role = 'owner',
      status = 'active',
      joined_at = coalesce(m.joined_at, now())
  where m.company_id = p_company_id
    and m.user_id = p_new_owner_user_id;

  update public.company_memberships as m
  set role = 'admin'
  where m.company_id = p_company_id
    and m.user_id = v_user_id
    and m.role = 'owner'
    and m.status = 'active';

  return true;
end;
$$;

create function public.decide_approval(p_approval_id uuid, p_decision public.approval_status)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_decision is null
    or p_decision not in ('approved'::public.approval_status, 'rejected'::public.approval_status)
  then
    raise exception 'decision must be approved or rejected';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.user_has_company_role(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval decision requires owner or admin role';
  end if;

  if v_approval.status <> 'pending' then
    return v_approval;
  end if;

  if now() >= v_approval.expires_at then
    raise exception 'approval request has expired';
  end if;

  update public.approvals a
  set status = p_decision,
      decision_by = v_user_id::text,
      decision_by_user_id = v_user_id,
      decision_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create function public.begin_approval_execution(p_approval_id uuid)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.user_has_company_role(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval execution requires owner or admin role';
  end if;

  if v_approval.status in ('executing', 'executed', 'failed') then
    return v_approval;
  end if;

  if v_approval.status <> 'approved' then
    raise exception 'approval request is not approved';
  end if;

  update public.approvals a
  set status = 'executing',
      execution_started_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create function public.complete_approval_execution(
  p_approval_id uuid,
  p_execution_result jsonb,
  p_failure_reason text default null
)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_failure_reason is not null and char_length(p_failure_reason) > 500 then
    raise exception 'failure reason must be at most 500 characters';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.user_has_company_role(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval execution requires owner or admin role';
  end if;

  if v_approval.status in ('executed', 'failed') then
    return v_approval;
  end if;

  if v_approval.status = 'approved' then
    update public.approvals a
    set status = 'executing',
        execution_started_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  end if;

  if v_approval.status <> 'executing' then
    return v_approval;
  end if;

  if p_failure_reason is null then
    update public.approvals a
    set status = 'executed',
        execution_result = coalesce(p_execution_result, '{}'::jsonb),
        execution_completed_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  else
    update public.approvals a
    set status = 'failed',
        execution_result = coalesce(p_execution_result, '{}'::jsonb),
        failure_reason = p_failure_reason,
        execution_completed_at = now()
    where a.id = p_approval_id
    returning a.* into v_approval;
  end if;

  return v_approval;
end;
$$;

create function public.expire_approval(p_approval_id uuid)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.approvals;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select a.* into v_approval
  from public.approvals a
  where a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if not public.user_has_company_role(
    v_approval.company_id,
    v_user_id,
    array['owner', 'admin']::public.company_role[]
  ) then
    raise exception 'approval expiration requires owner or admin role';
  end if;

  if v_approval.status <> 'pending' then
    return v_approval;
  end if;

  if now() < v_approval.expires_at then
    raise exception 'approval request has not expired';
  end if;

  update public.approvals a
  set status = 'expired',
      decision_by = 'system',
      decision_at = now()
  where a.id = p_approval_id
  returning a.* into v_approval;

  return v_approval;
end;
$$;

create function public.record_audit_event(
  p_company_id uuid,
  p_action text,
  p_outcome public.audit_outcome,
  p_request_id text default null,
  p_tool_name text default null,
  p_operation text default null,
  p_permission_allowed boolean default null,
  p_required_permission text default null,
  p_approval_id uuid default null,
  p_error_code text default null,
  p_duration_ms integer default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_audit_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not public.user_has_company_role(
    p_company_id,
    v_user_id,
    array['owner', 'admin', 'operator']::public.company_role[]
  ) then
    raise exception 'audit event creation requires owner, admin, or operator role';
  end if;

  if p_action is null or p_outcome is null then
    raise exception 'audit action and outcome are required';
  end if;

  if not (
    (p_action = 'permission_check' and p_outcome in ('permitted', 'denied'))
    or (p_action = 'tool_dispatch' and p_outcome = 'denied')
    or (p_action = 'tool_execution' and p_outcome in ('executed', 'failed'))
  ) then
    raise exception 'unsupported audit action and outcome combination';
  end if;

  if p_action = 'permission_check' and p_permission_allowed is null then
    raise exception 'permission audit events require a permission decision';
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'audit duration cannot be negative';
  end if;

  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'audit details must be a json object';
  end if;

  insert into public.audit_events (
    company_id,
    user_id,
    request_id,
    tool_name,
    operation,
    action,
    outcome,
    permission_allowed,
    required_permission,
    approval_id,
    error_code,
    duration_ms,
    details
  )
  values (
    p_company_id,
    v_user_id,
    public.sanitize_audit_text(p_request_id),
    public.sanitize_audit_text(p_tool_name),
    public.sanitize_audit_text(p_operation),
    p_action,
    p_outcome,
    p_permission_allowed,
    p_required_permission,
    p_approval_id,
    public.sanitize_audit_text(p_error_code),
    p_duration_ms,
    v_details
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

create function public.record_approval_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_outcome public.audit_outcome;
  v_user_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'approval_requested';
    v_outcome := 'pending_approval';
    v_user_id := new.requested_by;
  elsif new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      v_action := 'approval_decision';
      v_outcome := new.status::text::public.audit_outcome;
      v_user_id := new.decision_by_user_id;
    elsif old.status = 'approved' and new.status = 'executing' then
      v_action := 'approval_execution';
      v_outcome := 'executing';
      v_user_id := auth.uid();
    elsif old.status = 'executing' and new.status = 'executed' then
      v_action := 'approval_execution';
      v_outcome := 'executed';
      v_user_id := auth.uid();
    elsif old.status = 'executing' and new.status = 'failed' then
      v_action := 'approval_execution';
      v_outcome := 'failed';
      v_user_id := auth.uid();
    elsif old.status = 'pending' and new.status = 'expired' then
      v_action := 'approval_expired';
      v_outcome := 'failed';
      v_user_id := auth.uid();
    end if;
  end if;

  if v_action is null then
    return new;
  end if;

  insert into public.audit_events (
    company_id,
    user_id,
    approval_id,
    tool_name,
    action,
    outcome,
    details
  )
  values (
    new.company_id,
    v_user_id,
    new.id,
    public.sanitize_audit_text(new.tool_name),
    v_action,
    v_outcome,
    jsonb_build_object(
      'approval_ref', new.approval_ref,
      'request_id', public.sanitize_audit_text(new.request_id),
      'status', new.status::text
    )
  );

  return new;
end;
$$;

create function public.protect_audit_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit events are append-only';
  end if;

  if (to_jsonb(new) - 'user_id' - 'approval_id') is distinct from (to_jsonb(old) - 'user_id' - 'approval_id') then
    raise exception 'audit events are append-only';
  end if;

  if new.user_id is distinct from old.user_id
    or new.approval_id is distinct from old.approval_id
  then
    if not (
      current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
      and (new.user_id is not distinct from old.user_id or new.user_id is null)
      and (new.approval_id is not distinct from old.approval_id or new.approval_id is null)
      and (
        (new.user_id is null and old.user_id is not null)
        or (new.approval_id is null and old.approval_id is not null)
      )
    ) then
      raise exception 'audit events are append-only';
    end if;
  end if;

  return new;
end;
$$;

create function public.protect_audit_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger company_memberships_set_updated_at
before update on public.company_memberships
for each row execute function public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create trigger approvals_set_updated_at
before update on public.approvals
for each row execute function public.set_updated_at();

create trigger company_memberships_prevent_scope_change
before update on public.company_memberships
for each row execute function public.prevent_company_scope_change();

create trigger company_memberships_protect_user_id
before update of user_id on public.company_memberships
for each row execute function public.protect_membership_user_id();

create trigger company_memberships_protect_invited_by
before insert or update of invited_by on public.company_memberships
for each row execute function public.protect_invited_by();

create trigger companies_protect_created_by
before insert or update of created_by on public.companies
for each row execute function public.protect_created_by();

create trigger projects_protect_created_by
before insert or update of created_by on public.projects
for each row execute function public.protect_created_by();

create trigger tasks_protect_created_by
before insert or update of created_by on public.tasks
for each row execute function public.protect_created_by();

create trigger projects_prevent_scope_change
before update on public.projects
for each row execute function public.prevent_company_scope_change();

create trigger tasks_prevent_scope_change
before update on public.tasks
for each row execute function public.prevent_company_scope_change();

create trigger conversations_prevent_scope_change
before update on public.conversations
for each row execute function public.prevent_company_scope_change();

create trigger messages_prevent_scope_change
before update on public.messages
for each row execute function public.prevent_company_scope_change();

create trigger approvals_prevent_scope_change
before update on public.approvals
for each row execute function public.prevent_company_scope_change();

create trigger audit_events_prevent_scope_change
before update on public.audit_events
for each row execute function public.prevent_company_scope_change();

create trigger company_memberships_protect_last_owner
before delete or update of role, status on public.company_memberships
for each row execute function public.protect_last_owner();

create trigger approvals_protect_identity
before update on public.approvals
for each row execute function public.protect_approval_identity();

create trigger approvals_validate_decision_user
before update of decision_by_user_id on public.approvals
for each row execute function public.validate_company_user_reference('decision_by_user_id');

create trigger approvals_validate_transition
before update on public.approvals
for each row execute function public.validate_approval_transition();

create trigger approvals_audit_events
after insert or update of status on public.approvals
for each row execute function public.record_approval_audit_event();

create trigger company_memberships_validate_invited_by
before insert or update of invited_by on public.company_memberships
for each row execute function public.validate_company_user_reference('invited_by');

create trigger tasks_validate_assignee
before insert or update of assignee_id on public.tasks
for each row execute function public.validate_company_user_reference('assignee_id');

create trigger audit_events_validate_user
before insert on public.audit_events
for each row execute function public.validate_company_user_reference('user_id');

create trigger conversations_validate_membership
before insert or update of company_id, user_id on public.conversations
for each row execute function public.validate_conversation_membership();

create trigger audit_events_protect_append_only
before update or delete on public.audit_events
for each row execute function public.protect_audit_events();

create trigger audit_events_protect_truncate
before truncate on public.audit_events
for each statement execute function public.protect_audit_truncate();

create trigger audit_events_sanitize_details
before insert on public.audit_events
for each row execute function public.sanitize_audit_event_details();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_supabase_user_created();

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_events enable row level security;

create policy companies_select on public.companies
for select to authenticated
using (public.has_active_company_membership(id));

create policy companies_update on public.companies
for update to authenticated
using (public.has_company_role(id, array['owner']::public.company_role[]))
with check (public.has_company_role(id, array['owner']::public.company_role[]));

create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_insert on public.profiles
for insert to authenticated
with check (id = auth.uid());

create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy company_memberships_select on public.company_memberships
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy company_memberships_insert on public.company_memberships
for insert to authenticated
with check (
  public.has_company_role(company_id, array['owner', 'admin']::public.company_role[])
  and role <> 'owner'
  and not (user_id = auth.uid() and role = 'admin')
  and (invited_by is null or invited_by = auth.uid())
);

create policy company_memberships_update on public.company_memberships
for update to authenticated
using (public.has_company_role(company_id, array['owner']::public.company_role[]))
with check (public.has_company_role(company_id, array['owner']::public.company_role[]));

create policy company_memberships_delete on public.company_memberships
for delete to authenticated
using (public.has_company_role(company_id, array['owner']::public.company_role[]));

create policy projects_select on public.projects
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy projects_insert on public.projects
for insert to authenticated
with check (public.has_company_role(company_id, array['owner', 'admin']::public.company_role[]));

create policy projects_update on public.projects
for update to authenticated
using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]));

create policy projects_delete on public.projects
for delete to authenticated
using (public.has_company_role(company_id, array['owner', 'admin']::public.company_role[]));

create policy tasks_select on public.tasks
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy tasks_insert on public.tasks
for insert to authenticated
with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]));

create policy tasks_update on public.tasks
for update to authenticated
using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]));

create policy tasks_delete on public.tasks
for delete to authenticated
using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[]));

create policy conversations_select on public.conversations
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy conversations_insert on public.conversations
for insert to authenticated
with check (user_id = auth.uid() and public.has_active_company_membership(company_id));

create policy conversations_update on public.conversations
for update to authenticated
using (user_id = auth.uid() and public.has_active_company_membership(company_id))
with check (user_id = auth.uid() and public.has_active_company_membership(company_id));

create policy conversations_delete on public.conversations
for delete to authenticated
using (user_id = auth.uid() and public.has_active_company_membership(company_id));

create policy messages_select on public.messages
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy messages_insert on public.messages
for insert to authenticated
with check (
  public.has_active_company_membership(company_id)
  and (sender_id is null or sender_id = auth.uid())
);

create policy approvals_select on public.approvals
for select to authenticated
using (public.has_active_company_membership(company_id));

create policy approvals_insert on public.approvals
for insert to authenticated
with check (
  requested_by = auth.uid()
  and public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_role[])
  and status = 'pending'
  and decision_by is null
  and decision_by_user_id is null
  and decision_at is null
  and execution_started_at is null
  and execution_completed_at is null
  and execution_result is null
  and failure_reason is null
);

create policy audit_events_select on public.audit_events
for select to authenticated
using (public.has_active_company_membership(company_id));

revoke all on table public.companies, public.profiles, public.company_memberships, public.projects, public.tasks, public.conversations, public.messages, public.approvals, public.audit_events from anon, authenticated;

grant select, update on table public.companies to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.company_memberships to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert on table public.messages to authenticated;
grant select, insert on table public.approvals to authenticated;
grant select on table public.audit_events to authenticated;

revoke all on function public.user_has_active_company_membership(uuid, uuid) from public, anon, authenticated;
revoke all on function public.has_active_company_membership(uuid) from public, anon, authenticated;
revoke all on function public.user_has_company_role(uuid, uuid, public.company_role[]) from public, anon, authenticated;
revoke all on function public.has_company_role(uuid, public.company_role[]) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_company_scope_change() from public, anon, authenticated;
revoke all on function public.protect_membership_user_id() from public, anon, authenticated;
revoke all on function public.protect_invited_by() from public, anon, authenticated;
revoke all on function public.protect_created_by() from public, anon, authenticated;
revoke all on function public.protect_last_owner() from public, anon, authenticated;
revoke all on function public.protect_approval_identity() from public, anon, authenticated;
revoke all on function public.validate_approval_transition() from public, anon, authenticated;
revoke all on function public.validate_company_user_reference() from public, anon, authenticated;
revoke all on function public.validate_conversation_membership() from public, anon, authenticated;
revoke all on function public.is_sensitive_audit_key(text) from public, anon, authenticated;
revoke all on function public.is_secret_like_audit_value(jsonb) from public, anon, authenticated;
revoke all on function public.sanitize_audit_text(text) from public, anon, authenticated;
revoke all on function public.sanitize_audit_details(jsonb) from public, anon, authenticated;
revoke all on function public.sanitize_audit_event_details() from public, anon, authenticated;
revoke all on function public.record_approval_audit_event() from public, anon, authenticated;
revoke all on function public.protect_audit_events() from public, anon, authenticated;
revoke all on function public.protect_audit_truncate() from public, anon, authenticated;
revoke all on function public.handle_supabase_user_created() from public, anon, authenticated;
revoke all on function public.create_company_with_owner(text, text) from public, anon, authenticated;
revoke all on function public.claim_company_owner(uuid) from public, anon, authenticated;
revoke all on function public.grant_company_bootstrap_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_company_bootstrap_claim(uuid) from public, anon, authenticated;
revoke all on function public.transfer_company_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_approval(uuid, public.approval_status) from public, anon, authenticated;
revoke all on function public.begin_approval_execution(uuid) from public, anon, authenticated;
revoke all on function public.complete_approval_execution(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.expire_approval(uuid) from public, anon, authenticated;
revoke all on function public.record_audit_event(uuid, text, public.audit_outcome, text, text, text, boolean, text, uuid, text, integer, jsonb) from public, anon, authenticated;

grant execute on function public.has_active_company_membership(uuid) to authenticated;
grant execute on function public.has_company_role(uuid, public.company_role[]) to authenticated;
grant execute on function public.create_company_with_owner(text, text) to authenticated;
grant execute on function public.claim_company_owner(uuid) to authenticated;
grant execute on function public.transfer_company_owner(uuid, uuid) to authenticated;
grant execute on function public.decide_approval(uuid, public.approval_status) to authenticated;
grant execute on function public.begin_approval_execution(uuid) to authenticated;
grant execute on function public.complete_approval_execution(uuid, jsonb, text) to authenticated;
grant execute on function public.expire_approval(uuid) to authenticated;
grant execute on function public.record_audit_event(uuid, text, public.audit_outcome, text, text, text, boolean, text, uuid, text, integer, jsonb) to authenticated;
grant execute on function public.grant_company_bootstrap_claim(uuid, uuid) to service_role;
grant execute on function public.revoke_company_bootstrap_claim(uuid) to service_role;
grant execute on function public.handle_supabase_user_created() to supabase_auth_admin;
