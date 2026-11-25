-- FlightDeck explicit enrolment. A signed-in person is a "guest" until they enrol in a course; the first enrolment makes
-- them a learner for good (there is no way to leave in v1; the Cockpit derives the badge from the enrolment rows).
-- Server-only (service_role): the web server calls it after it has verified the session; the actor id is never taken from
-- the browser. Idempotent: enrolling again changes nothing. Suspended accounts are refused. Audited once, on the first time.
create or replace function public.fd_enrol(p_user uuid, p_course_slug text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_course  uuid;
  v_title   text;
  v_version uuid;
  v_n       integer;
begin
  if p_user is null or p_course_slug is null or p_course_slug !~ '^[a-z0-9-]{2,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if exists (select 1 from app_private.user_status s where s.user_id = p_user and s.status = 'suspended') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select c.id, c.title, cv.id into v_course, v_title, v_version
    from public.courses c
    join public.course_versions cv on cv.course_id = c.id and cv.status = 'published'
   where c.slug = p_course_slug and c.status = 'published'
   order by cv.version desc
   limit 1;
  if v_course is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  begin
    insert into public.enrolments (user_id, course_id, course_version_id)
    values (p_user, v_course, v_version)
    on conflict (user_id, course_id) do nothing;
    get diagnostics v_n = row_count;
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); -- no such user
  end;
  if v_n > 0 then
    insert into app_private.audit_log (actor_id, action, entity, entity_id)
    values (p_user, 'enrol', 'course', p_course_slug);
  end if;
  return jsonb_build_object('ok', true, 'already', v_n = 0, 'course', v_title);
end;
$$;

revoke execute on function public.fd_enrol(uuid, text) from public, anon, authenticated;
grant execute on function public.fd_enrol(uuid, text) to service_role;
