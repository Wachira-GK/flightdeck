-- FlightDeck: set the master admin and the two initial admins (ADR-009).
-- RUN BY HAND in the Supabase SQL Editor AFTER migration 20261123000800 is applied and AFTER both people have
-- created an account (sign-up or Continue with Google). Never part of tests or automatic seeding.
-- Safe to run again: it only adds what is missing and prints what it did.
--
--   godfreyclass24@gmail.com : MASTER admin + admin + author
--   godmarklee@gmail.com     : admin + reviewer
--
-- The master is a single row. To MOVE the master later, delete that row and insert the new one here by hand.

do $$
declare
  v_master uuid;
  v_other  uuid;
begin
  select id into v_master from auth.users where lower(email) = 'godfreyclass24@gmail.com';
  select id into v_other  from auth.users where lower(email) = 'godmarklee@gmail.com';
  if v_master is null then raise exception 'godfreyclass24@gmail.com has no account yet: sign up first'; end if;
  if v_other  is null then raise exception 'godmarklee@gmail.com has no account yet: sign up first'; end if;

  insert into app_private.platform_owner (user_id) values (v_master)
  on conflict (singleton) do nothing;
  if not exists (select 1 from app_private.platform_owner where user_id = v_master) then
    raise exception 'A different master admin is already set. Remove it deliberately first.';
  end if;

  insert into public.user_roles (user_id, role, granted_by) values
    (v_master, 'admin',    v_master),
    (v_master, 'author',   v_master),
    (v_other,  'admin',    v_master),
    (v_other,  'reviewer', v_master)
  on conflict (user_id, role) do nothing;

  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_master, 'bootstrap_admins', 'user', v_master::text, jsonb_build_object('other', v_other));
end $$;

select u.email, array_agg(r.role::text order by r.role::text) as roles,
       exists (select 1 from app_private.platform_owner o where o.user_id = u.id) as is_master
  from auth.users u join public.user_roles r on r.user_id = u.id
 where lower(u.email) in ('godfreyclass24@gmail.com', 'godmarklee@gmail.com')
 group by u.id, u.email;
