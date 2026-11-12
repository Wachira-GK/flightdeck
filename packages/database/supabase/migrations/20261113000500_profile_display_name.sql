-- 20261113000500: new accounts get their display name from sign-up metadata.
--
-- The sign-up form sends the name as user metadata ("display_name"). The new-user trigger copies it into
-- public.profiles. The value is untrusted input: control characters are removed, whitespace trimmed and the
-- result cut to 80 characters (the column check). Missing or non-text metadata gives the empty default.
-- CREATE OR REPLACE keeps the function owner (app_definer), its search_path and the trigger.

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := case
    when jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string'
      then left(btrim(regexp_replace(new.raw_user_meta_data ->> 'display_name', '[[:cntrl:]]', '', 'g')), 80)
    else ''
  end;
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'learner');
  return new;
end;
$$;
