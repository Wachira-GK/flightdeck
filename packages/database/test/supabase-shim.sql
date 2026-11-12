-- Test-only stand-in for the parts of Supabase the migrations depend on.
-- Mirrors Supabase's broad default grants so the tests prove our REVOKEs work.
-- Never applied to a real Supabase project (which provides these objects itself).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Same contract as Supabase: the JWT `sub` claim of the current request.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Like real Supabase: only these three roles (NOT public) may use schema auth. A role that needs it,
-- such as the helper owner app_definer, must be granted explicitly (see migration 20261112000400).
grant usage on schema auth to anon, authenticated, service_role;
revoke execute on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
