-- FlightDeck server-only state transitions (FD-D01 / FD-S01)
-- SECURITY INVOKER: callable only by service_role from server code (never shipped to the browser).
-- Each transition validates the actor, then writes an append-only audit record.

-- Publish: actor must be an assigned reviewer and must not be the version's author.
create function app_private.publish_course_version(p_version uuid, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.course_versions%rowtype;
begin
  select * into v from public.course_versions where id = p_version for update;
  if not found then
    raise exception 'course version not found' using errcode = 'P0002';
  end if;
  if v.status not in ('in_review', 'approved') then
    raise exception 'version is not ready to publish (status %)', v.status using errcode = '42501';
  end if;
  if p_actor = v.created_by then
    raise exception 'author cannot publish own version' using errcode = '42501';
  end if;
  if not exists (select 1 from app_private.review_assignments ra
                  where ra.course_version_id = p_version and ra.reviewer_id = p_actor) then
    raise exception 'actor is not an assigned reviewer' using errcode = '42501';
  end if;

  update public.course_versions
     set status = 'retired'
   where course_id = v.course_id and status = 'published';

  update public.course_versions
     set status = 'published', published_at = now(), published_by = p_actor
   where id = p_version;

  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'publish', 'course_version', p_version::text,
          jsonb_build_object('course_id', v.course_id, 'version', v.version));
end;
$$;

-- Simulator verdict: recorded only after deterministic server-side validation.
create function app_private.record_exercise_verdict(
  p_attempt uuid, p_passed boolean, p_score numeric, p_validator_version text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.exercise_attempts
     set status = case when p_passed then 'validated' else 'rejected' end::public.exercise_attempt_status,
         passed = p_passed,
         score = p_score,
         validator_version = p_validator_version,
         validated_at = now()
   where id = p_attempt and status = 'submitted';
  if not found then
    raise exception 'attempt not found or already validated' using errcode = '42501';
  end if;

  insert into app_private.audit_log (action, entity, entity_id, detail)
  values ('exercise_verdict', 'exercise_attempt', p_attempt::text,
          jsonb_build_object('passed', p_passed, 'score', p_score, 'validator', p_validator_version));
end;
$$;

revoke execute on function app_private.publish_course_version(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.record_exercise_verdict(uuid, boolean, numeric, text) from public, anon, authenticated;
grant execute on function app_private.publish_course_version(uuid, uuid) to service_role;
grant execute on function app_private.record_exercise_verdict(uuid, boolean, numeric, text) to service_role;
