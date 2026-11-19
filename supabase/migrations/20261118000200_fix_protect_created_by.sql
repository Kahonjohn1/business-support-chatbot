create or replace function public.protect_created_by()
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

    if tg_table_name <> 'companies' then
      if not public.has_active_company_membership(new.company_id) then
        raise exception 'created_by must have an active company membership';
      end if;
    end if;
  end if;

  return new;
end;
$$;
