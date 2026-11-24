-- Learning evidence, stage 2 of activity tracking (ADR-012): active time per mission, and a review list of passes
-- that look too fast. Evidence for certificate integrity: it makes forging harder, it does not make it impossible.
-- Flags are SOFT: they only appear on an admin review list. Nothing here blocks a learner or changes a grade.
-- Server-only like the rest of app_private; the web server sends heartbeats only for the VERIFIED session user.

create table app_private.mission_time (
  user_id      uuid not null references auth.users (id) on delete cascade,
  mission_slug text not null check (char_length(mission_slug) between 1 and 120),
  day          date not null,
  seconds      integer not null default 0 check (seconds between 0 and 14400),
  last_beat    timestamptz not null default now(),
  primary key (user_id, mission_slug, day)
);
create index mission_time_user on app_private.mission_time (user_id, mission_slug);

alter table app_private.mission_time enable row level security;
revoke all on app_private.mission_time from public, anon, authenticated;
grant all on app_private.mission_time to service_role;

-- A heartbeat says "this learner was active on this mission for about p_seconds". Time can only be added as fast as the clock
-- runs: seconds credited never exceed the real time since the previous heartbeat (+2s slack), each call adds at most 30s,
-- and a mission counts at most 4 hours a day. So a script that spams heartbeats earns nothing extra.
create function public.fd_activity_heartbeat(p_user uuid, p_slug text, p_seconds integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_day  date := app_private.nairobi_day();
  v_ask  integer := least(greatest(coalesce(p_seconds, 0), 0), 30);
  v_prev timestamptz;
  v_add  integer;
begin
  if p_user is null or p_slug is null or char_length(p_slug) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if not exists (select 1 from public.missions m where m.slug = p_slug) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_mission');
  end if;
  select t.last_beat into v_prev from app_private.mission_time t where t.user_id = p_user and t.mission_slug = p_slug and t.day = v_day;
  if v_prev is null then
    v_add := least(v_ask, 5); -- first beat of the day: credit a little, then the clock rule takes over
  else
    v_add := least(v_ask, greatest(0, floor(extract(epoch from (now() - v_prev)) + 2)::integer));
  end if;
  insert into app_private.mission_time (user_id, mission_slug, day, seconds, last_beat)
  values (p_user, p_slug, v_day, v_add, now())
  on conflict (user_id, mission_slug, day) do update
    set seconds = least(14400, app_private.mission_time.seconds + v_add),
        last_beat = now();
  return jsonb_build_object('ok', true, 'added', v_add);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'reason', 'unknown_user');
end;
$$;

-- Passes that look too fast: a graded PASS where the learner's recorded active time on that mission, up to the day of the
-- pass, is under p_min_seconds (default 180). 'no_time' = nothing recorded at all (could also mean the pass happened before
-- tracking began or in a browser that blocks the heartbeat), 'fast' = some time but under the limit.
create function public.fd_admin_review_flags(p_actor uuid, p_days integer, p_min_seconds integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_min  integer := least(greatest(coalesce(p_min_seconds, 180), 30), 3600);
  v_started date;
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select min(day) into v_started from app_private.mission_time;
  return jsonb_build_object(
    'ok', true,
    'trackingSince', v_started,
    'minSeconds', v_min,
    'flags', coalesce((
      select jsonb_agg(f order by f."gradedAt" desc)
        from (
          select x.user_id as "userId", x.slug, x.score, x.graded_at as "gradedAt", x.seconds,
                 case when x.seconds = 0 then 'no_time' else 'fast' end as reason
            from (
              select a.user_id, regexp_replace(s.slug, '-assessment$', '') as slug, a.score, a.graded_at,
                     coalesce((select sum(t.seconds) from app_private.mission_time t
                                where t.user_id = a.user_id and t.mission_slug = regexp_replace(s.slug, '-assessment$', '')
                                  and t.day <= app_private.nairobi_day(a.graded_at)), 0)::integer as seconds
                from public.assessment_attempts a
                join public.assessments s on s.id = a.assessment_id
               where a.status = 'graded' and a.passed and a.graded_at >= now() - make_interval(days => v_days)
            ) x
           where x.seconds < v_min
           order by x.graded_at desc limit 100) f), '[]'::jsonb));
end;
$$;

-- Minutes per mission for one learner (admin user page).
create function public.fd_admin_user_mission_time(p_actor uuid, p_target uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_problem text := app_private.admin_target_problem(p_actor, p_target);
begin
  if v_problem = 'master_protected' then v_problem := null; end if;
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  return jsonb_build_object('ok', true, 'missions', coalesce((
    select jsonb_agg(jsonb_build_object('slug', r.slug, 'seconds', r.seconds, 'days', r.days, 'lastDay', r.last_day) order by r.last_day desc)
      from (select t.mission_slug as slug, sum(t.seconds)::integer as seconds, count(*)::integer as days, max(t.day) as last_day
              from app_private.mission_time t where t.user_id = p_target group by t.mission_slug order by max(t.day) desc limit 60) r), '[]'::jsonb));
end;
$$;

revoke execute on function public.fd_activity_heartbeat(uuid, text, integer), public.fd_admin_review_flags(uuid, integer, integer),
  public.fd_admin_user_mission_time(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fd_activity_heartbeat(uuid, text, integer), public.fd_admin_review_flags(uuid, integer, integer),
  public.fd_admin_user_mission_time(uuid, uuid) to service_role;
