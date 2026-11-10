-- Test-only stand-in for the parts of Supabase the migrations depend on.
-- Mirrors Supabase's broad default grants so the tests prove our REVOKEs work.
-- Never applied to a real Supabase project (which provides these objects itself).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key,
  email text unique
);

-- Same contract as Supabase: the JWT `sub` claim of the current request.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role, public;
grant execute on function auth.uid() to public;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
