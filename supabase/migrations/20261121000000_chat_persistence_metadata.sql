alter table public.messages
  add column if not exists client_message_id text;

alter table public.messages
  add column if not exists ordinal integer;

alter table public.messages
  add column if not exists approval_metadata jsonb default '{}'::jsonb;

update public.messages
  set approval_metadata = '{}'::jsonb
  where approval_metadata is null;

alter table public.messages
  alter column approval_metadata set default '{}'::jsonb,
  alter column approval_metadata set not null;

update public.messages
set client_message_id = id::text
where client_message_id is null or char_length(btrim(client_message_id)) = 0;

with bounds as (
  select
    conversation_id,
    max(ordinal) + 1 as next_ordinal
  from public.messages
  where ordinal is not null
  group by conversation_id
), ordered as (
  select
    m.id,
    coalesce(bounds.next_ordinal, 0) + row_number() over (
      partition by m.conversation_id
      order by m.created_at, m.id
    ) - 1 as row_ordinal
  from public.messages m
  left join bounds on bounds.conversation_id = m.conversation_id
  where m.ordinal is null
)
update public.messages m
set ordinal = ordered.row_ordinal
from ordered
where m.id = ordered.id;

alter table public.messages
  alter column client_message_id set not null;

alter table public.messages
  alter column ordinal set not null;

alter table public.messages
  drop constraint if exists messages_client_message_id_key;

alter table public.messages
  add constraint messages_client_message_id_key
  unique (conversation_id, client_message_id);

alter table public.messages
  drop constraint if exists messages_client_message_id_length_check;

alter table public.messages
  add constraint messages_client_message_id_length_check
  check (char_length(btrim(client_message_id)) between 1 and 256);

alter table public.messages
  drop constraint if exists messages_ordinal_nonnegative_check;

alter table public.messages
  add constraint messages_ordinal_nonnegative_check
  check (ordinal >= 0);

alter table public.messages
  drop constraint if exists messages_approval_metadata_object_check;

alter table public.messages
  add constraint messages_approval_metadata_object_check
  check (jsonb_typeof(approval_metadata) = 'object');

drop index if exists public.messages_conversation_ordinal_idx;

create index messages_conversation_ordinal_idx
  on public.messages (conversation_id, ordinal);

grant update on table public.messages to authenticated;
