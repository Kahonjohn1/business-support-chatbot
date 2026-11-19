alter table public.conversations
  alter column company_id drop not null;

alter table public.conversations
  drop constraint conversations_membership_fk;

alter table public.messages
  alter column company_id drop not null;

alter table public.messages
  drop constraint messages_conversation_fk;

alter table public.messages
  add constraint messages_conversation_personal_fk
  foreign key (conversation_id)
  references public.conversations (id)
  on delete cascade;

drop trigger if exists conversations_validate_membership on public.conversations;

create or replace function public.validate_personal_conversation_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'conversation owner must be the authenticated user';
  end if;

  if tg_op = 'INSERT' and new.company_id is not null then
    raise exception 'personal conversations must not belong to a company';
  end if;

  if tg_op = 'UPDATE' and old.company_id is null and new.company_id is not null then
    raise exception 'personal conversations cannot be linked to a company';
  end if;

  return new;
end;
$$;

create trigger conversations_validate_personal_owner
before insert or update of company_id, user_id on public.conversations
for each row execute function public.validate_personal_conversation_owner();

create or replace function public.align_message_company_with_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select c.company_id
  into new.company_id
  from public.conversations c
  where c.id = new.conversation_id;

  if not found then
    raise exception 'message conversation does not exist';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_align_company_with_conversation on public.messages;

create trigger messages_align_company_with_conversation
before insert or update of company_id, conversation_id on public.messages
for each row execute function public.align_message_company_with_conversation();

drop policy if exists conversations_select on public.conversations;

create policy conversations_select on public.conversations
for select to authenticated
using (user_id = auth.uid());

drop policy if exists conversations_insert on public.conversations;

create policy conversations_insert on public.conversations
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists conversations_update on public.conversations;

create policy conversations_update on public.conversations
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists conversations_delete on public.conversations;

create policy conversations_delete on public.conversations
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists messages_select on public.messages;

create policy messages_select on public.messages
for select to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists messages_insert on public.messages;

create policy messages_insert on public.messages
for insert to authenticated
with check (
  (sender_id is null or sender_id = auth.uid())
  and exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists messages_update on public.messages;

create policy messages_update on public.messages
for update to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists messages_delete on public.messages;

create policy messages_delete on public.messages
for delete to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);
