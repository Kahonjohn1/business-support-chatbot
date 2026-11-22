alter table public.messages
  drop constraint if exists messages_content_length;

alter table public.messages
  add constraint messages_content_length
  check (
    char_length(content) between 1 and 40000
    or (
      char_length(content) = 0
      and case
        when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) > 0
        else false
      end
    )
  );
