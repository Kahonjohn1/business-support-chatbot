create table if not exists public.rate_limit_counters (
  key text primary key,
  window_start timestamptz not null,
  count integer not null check (count > 0)
);

create index if not exists rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;

revoke all on table public.rate_limit_counters from anon, authenticated, service_role;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_key is null or char_length(btrim(p_key)) = 0 or char_length(p_key) > 256 then
    raise exception 'A valid rate-limit key is required.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'A valid rate-limit limit is required.';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'A valid rate-limit window is required.';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) * 1000 / p_window_ms)
    * p_window_ms / 1000.0
  );

  insert into public.rate_limit_counters (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key) do update
  set window_start = excluded.window_start,
      count = case
        when public.rate_limit_counters.window_start = excluded.window_start
          then public.rate_limit_counters.count + 1
        else 1
      end
  returning count into v_count;

  if random() < 0.01 then
    delete from public.rate_limit_counters
    where window_start < clock_timestamp() - interval '1 day';
  end if;

  v_retry := greatest(
    1,
    ceil(extract(epoch from (
      v_window + make_interval(secs => (p_window_ms::double precision / 1000.0)) - clock_timestamp()
    )))::integer
  );

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds', v_retry
  );
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.list_integration_connections(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid default null
)
returns setof public.integration_connections
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.integration_connections c
  where public.integration_workspace_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and c.owner_user_id = auth.uid()
  order by c.provider, c.created_at desc;
$$;

create or replace function public.get_integration_connection(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid default null
)
returns public.integration_connections
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.integration_connections c
  where c.id = p_connection_id
    and public.integration_workspace_access_allowed(p_scope, p_workspace_id, auth.uid(), false)
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and c.owner_user_id = auth.uid();
$$;

create or replace function public.set_integration_connection_status(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_status public.integration_connection_status,
  p_last_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_status is null then
    raise exception 'Authentication and a valid status are required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;

  update public.integration_connections c
  set status = p_status,
      last_error = nullif(btrim(coalesce(p_last_error, '')), '')
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and c.owner_user_id = v_user_id;
end;
$$;

create or replace function public.update_integration_tokens(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_token_expires_at text,
  p_granted_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_expires_at timestamptz;
begin
  if v_user_id is null or char_length(btrim(coalesce(p_access_token_encrypted, ''))) = 0 then
    raise exception 'Authentication and an encrypted access token are required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;
  if coalesce(array_length(p_granted_scopes, 1), 0) > 12 then
    raise exception 'Too many granted scopes.';
  end if;
  if p_token_expires_at is null or btrim(p_token_expires_at) = '' then
    v_expires_at := null;
  else
    v_expires_at := p_token_expires_at::timestamptz;
  end if;

  update public.integration_connections c
  set encrypted_access_token = p_access_token_encrypted,
      encrypted_refresh_token = p_refresh_token_encrypted,
      token_expires_at = v_expires_at,
      granted_scopes = coalesce(p_granted_scopes, '{}'),
      status = 'connected'::public.integration_connection_status,
      last_error = null
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and c.owner_user_id = v_user_id;
end;
$$;

create or replace function public.delete_integration_connection(
  p_connection_id uuid,
  p_scope public.integration_connection_scope,
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, true) then
    raise exception 'Integration access is not permitted.';
  end if;

  delete from public.integration_connections c
  where c.id = p_connection_id
    and c.scope = p_scope
    and c.workspace_id is not distinct from p_workspace_id
    and c.owner_user_id = v_user_id;
end;
$$;

create or replace function public.record_integration_audit_event(
  p_scope public.integration_connection_scope,
  p_workspace_id uuid,
  p_provider public.integration_provider,
  p_action text,
  p_outcome public.integration_audit_outcome,
  p_details jsonb
)
returns public.integration_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.integration_audit_events%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if not public.integration_workspace_access_allowed(p_scope, p_workspace_id, v_user_id, false) then
    raise exception 'Integration access is not permitted.';
  end if;
  if p_provider is null or p_outcome is null or char_length(v_action) = 0 then
    raise exception 'A valid audit event is required.';
  end if;
  if v_action !~ '^[a-z][a-z0-9_.-]{2,119}$' then
    raise exception 'A valid audit action is required.';
  end if;
  if v_action not in (
    'connection.connected',
    'connection.disconnected',
    'connection.revoked',
    'connection.status',
    'connection.reconnect_required',
    'tool.search',
    'tool.read',
    'tool.draft',
    'tool.denied'
  ) then
    raise exception 'A valid audit action is required.';
  end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'Audit details must be an object.';
  end if;
  if char_length(coalesce(p_details, '{}'::jsonb)::text) > 4000 then
    raise exception 'Audit details are too large.';
  end if;

  insert into public.integration_audit_events (
    actor_user_id, scope, workspace_id, provider, action, outcome, details
  )
  values (
    v_user_id, p_scope, p_workspace_id, p_provider, v_action, p_outcome,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.list_integration_connections(public.integration_connection_scope, uuid)
  to authenticated, service_role;
grant execute on function public.get_integration_connection(uuid, public.integration_connection_scope, uuid)
  to authenticated, service_role;
grant execute on function public.set_integration_connection_status(uuid, public.integration_connection_scope, uuid, public.integration_connection_status, text)
  to authenticated, service_role;
grant execute on function public.update_integration_tokens(uuid, public.integration_connection_scope, uuid, text, text, text, text[])
  to authenticated, service_role;
grant execute on function public.delete_integration_connection(uuid, public.integration_connection_scope, uuid)
  to authenticated, service_role;
grant execute on function public.record_integration_audit_event(public.integration_connection_scope, uuid, public.integration_provider, text, public.integration_audit_outcome, jsonb)
  to authenticated, service_role;
