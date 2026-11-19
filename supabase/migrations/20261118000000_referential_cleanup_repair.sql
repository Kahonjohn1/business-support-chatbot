alter table public.approvals
  drop constraint approvals_conversation_fk;

alter table public.approvals
  add constraint approvals_conversation_fk
  foreign key (company_id, conversation_id)
  references public.conversations (company_id, id)
  on delete set null (conversation_id);

alter table public.approvals
  drop constraint approvals_task_fk;

alter table public.approvals
  add constraint approvals_task_fk
  foreign key (company_id, task_id)
  references public.tasks (company_id, id)
  on delete set null (task_id);

alter table public.audit_events
  drop constraint audit_events_approval_fk;

alter table public.audit_events
  add constraint audit_events_approval_fk
  foreign key (company_id, approval_id)
  references public.approvals (company_id, id)
  on delete set null (approval_id);

create or replace function public.protect_approval_identity()
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
      and new.task_id is not distinct from old.task_id
    )
  then
    raise exception 'approval request fields cannot be changed';
  end if;

  if new.task_id is distinct from old.task_id
    and not (
      new.task_id is null
      and old.task_id is not null
      and new.conversation_id is not distinct from old.conversation_id
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

create or replace function public.protect_audit_events()
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
    and not (
      new.user_id is null
      and old.user_id is not null
      and current_user::text not in ('anon', 'authenticated')
      and auth.uid() is null
      and new.approval_id is not distinct from old.approval_id
    )
  then
    raise exception 'audit events are append-only';
  end if;

  if new.approval_id is distinct from old.approval_id
    and not (
      new.approval_id is null
      and old.approval_id is not null
      and new.user_id is not distinct from old.user_id
    )
  then
    raise exception 'audit events are append-only';
  end if;

  return new;
end;
$$;

drop policy conversations_select on public.conversations;

create policy conversations_select on public.conversations
for select to authenticated
using (
  user_id = auth.uid()
  and public.has_active_company_membership(company_id)
);

drop policy messages_select on public.messages;

create policy messages_select on public.messages
for select to authenticated
using (
  public.has_active_company_membership(company_id)
  and exists (
    select 1
    from public.conversations c
    where c.company_id = messages.company_id
      and c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy messages_insert on public.messages;

create policy messages_insert on public.messages
for insert to authenticated
with check (
  public.has_active_company_membership(company_id)
  and (sender_id is null or sender_id = auth.uid())
  and exists (
    select 1
    from public.conversations c
    where c.company_id = messages.company_id
      and c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);
