-- FlightDeck activity tracking, stage 1 (ADR-012): a sign-in log and a daily rollup per user.
-- Purpose: let admins see how often each learner comes back (trend + per-user), and keep a small, honest record that
-- supports the integrity of certificates later. It records WHO and WHEN, never page contents, answers, IP addresses
-- or device details. Days are Africa/Nairobi days. Server-only: tables in app_private, functions callable by service_role.
-- Retention: events older than 13 months are removed by fd_activity_purge (a function; scheduling is a separate step).

create table app_private.sign_in_event (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now(),
  method  text not null check (method in ('password', 'google', 'signup'))
);
create index sign_in_event_user_at on app_private.sign_in_event (user_id, at desc);

create table app_private.activity_day (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  sign_ins   integer not null default 0 check (sign_ins >= 0),
  visits     integer not null default 0 check (visits >= 0),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, day)
);
create index activity_day_day on app_private.activity_day (day);

alter table app_private.sign_in_event enable row level security;
alter table app_private.activity_day enable row level security;
revoke all on app_private.sign_in_event, app_private.activity_day from public, anon, authenticated;
grant all on app_private.sign_in_event, app_private.activity_day to service_role;

-- A day in Nairobi, so "today" matches how Godfrey and the learners experience it.
create function app_private.nairobi_day(p_at timestamptz default now())
returns date language sql stable set search_path = '' as $$ select (p_at at time zone 'Africa/Nairobi')::date $$;
revoke execute on function app_private.nairobi_day(timestamptz) from public, anon, authenticated;
grant execute on function app_private.nairobi_day(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Recording (called by the web server AFTER it verified the person)
-- ---------------------------------------------------------------------------
create function public.fd_activity_sign_in(p_user uuid, p_method text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_user is null or p_method not in ('password', 'google', 'signup') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  insert into app_private.sign_in_event (user_id, method) values (p_user, p_method);
  insert into app_private.activity_day (user_id, day, sign_ins, visits)
  values (p_user, app_private.nairobi_day(), 1, 0)
  on conflict (user_id, day) do update set sign_ins = app_private.activity_day.sign_ins + 1, last_seen = now();
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'reason', 'unknown_user');
end;
$$;

-- A page view by a signed-in person. A "visit" = first view after 30 quiet minutes; writes at most once a minute.
create function public.fd_activity_touch(p_user uuid)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  insert into app_private.activity_day (user_id, day, sign_ins, visits)
  values (p_user, app_private.nairobi_day(), 0, 1)
  on conflict (user_id, day) do update
    set visits    = app_private.activity_day.visits + case when app_private.activity_day.last_seen < now() - interval '30 minutes' then 1 else 0 end,
        last_seen = now()
    where app_private.activity_day.last_seen < now() - interval '1 minute';
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'reason', 'unknown_user');
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin views
-- ---------------------------------------------------------------------------
-- Platform trend: one row per day for the last p_days (7..90), plus the busiest users. Learners' emails are added by the web server.
create function public.fd_admin_activity_overview(p_actor uuid, p_days integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_today date := app_private.nairobi_day();
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object(
    'ok', true,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'activeUsers', coalesce(a.active, 0), 'signIns', coalesce(a.sign_ins, 0), 'visits', coalesce(a.visits, 0)) order by d.day)
        from generate_series(0, v_days - 1) as g(n)
        cross join lateral (select v_today - g.n as day) d
        left join (select day, count(*) as active, sum(sign_ins) as sign_ins, sum(visits) as visits
                     from app_private.activity_day where day >= v_today - (v_days - 1) group by day) a on a.day = d.day), '[]'::jsonb),
    'activeUsers', (select count(distinct user_id) from app_private.activity_day where day >= v_today - (v_days - 1)),
    'signIns', coalesce((select sum(sign_ins) from app_private.activity_day where day >= v_today - (v_days - 1)), 0),
    'totalUsers', (select count(*) from public.profiles),
    'topUsers', coalesce((
      select jsonb_agg(t order by t."daysActive" desc, t."lastSeen" desc)
        from (select a.user_id as "userId", count(*) as "daysActive", sum(a.sign_ins) as "signIns", sum(a.visits) as visits, max(a.last_seen) as "lastSeen"
                from app_private.activity_day a where a.day >= v_today - (v_days - 1)
               group by a.user_id order by count(*) desc, max(a.last_seen) desc limit 25) t), '[]'::jsonb));
end;
$$;

create function public.fd_admin_user_activity(p_actor uuid, p_target uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_today   date := app_private.nairobi_day();
begin
  if v_problem = 'master_protected' then v_problem := null; end if; -- reading is allowed, as on the detail page
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  return jsonb_build_object(
    'ok', true,
    'signIns7', (select count(*) from app_private.sign_in_event e where e.user_id = p_target and e.at >= now() - interval '7 days'),
    'signIns30', (select count(*) from app_private.sign_in_event e where e.user_id = p_target and e.at >= now() - interval '30 days'),
    'daysActive30', (select count(*) from app_private.activity_day a where a.user_id = p_target and a.day >= v_today - 29),
    'firstSeen', (select min(a.first_seen) from app_private.activity_day a where a.user_id = p_target),
    'lastSeen', (select max(a.last_seen) from app_private.activity_day a where a.user_id = p_target),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', r.at, 'method', r.method) order by r.at desc)
                          from (select e.at, e.method from app_private.sign_in_event e where e.user_id = p_target order by e.at desc limit 10) r), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', a.day, 'visits', a.visits, 'signIns', a.sign_ins) order by a.day)
                         from app_private.activity_day a where a.user_id = p_target and a.day >= v_today - 29), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: removes activity older than 13 months (default). Run it on a schedule (see ADR-012).
-- ---------------------------------------------------------------------------
create function public.fd_activity_purge(p_keep_months integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_months integer := greatest(coalesce(p_keep_months, 13), 3);
  v_events integer;
  v_days   integer;
begin
  delete from app_private.sign_in_event where at < now() - make_interval(months => v_months);
  get diagnostics v_events = row_count;
  delete from app_private.activity_day where day < app_private.nairobi_day(now() - make_interval(months => v_months));
  get diagnostics v_days = row_count;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'activity_purge', 'system', null, jsonb_build_object('keepMonths', v_months, 'events', v_events, 'days', v_days));
  return jsonb_build_object('ok', true, 'events', v_events, 'days', v_days);
end;
$$;

revoke execute on function
  public.fd_activity_sign_in(uuid, text), public.fd_activity_touch(uuid), public.fd_admin_activity_overview(uuid, integer),
  public.fd_admin_user_activity(uuid, uuid), public.fd_activity_purge(integer)
  from public, anon, authenticated;
grant execute on function
  public.fd_activity_sign_in(uuid, text), public.fd_activity_touch(uuid), public.fd_admin_activity_overview(uuid, integer),
  public.fd_admin_user_activity(uuid, uuid), public.fd_activity_purge(integer)
  to service_role;
