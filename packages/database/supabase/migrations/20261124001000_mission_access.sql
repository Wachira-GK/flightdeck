-- FlightDeck mission access control (ADR-011, builds on ADR-009).
-- Three rules decide whether a learner can open a mission, grade it and have it saved:
--   1. availability: an admin can switch a mission off for everyone (staff still see it, to fix it);
--   2. free: a mission marked free is open to everyone (the free tier; the admin chooses which, today 5);
--   3. unlock: any other mission opens only for learners an admin has unlocked it for.
-- Staff (admin, author, reviewer) can open every enabled mission and, for admins, disabled ones too.
-- Until payments exist, "unlock" is how an admin gives access by hand; a paid purchase will later add the same
-- kind of unlock (or an entitlement) without changing this check.
-- Server-only: tables live in app_private; the functions live in public for PostgREST but only service_role runs them.

create table app_private.mission_access (
  mission_slug text primary key check (mission_slug ~ '^[a-z0-9-]{2,64}$'),
  is_free      boolean not null default false,
  is_enabled   boolean not null default true,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create table app_private.mission_unlock (
  user_id      uuid not null references auth.users (id) on delete cascade,
  mission_slug text not null check (mission_slug ~ '^[a-z0-9-]{2,64}$'),
  granted_by   uuid references auth.users (id) on delete set null,
  granted_at   timestamptz not null default now(),
  primary key (user_id, mission_slug)
);

alter table app_private.mission_access enable row level security;
alter table app_private.mission_unlock enable row level security;
revoke all on app_private.mission_access, app_private.mission_unlock from public, anon, authenticated;
grant all on app_private.mission_access, app_private.mission_unlock to service_role;

-- ---------------------------------------------------------------------------
-- The check used by the mission page and by the grading routes
-- ---------------------------------------------------------------------------
-- 'open' | 'locked' | 'disabled' | 'unknown'. p_user null = signed out (only free, enabled missions are open).
create function public.fd_mission_access(p_user uuid, p_slug text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_enabled boolean := true;
  v_free    boolean := false;
begin
  if p_slug is null or not exists (select 1 from public.missions m where m.slug = p_slug) then return 'unknown'; end if;
  select a.is_enabled, a.is_free into v_enabled, v_free from app_private.mission_access a where a.mission_slug = p_slug;
  v_enabled := coalesce(v_enabled, true);
  v_free := coalesce(v_free, false);
  if p_user is not null and exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'admin')
     and not exists (select 1 from app_private.user_status s where s.user_id = p_user and s.status = 'suspended') then
    return 'open';
  end if;
  if not v_enabled then return 'disabled'; end if;
  if p_user is not null and exists (select 1 from public.user_roles r where r.user_id = p_user and r.role in ('author', 'reviewer'))
     and not exists (select 1 from app_private.user_status s where s.user_id = p_user and s.status = 'suspended') then
    return 'open';
  end if;
  if v_free then return 'open'; end if;
  if p_user is not null and exists (select 1 from app_private.mission_unlock u where u.user_id = p_user and u.mission_slug = p_slug) then
    return 'open';
  end if;
  return 'locked';
end;
$$;

-- What a learner's cockpit needs: which missions are free, switched off, or unlocked for them (staff see everything open).
create function public.fd_access_summary(p_user uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_staff boolean := p_user is not null
    and exists (select 1 from public.user_roles r where r.user_id = p_user and r.role in ('admin', 'author', 'reviewer'));
begin
  return jsonb_build_object(
    'staff', v_staff,
    'free', coalesce((select jsonb_agg(a.mission_slug order by a.mission_slug) from app_private.mission_access a where a.is_free), '[]'::jsonb),
    'disabled', coalesce((select jsonb_agg(a.mission_slug order by a.mission_slug) from app_private.mission_access a where not a.is_enabled), '[]'::jsonb),
    'unlocked', coalesce((select jsonb_agg(u.mission_slug order by u.mission_slug) from app_private.mission_unlock u where u.user_id = p_user), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create function public.fd_admin_mission_list(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'missions', coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', m.slug, 'title', m.title, 'position', m.position, 'course', c.slug,
             'isFree', coalesce(a.is_free, false), 'isEnabled', coalesce(a.is_enabled, true),
             'unlocks', (select count(*) from app_private.mission_unlock u where u.mission_slug = m.slug))
           order by c.slug, m.position)
      from public.missions m
      join public.course_versions cv on cv.id = m.course_version_id and cv.status = 'published'
      join public.courses c on c.id = cv.course_id
      left join app_private.mission_access a on a.mission_slug = m.slug), '[]'::jsonb));
end;
$$;

create function public.fd_admin_set_mission(p_actor uuid, p_slug text, p_free boolean, p_enabled boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_before jsonb;
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_free is null or p_enabled is null or p_slug is null or not exists (select 1 from public.missions m where m.slug = p_slug) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select to_jsonb(a) - 'updated_by' - 'updated_at' into v_before from app_private.mission_access a where a.mission_slug = p_slug;
  insert into app_private.mission_access (mission_slug, is_free, is_enabled, updated_by, updated_at)
  values (p_slug, p_free, p_enabled, p_actor, now())
  on conflict (mission_slug) do update
    set is_free = excluded.is_free, is_enabled = excluded.is_enabled, updated_by = excluded.updated_by, updated_at = now();
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_set_mission_access', 'mission', p_slug,
          jsonb_build_object('before', v_before, 'after', jsonb_build_object('is_free', p_free, 'is_enabled', p_enabled)));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.fd_admin_user_unlocks(p_actor uuid, p_target uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  return jsonb_build_object('ok', true, 'slugs', coalesce((select jsonb_agg(u.mission_slug order by u.mission_slug) from app_private.mission_unlock u where u.user_id = p_target), '[]'::jsonb));
end;
$$;

-- Grants (p_grant = true) or removes (false) unlocks for one learner. At most 60 missions per call.
create function public.fd_admin_set_unlocks(p_actor uuid, p_target uuid, p_slugs text[], p_grant boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_slugs   text[];
  v_changed integer;
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if p_grant is null or p_slugs is null or cardinality(p_slugs) = 0 or cardinality(p_slugs) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select array_agg(distinct s) into v_slugs from unnest(p_slugs) s;
  if (select count(*) from public.missions m where m.slug = any (v_slugs) and m.course_version_id in (select id from public.course_versions where status = 'published'))
       <> cardinality(v_slugs) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_grant then
    insert into app_private.mission_unlock (user_id, mission_slug, granted_by)
    select p_target, s, p_actor from unnest(v_slugs) s
    on conflict do nothing;
  else
    delete from app_private.mission_unlock u where u.user_id = p_target and u.mission_slug = any (v_slugs);
  end if;
  get diagnostics v_changed = row_count;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, case when p_grant then 'admin_unlock_missions' else 'admin_lock_missions' end, 'user', p_target::text,
          jsonb_build_object('missions', to_jsonb(v_slugs), 'changed', v_changed));
  return jsonb_build_object('ok', true, 'changed', v_changed);
end;
$$;

revoke execute on function
  public.fd_mission_access(uuid, text), public.fd_access_summary(uuid), public.fd_admin_mission_list(uuid),
  public.fd_admin_set_mission(uuid, text, boolean, boolean), public.fd_admin_user_unlocks(uuid, uuid),
  public.fd_admin_set_unlocks(uuid, uuid, text[], boolean)
  from public, anon, authenticated;
grant execute on function
  public.fd_mission_access(uuid, text), public.fd_access_summary(uuid), public.fd_admin_mission_list(uuid),
  public.fd_admin_set_mission(uuid, text, boolean, boolean), public.fd_admin_user_unlocks(uuid, uuid),
  public.fd_admin_set_unlocks(uuid, uuid, text[], boolean)
  to service_role;

-- The free tier today: the first five Excel missions. An admin changes this in the dashboard.
insert into app_private.mission_access (mission_slug, is_free)
select m.slug, true
  from public.missions m
  join public.course_versions cv on cv.id = m.course_version_id and cv.status = 'published'
  join public.courses c on c.id = cv.course_id and c.slug = 'excel-foundations'
 where m.position <= 5
on conflict (mission_slug) do nothing;
