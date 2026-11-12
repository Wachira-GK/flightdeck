-- 20261113000600: accounts created with Google get their name automatically.
--
-- Google (through Supabase) puts the person's name in user metadata as "full_name" (and "name"), not as
-- "display_name" like our own sign-up form. The new-user trigger now takes the first usable text value of
-- display_name, full_name, name (in that order). Every value is untrusted: only JSON strings count,
-- control characters are removed, whitespace trimmed, cut to 80 characters (the column check).
-- Blank or missing gives the empty default. Only the name comes from the metadata; roles stay 'learner'.
-- CREATE OR REPLACE keeps the function owner (app_definer), its search_path and the trigger.

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := '';
  v_key text;
  v_clean text;
begin
  foreach v_key in array array['display_name', 'full_name', 'name'] loop
    if jsonb_typeof(new.raw_user_meta_data -> v_key) = 'string' then
      v_clean := left(btrim(regexp_replace(new.raw_user_meta_data ->> v_key, '[[:cntrl:]]', '', 'g')), 80);
      if v_clean <> '' then
        v_name := v_clean;
        exit;
      end if;
    end if;
  end loop;
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'learner');
  return new;
end;
$$;
