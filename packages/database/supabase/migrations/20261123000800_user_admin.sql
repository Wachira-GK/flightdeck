
-- FlightDeck user administration (ADR-009, builds on ADR-002 and ADR-008).
-- Everything here is server-only: the tables live in app_private (no browser grants) and the functions live in
-- public so PostgREST can call them as RPC, but only service_role may execute them. The Next.js server passes the
-- actor id taken from the VERIFIED session; every function re-checks in the database that the actor is an active
-- admin, so a bug or a leaked route in the web layer cannot grant anything by itself.
--
-- Rules enforced here (not only in the screens):
--   * exactly one master admin (app_private.platform_owner, a single-row table) set only by SQL, never by a function;
--   * nobody changes the master's roles, status or name, or starts the master's password reset, except the master;
--   * nobody changes their own roles or status (no self-demotion lockout, no self-reactivation);
--   * every learner keeps the learner role; the five roles are the existing app_role values;
--   * suspended accounts cannot act as admins;
--   * every change and every view of a user's data is written to the append-only audit log.
-- Because the actor must be an admin and cannot be the target, at least one admin (the actor) always remains.

create table app_private.platform_owner (
  singleton boolean primary key default true check (singleton),
  user_id   uuid not null references auth.users (id) on delete restrict,
  set_at    timestamptz not null default now()
);

create table app_private.user_status (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  reason     text check (reason is null or char_length(reason) <= 200),
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

-- One-time handoff for admin-started password resets. The PKCE verifier stays on the server (never shown to the
-- admin) and is picked up when the learner opens the emailed link; single use, one hour.
create table app_private.reset_handoff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  verifier   text not null check (verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
create index reset_handoff_user_idx on app_private.reset_handoff (user_id, created_at);

alter table app_private.platform_owner enable row level security;
alter table app_private.user_status   enable row level security;
alter table app_private.reset_handoff enable row level security;
revoke all on app_private.platform_owner, app_private.user_status, app_private.reset_handoff from public, anon, authenticated;
grant all on app_private.platform_owner, app_private.user_status, app_private.reset_handoff to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app_private.is_master(p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from app_private.platform_owner o where o.user_id = p_user);
$$;

create function app_private.admin_actor_ok(p_actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_actor is not null
     and exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'admin')
     and not exists (select 1 from app_private.user_status s where s.user_id = p_actor and s.status = 'suspended');
$$;

-- null = allowed; otherwise the reason. Common to every admin action that targets another user.
create function app_private.admin_target_problem(p_actor uuid, p_target uuid)
returns text language plpgsql stable set search_path = '' as $$
begin
  if not app_private.admin_actor_ok(p_actor) then return 'forbidden'; end if;
  if p_target is null or not exists (select 1 from public.profiles p where p.user_id = p_target) then return 'unknown_user'; end if;
  if app_private.is_master(p_target) and not app_private.is_master(p_actor) then return 'master_protected'; end if;
  return null;
end;
$$;

revoke execute on function app_private.is_master(uuid), app_private.admin_actor_ok(uuid), app_private.admin_target_problem(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.is_master(uuid), app_private.admin_actor_ok(uuid), app_private.admin_target_problem(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------
-- Roles, status and name for a set of users (the web server lists emails from Supabase Auth, then asks for these).
create function public.fd_admin_user_facts(p_actor uuid, p_ids uuid[])
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app_private.admin_actor_ok(p_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.user_id,
      'displayName', p.display_name,
      'createdAt', p.created_at,
      'roles', coalesce((select jsonb_agg(r.role::text order by r.role::text) from public.user_roles r where r.user_id = p.user_id), '[]'::jsonb),
      'status', coalesce((select s.status from app_private.user_status s where s.user_id = p.user_id), 'active'),
      'isMaster', app_private.is_master(p.user_id)))
    from public.profiles p
    where p.user_id = any (coalesce(p_ids, '{}'::uuid[]))), '[]'::jsonb));
end;
$$;

-- One user's facts plus a progress summary. Viewing another person's learner data is itself audited (Kenya DPA map).
create function public.fd_admin_user_detail(p_actor uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_facts   jsonb;
  v_summary jsonb;
begin
  if v_problem = 'master_protected' then v_problem := null; end if; -- admins may READ the master; they cannot change it
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  v_facts := (public.fd_admin_user_facts(p_actor, array[p_target]) -> 'users') -> 0;
  v_summary := jsonb_build_object(
    'enrolments',        (select count(*) from public.enrolments e where e.user_id = p_target),
    'stepsCompleted',    (select count(*) from public.step_progress s where s.user_id = p_target and s.status = 'completed'),
    'assessmentAttempts',(select count(*) from public.assessment_attempts a where a.user_id = p_target),
    'exerciseAttempts',  (select count(*) from public.exercise_attempts x where x.user_id = p_target));
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_view_user', 'user', p_target::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'user', v_facts, 'summary', v_summary);
end;
$$;

-- ---------------------------------------------------------------------------
-- Change
-- ---------------------------------------------------------------------------
create function public.fd_admin_set_roles(p_actor uuid, p_target uuid, p_roles text[], p_reason text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_new     public.app_role[];
  v_before  text[];
  v_after   text[];
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if app_private.is_master(p_target) then return jsonb_build_object('ok', false, 'reason', 'master_protected'); end if;
  if p_target = p_actor then return jsonb_build_object('ok', false, 'reason', 'self_change'); end if;
  if p_roles is null or exists (select 1 from unnest(p_roles) x where x not in ('learner', 'author', 'reviewer', 'admin', 'support')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_role');
  end if;
  v_new := array(select distinct x::public.app_role from unnest(p_roles || array['learner']) x);

  select coalesce(array_agg(r.role::text order by r.role::text), '{}') into v_before from public.user_roles r where r.user_id = p_target;
  delete from public.user_roles r where r.user_id = p_target and r.role <> all (v_new);
  insert into public.user_roles (user_id, role, granted_by)
  select p_target, x, p_actor from unnest(v_new) x
  on conflict (user_id, role) do nothing;
  select coalesce(array_agg(r.role::text order by r.role::text), '{}') into v_after from public.user_roles r where r.user_id = p_target;

  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_set_roles', 'user', p_target::text,
          jsonb_build_object('before', v_before, 'after', v_after, 'reason', left(p_reason, 200)));
  return jsonb_build_object('ok', true, 'roles', to_jsonb(v_after));
end;
$$;

create function public.fd_admin_set_status(p_actor uuid, p_target uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_before  text;
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if app_private.is_master(p_target) then return jsonb_build_object('ok', false, 'reason', 'master_protected'); end if;
  if p_target = p_actor then return jsonb_build_object('ok', false, 'reason', 'self_change'); end if;
  if p_status is null or p_status not in ('active', 'suspended') then return jsonb_build_object('ok', false, 'reason', 'invalid_status'); end if;

  select s.status into v_before from app_private.user_status s where s.user_id = p_target;
  insert into app_private.user_status (user_id, status, reason, changed_by, changed_at)
  values (p_target, p_status, left(p_reason, 200), p_actor, now())
  on conflict (user_id) do update
    set status = excluded.status, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_set_status', 'user', p_target::text,
          jsonb_build_object('before', coalesce(v_before, 'active'), 'after', p_status, 'reason', left(p_reason, 200)));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create function public.fd_admin_set_name(p_actor uuid, p_target uuid, p_name text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_name    text := btrim(coalesce(p_name, ''));
  v_before  text;
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then return jsonb_build_object('ok', false, 'reason', 'invalid_name'); end if;
  select p.display_name into v_before from public.profiles p where p.user_id = p_target;
  update public.profiles set display_name = v_name, updated_at = now() where user_id = p_target;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_set_name', 'user', p_target::text, jsonb_build_object('before', v_before, 'after', v_name));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Password reset by emailed link (the admin never sets or sees a password)
-- ---------------------------------------------------------------------------
create function public.fd_admin_reset_begin(p_actor uuid, p_target uuid, p_verifier text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_rid     uuid;
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if p_target = p_actor then return jsonb_build_object('ok', false, 'reason', 'self_change'); end if; -- use "Forgot password"
  if p_verifier is null or p_verifier !~ '^[A-Za-z0-9_-]{43,128}$' then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  delete from app_private.reset_handoff h where h.expires_at < now();
  if (select count(*) from app_private.reset_handoff h where h.user_id = p_target and h.created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into app_private.reset_handoff (user_id, verifier, created_by) values (p_target, p_verifier, p_actor) returning id into v_rid;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_password_reset_requested', 'user', p_target::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'rid', v_rid);
end;
$$;

-- Called by the server when the learner opens the emailed link. Returns the verifier once, then it is gone.
create function public.fd_reset_handoff_take(p_rid uuid)
returns text language plpgsql set search_path = '' as $$
declare
  v_user     uuid;
  v_verifier text;
begin
  delete from app_private.reset_handoff h
   where h.id = p_rid and h.expires_at > now()
  returning h.user_id, h.verifier into v_user, v_verifier;
  if v_verifier is null then return null; end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_user, 'admin_reset_link_opened', 'user', v_user::text, '{}'::jsonb);
  return v_verifier;
end;
$$;

revoke execute on function
  public.fd_admin_user_facts(uuid, uuid[]), public.fd_admin_user_detail(uuid, uuid),
  public.fd_admin_set_roles(uuid, uuid, text[], text), public.fd_admin_set_status(uuid, uuid, text, text),
  public.fd_admin_set_name(uuid, uuid, text), public.fd_admin_reset_begin(uuid, uuid, text), public.fd_reset_handoff_take(uuid)
  from public, anon, authenticated;
grant execute on function
  public.fd_admin_user_facts(uuid, uuid[]), public.fd_admin_user_detail(uuid, uuid),
  public.fd_admin_set_roles(uuid, uuid, text[], text), public.fd_admin_set_status(uuid, uuid, text, text),
  public.fd_admin_set_name(uuid, uuid, text), public.fd_admin_reset_begin(uuid, uuid, text), public.fd_reset_handoff_take(uuid)
  to service_role;
