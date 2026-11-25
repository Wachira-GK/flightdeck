-- FlightDeck content workspace: role separation (follow-up to ADR-015). Being an admin no longer implies being an author or a
-- reviewer. Authoring (save, submit, withdraw, the /author screens) needs the `author` role; reviewing (publish, return, the
-- /review screens) needs the `reviewer` role. Admins keep user/exam administration, and retiring a mission stays admin-only
-- (it is reached through the review desk, so retiring needs both roles). "Nobody reviews their own work" is unchanged.
-- Same signatures; create or replace keeps the grants.

-- The single "role" no longer includes admin, so an admin with no content role gets no workspace at all.
create or replace function app_private.content_role(p_actor uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p_actor is null or exists (select 1 from app_private.user_status s where s.user_id = p_actor and s.status = 'suspended') then null
    when exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'reviewer') then 'reviewer'
    when exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'author') then 'author'
    else null
  end;
$$;

create or replace function public.fd_content_list(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_role text := app_private.content_role(p_actor);
begin
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'role', v_role,
    'canWrite', app_private.content_has_role(p_actor, 'author'),
    'canReview', app_private.content_has_role(p_actor, 'reviewer'),
    'canRetire', app_private.content_has_role(p_actor, 'reviewer') and app_private.content_has_role(p_actor, 'admin'),
    'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', i.slug, 'revision', i.revision, 'status', i.status, 'track', i.track, 'code', i.code, 'title', i.title,
             'level', i.level, 'authorId', i.author_id, 'reviewerId', i.reviewer_id, 'changeNote', i.change_note,
             'reviewNote', i.review_note, 'liveSynced', i.live_synced, 'updatedAt', i.updated_at,
             'submittedAt', i.submitted_at, 'publishedAt', i.published_at,
             'mine', i.author_id is not distinct from p_actor)
           order by i.code, i.revision desc)
      from app_private.content_items i
     where v_role = 'reviewer'
        or i.status = 'published'
        or i.author_id is not distinct from p_actor), '[]'::jsonb));
end;
$$;

create or replace function public.fd_content_save(
  p_actor uuid, p_slug text, p_track text, p_level public.course_level,
  p_mission jsonb, p_exercise jsonb, p_keys jsonb, p_exercise_key jsonb, p_change_note text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_open app_private.content_items;
  v_rev  integer;
begin
  if not app_private.content_has_role(p_actor, 'author') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,64}$' or p_track not in ('excel', 'math') or p_level is null
     or p_mission is null or jsonb_typeof(p_mission) <> 'object' or p_keys is null or jsonb_typeof(p_keys) <> 'object'
     or p_mission->>'slug' is distinct from p_slug or coalesce(p_mission->>'code', '') = '' or coalesce(p_mission->>'title', '') = ''
     or (p_exercise is not null and jsonb_typeof(p_exercise) <> 'object')
     or (p_exercise_key is not null and jsonb_typeof(p_exercise_key) <> 'object') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_open from app_private.content_items i where i.slug = p_slug and i.status in ('draft', 'in_review') for update;
  if found then
    if v_open.status = 'in_review' then return jsonb_build_object('ok', false, 'reason', 'in_review_locked'); end if;
    if v_open.author_id is distinct from p_actor then
      return jsonb_build_object('ok', false, 'reason', 'not_yours');
    end if;
    update app_private.content_items
       set track = p_track, level = p_level, code = p_mission->>'code', title = p_mission->>'title',
           mission = p_mission, exercise = p_exercise, keys = p_keys, exercise_key = p_exercise_key,
           change_note = p_change_note, review_note = null, updated_at = now()
     where id = v_open.id;
    v_rev := v_open.revision;
  else
    select coalesce(max(i.revision), 0) + 1 into v_rev from app_private.content_items i where i.slug = p_slug;
    insert into app_private.content_items (slug, revision, status, track, code, title, level, mission, exercise, keys, exercise_key, author_id, change_note)
    values (p_slug, v_rev, 'draft', p_track, p_mission->>'code', p_mission->>'title', p_level, p_mission, p_exercise, p_keys, p_exercise_key, p_actor, p_change_note);
  end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'content_save', 'content', p_slug, jsonb_build_object('revision', v_rev));
  return jsonb_build_object('ok', true, 'revision', v_rev);
end;
$$;

create or replace function public.fd_content_submit(p_actor uuid, p_slug text, p_revision integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  if not app_private.content_has_role(p_actor, 'author') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.author_id is distinct from p_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if v_row.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'not_a_draft'); end if;
  update app_private.content_items set status = 'in_review', submitted_at = now(), updated_at = now() where id = v_row.id;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'content_submit', 'content', p_slug, jsonb_build_object('revision', p_revision));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fd_content_withdraw(p_actor uuid, p_slug text, p_revision integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.author_id is distinct from p_actor or not app_private.content_has_role(p_actor, 'author') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_row.status <> 'in_review' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  update app_private.content_items set status = 'draft', updated_at = now() where id = v_row.id;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'content_withdraw', 'content', p_slug, jsonb_build_object('revision', p_revision));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fd_content_review(p_actor uuid, p_slug text, p_revision integer, p_decision text, p_note text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  if not app_private.content_has_role(p_actor, 'reviewer') then
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
