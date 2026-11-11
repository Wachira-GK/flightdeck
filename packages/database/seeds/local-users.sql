-- FlightDeck LOCAL/TEST seed users (FD-C01). GENERATED FILE: do not edit by hand.
-- NEVER apply to production. Placeholder accounts with no password: they cannot sign in.
-- Apply BEFORE seeds/catalogue.sql on a local Supabase (supabase db reset) or the PGlite test harness.
-- The on_auth_user_created trigger also gives each a profile, preferences and the learner role.

begin;

do $$
begin
  if coalesce(current_setting('flightdeck.allow_local_seed_users', true), '') = 'off' then
    raise exception 'local-users.sql is for local/test databases only';
  end if;
end;
$$;

insert into auth.users (id, email) values
  ('5eed0000-0000-4000-8000-00000000a001', 'content-author@flightdeck.local'),
  ('5eed0000-0000-4000-8000-00000000a002', 'content-reviewer@flightdeck.local')
on conflict do nothing;

insert into public.user_roles (user_id, role) values
  ('5eed0000-0000-4000-8000-00000000a001', 'author'),
  ('5eed0000-0000-4000-8000-00000000a002', 'reviewer')
on conflict do nothing;

commit;
