-- FlightDeck content workspace, stage 2a-ii (ADR-015): publishing a revision makes the mission live.
-- The learner-facing content is read from the published revision (stage 2b). Progress saving, mission access and the
-- cockpit still hang off the catalogue rows (missions, mission_steps, assessments, exercises), so publishing also keeps
-- those rows in step, in the SAME transaction as the status change. Existing rows are updated in place (same ids), so
-- every learner's saved progress stays attached. Retiring a mission switches it off in mission access (rows stay).

create function app_private.content_sync_live(p_slug text)
returns void language plpgsql set search_path = '' as $$
declare
  v_item   app_private.content_items;
  v_cv     uuid;
  v_mid    uuid;
  v_aid    uuid;
  v_eid    uuid;
  v_eid_step uuid;
  v_ex_slug text;
  v_pos    integer;
  v_step   jsonb;
  v_i      integer := 0;
  v_kind   public.step_kind;
  v_summary text;
begin
  select * into v_item from app_private.content_items i where i.slug = p_slug and i.status = 'published';
  if not found then return; end if;

  select cv.id into v_cv
    from public.course_versions cv
    join public.courses c on c.id = cv.course_id
    join public.tracks t on t.id = c.track_id
   where t.slug = case v_item.track when 'math' then 'mathlab' else 'excel-masterclass' end and cv.status = 'published';
  if v_cv is null then raise exception 'no published course version for track %', v_item.track; end if;

  v_summary := left(v_item.mission->>'summary', 2000);
  select m.id into v_mid from public.missions m where m.course_version_id = v_cv and m.slug = p_slug;
  if v_mid is null then
    select coalesce(max(m.position), 0) + 1 into v_pos from public.missions m where m.course_version_id = v_cv;
    insert into public.missions (course_version_id, position, slug, title, summary)
    values (v_cv, v_pos, p_slug, v_item.title, v_summary) returning id into v_mid;
  else
    update public.missions set title = v_item.title, summary = v_summary where id = v_mid;
  end if;

  -- Assessment: one per mission, slug <mission>-assessment (this is what fd_record_assessment looks up).
  insert into public.assessments (course_version_id, slug, title, pass_mark, max_attempts)
  values (v_cv, p_slug || '-assessment', left(v_item.code || ' assessment: ' || v_item.title, 160),
          round(coalesce((v_item.mission->>'passMark')::numeric, 0.75) * 100, 2), 3)
  on conflict (course_version_id, slug) do update
    set title = excluded.title, pass_mark = excluded.pass_mark
  returning id into v_aid;

  -- Exercise (Excel only here: the author editor builds Excel missions; math exercises come from the import).
  v_ex_slug := v_item.exercise->>'id';
  if v_item.track = 'excel' and v_ex_slug is not null and v_item.exercise is not null then
    insert into public.exercises (course_version_id, kind, slug, title, definition)
    values (v_cv, 'excel', v_ex_slug, left(coalesce(v_item.exercise->>'title', v_item.title), 160), v_item.exercise)
    on conflict (course_version_id, slug) do update set title = excluded.title, definition = excluded.definition
    returning id into v_eid;
  elsif v_ex_slug is not null then
    select e.id into v_eid from public.exercises e where e.course_version_id = v_cv and e.slug = v_ex_slug;
  end if;

  -- Steps: briefing, training, simulation, assessment, debrief (existing rows keep their id and body).
  for v_step in select * from jsonb_array_elements(coalesce(v_item.mission->'steps', '[]'::jsonb)) loop
    v_i := v_i + 1;
    begin
      v_kind := (v_step->>'id')::public.step_kind;
    exception when invalid_text_representation then
      continue;
    end;
    -- A republish without an exercise document keeps the exercise the step already points at.
    if v_kind = 'simulation' and v_eid is null then
      select s.exercise_id into v_eid_step from public.mission_steps s where s.mission_id = v_mid and s.position = v_i;
      if v_eid_step is null then raise exception 'the simulation step of % needs an exercise', p_slug; end if;
    else
      v_eid_step := v_eid;
    end if;
    insert into public.mission_steps (mission_id, position, kind, title, body, exercise_id, assessment_id)
    values (v_mid, v_i, v_kind, left(coalesce(v_step->>'title', initcap(v_step->>'id')), 160),
            jsonb_build_object('stepId', v_step->>'id'),
            case when v_kind = 'simulation' then v_eid_step end,
            case when v_kind = 'assessment' then v_aid end)
    on conflict (mission_id, position) do update
      set title = excluded.title,
          exercise_id = coalesce(excluded.exercise_id, public.mission_steps.exercise_id),
          assessment_id = coalesce(excluded.assessment_id, public.mission_steps.assessment_id);
  end loop;

  -- A freshly published mission is available (staff always see it; learners need Free or an unlock, ADR-011).
  insert into app_private.mission_access (mission_slug, is_free, is_enabled) values (p_slug, false, true)
  on conflict (mission_slug) do update set is_enabled = true;

  update app_private.content_items set live_synced = true where id = v_item.id;
end;
$$;

create function app_private.content_unlive(p_slug text)
returns void language plpgsql set search_path = '' as $$
begin
  update app_private.mission_access set is_enabled = false, updated_at = now() where mission_slug = p_slug;
end;
$$;

revoke execute on function app_private.content_sync_live(text), app_private.content_unlive(text) from public, anon, authenticated;
grant execute on function app_private.content_sync_live(text), app_private.content_unlive(text) to service_role;

-- Publishing now syncs the live rows in the same transaction.
create or replace function public.fd_content_review(p_actor uuid, p_slug text, p_revision integer, p_decision text, p_note text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  if not (app_private.content_has_role(p_actor, 'reviewer') or app_private.content_has_role(p_actor, 'admin')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('publish', 'return') or (p_decision = 'return' and coalesce(btrim(p_note), '') = '') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.status <> 'in_review' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  if v_row.author_id is not distinct from p_actor then return jsonb_build_object('ok', false, 'reason', 'own_work'); end if;

  if p_decision = 'return' then
    update app_private.content_items set status = 'draft', review_note = btrim(p_note), reviewer_id = p_actor, updated_at = now() where id = v_row.id;
  else
    update app_private.content_items set status = 'retired', live_synced = false, updated_at = now() where slug = p_slug and status = 'published';
    update app_private.content_items
       set status = 'published', reviewer_id = p_actor, review_note = nullif(btrim(coalesce(p_note, '')), ''),
           published_at = now(), live_synced = false, updated_at = now()
     where id = v_row.id;
    perform app_private.content_sync_live(p_slug);
  end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, case when p_decision = 'publish' then 'content_publish' else 'content_return' end, 'content', p_slug,
          jsonb_build_object('revision', p_revision, 'author', v_row.author_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fd_content_retire(p_actor uuid, p_slug text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update app_private.content_items set status = 'retired', live_synced = false, updated_at = now() where slug = p_slug and status = 'published';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'not_published'); end if;
  perform app_private.content_unlive(p_slug);
  insert into app_private.audit_log (actor_id, action, entity, entity_id) values (p_actor, 'content_retire', 'content', p_slug);
  return jsonb_build_object('ok', true);
end;
$$;
