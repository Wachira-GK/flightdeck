-- FlightDeck progress recording (FD-AST01 persistence slice, ADR-008).
-- Server-only: these functions live in `public` so PostgREST can call them as RPC, but only service_role may
-- execute them (revoked from public, anon, authenticated). The Next.js server calls them AFTER it has verified the
-- signed-in user and graded the answers itself. The browser can never call them, so a learner cannot mark
-- their own work as passed. Each call writes an append-only audit record.

-- Records one graded mission assessment for a learner. Enrols the learner on first use, numbers the attempt
-- (the existing trigger enforces max_attempts) and, when passed, completes the mission's assessment step.
create function public.fd_record_assessment(p_user uuid, p_mission_slug text, p_score numeric, p_passed boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m        record;
  v_enrol  uuid;
  v_att    public.assessment_attempts%rowtype;
  v_step   uuid;
begin
  if p_user is null or p_score is null or p_score < 0 or p_score > 100 or p_passed is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  select ms.id as mission_id, cv.id as version_id, cv.course_id, a.id as assessment_id
    into m
    from public.missions ms
    join public.course_versions cv on cv.id = ms.course_version_id and cv.status = 'published'
    join public.assessments a on a.course_version_id = cv.id and a.slug = ms.slug || '-assessment'
   where ms.slug = p_mission_slug
   order by cv.version desc
   limit 1;
  if not found then
    return jsonb_build_object('saved', false, 'reason', 'unknown_mission');
  end if;

  insert into public.enrolments (user_id, course_id, course_version_id)
  values (p_user, m.course_id, m.version_id)
  on conflict (user_id, course_id) do nothing;
  select e.id into v_enrol from public.enrolments e where e.user_id = p_user and e.course_id = m.course_id;

  begin
    insert into public.assessment_attempts (user_id, assessment_id, status, submitted_at, graded_at, score, passed)
    values (p_user, m.assessment_id, 'graded', now(), now(), p_score, p_passed)
    returning * into v_att;
  exception when insufficient_privilege then
    -- the numbering trigger raises 42501 when max_attempts is used up
    return jsonb_build_object('saved', false, 'reason', 'attempt_limit');
  end;

  if p_passed then
    select s.id into v_step from public.mission_steps s
     where s.mission_id = m.mission_id and s.assessment_id = m.assessment_id
     limit 1;
    if v_step is not null then
      insert into public.step_progress (user_id, mission_step_id, enrolment_id, status, completed_at)
      values (p_user, v_step, v_enrol, 'completed', now())
      on conflict (user_id, mission_step_id)
        do update set status = 'completed',
                      completed_at = coalesce(public.step_progress.completed_at, excluded.completed_at);
    end if;
  end if;

  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_user, 'assessment_graded', 'assessment_attempt', v_att.id::text,
          jsonb_build_object('mission', p_mission_slug, 'attempt_no', v_att.attempt_no, 'score', p_score, 'passed', p_passed));

  return jsonb_build_object('saved', true, 'attemptNo', v_att.attempt_no, 'passed', p_passed);
exception when foreign_key_violation then
  -- the user id does not exist in auth.users: nothing is kept (this block rolls back)
  return jsonb_build_object('saved', false, 'reason', 'unknown_user');
end;
$$;

-- Records one server-validated simulator check. Stores the submission and the server's verdict, and completes
-- the mission's simulation step when it passed. A learner keeps at most 200 stored checks per exercise.
create function public.fd_record_exercise(
  p_user uuid, p_exercise_slug text, p_submission jsonb, p_passed boolean, p_score numeric, p_validator text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  x        record;
  v_enrol  uuid;
  v_att    uuid;
  v_step   uuid;
begin
  if p_user is null or p_submission is null or p_score is null or p_score < 0 or p_score > 100 or p_passed is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  select ex.id as exercise_id, cv.id as version_id, cv.course_id
    into x
    from public.exercises ex
    join public.course_versions cv on cv.id = ex.course_version_id and cv.status = 'published'
   where ex.slug = p_exercise_slug
   order by cv.version desc
   limit 1;
  if not found then
    return jsonb_build_object('saved', false, 'reason', 'unknown_exercise');
  end if;

  if (select count(*) from public.exercise_attempts t where t.user_id = p_user and t.exercise_id = x.exercise_id) >= 200 then
    return jsonb_build_object('saved', false, 'reason', 'attempt_cap');
  end if;

  insert into public.enrolments (user_id, course_id, course_version_id)
  values (p_user, x.course_id, x.version_id)
  on conflict (user_id, course_id) do nothing;
  select e.id into v_enrol from public.enrolments e where e.user_id = p_user and e.course_id = x.course_id;

  insert into public.exercise_attempts (user_id, exercise_id, submission, status, passed, score, validator_version, validated_at)
  values (p_user, x.exercise_id, p_submission,
          case when p_passed then 'validated' else 'rejected' end::public.exercise_attempt_status,
          p_passed, p_score, p_validator, now())
  returning id into v_att;

  if p_passed then
    select s.id into v_step from public.mission_steps s where s.exercise_id = x.exercise_id limit 1;
    if v_step is not null then
      insert into public.step_progress (user_id, mission_step_id, enrolment_id, status, completed_at)
      values (p_user, v_step, v_enrol, 'completed', now())
      on conflict (user_id, mission_step_id)
        do update set status = 'completed',
                      completed_at = coalesce(public.step_progress.completed_at, excluded.completed_at);
    end if;
  end if;

  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_user, 'exercise_verdict', 'exercise_attempt', v_att::text,
          jsonb_build_object('exercise', p_exercise_slug, 'passed', p_passed, 'score', p_score, 'validator', p_validator));

  return jsonb_build_object('saved', true, 'passed', p_passed);
exception when foreign_key_violation then
  return jsonb_build_object('saved', false, 'reason', 'unknown_user');
end;
$$;

revoke execute on function public.fd_record_assessment(uuid, text, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.fd_record_exercise(uuid, text, jsonb, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.fd_record_assessment(uuid, text, numeric, boolean) to service_role;
grant execute on function public.fd_record_exercise(uuid, text, jsonb, boolean, numeric, text) to service_role;
