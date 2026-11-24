-- FlightDeck content workspace, stage 2a (ADR-015).
-- Missions authored in the app are stored here as REVISIONS: the same learner-safe mission/exercise documents and the
-- same SERVER-ONLY keys the content files hold today. Workflow: author saves a draft -> submits -> a different person
-- with the reviewer (or admin) role publishes it or returns it with a comment. Revisions are never edited after they
-- leave draft and never deleted. Only one revision per mission is published at a time (the previous one is retired).
-- Server-only: tables in app_private; functions in public for PostgREST but only service_role runs them, and every one
-- re-checks the actor's role in the database (suspended users are refused).
-- Stage 2a stores and moves revisions through the workflow. Copying a published revision into the live catalogue rows
-- (public.missions etc.) is stage 2b: until then `live_synced` stays false.

create table app_private.content_items (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  revision       integer not null check (revision > 0),
  status         public.publication_status not null default 'draft',
  track          text not null default 'excel' check (track in ('excel', 'math')),
  code           text not null check (char_length(code) between 2 and 20),
  title          text not null check (char_length(title) between 1 and 160),
  level          public.course_level not null default 'beginner',
  mission        jsonb not null check (jsonb_typeof(mission) = 'object' and octet_length(mission::text) <= 262144),
  exercise       jsonb check (exercise is null or (jsonb_typeof(exercise) = 'object' and octet_length(exercise::text) <= 262144)),
  keys           jsonb not null check (jsonb_typeof(keys) = 'object' and octet_length(keys::text) <= 262144),
  exercise_key   jsonb check (exercise_key is null or (jsonb_typeof(exercise_key) = 'object' and octet_length(exercise_key::text) <= 262144)),
  author_id      uuid references auth.users (id) on delete set null,
  reviewer_id    uuid references auth.users (id) on delete set null,
  change_note    text check (char_length(change_note) <= 2000),
  review_note    text check (char_length(review_note) <= 2000),
  live_synced    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  published_at   timestamptz,
  unique (slug, revision),
  check (status <> 'published' or (published_at is not null and reviewer_id is not null))
);
create unique index content_items_one_published_idx on app_private.content_items (slug) where status = 'published';
create unique index content_items_one_open_idx on app_private.content_items (slug) where status in ('draft', 'in_review');
create index content_items_status_idx on app_private.content_items (status, updated_at desc);

alter table app_private.content_items enable row level security;
revoke all on app_private.content_items from public, anon, authenticated;
grant all on app_private.content_items to service_role;

-- ---------------------------------------------------------------------------
-- Who may do what (null = nothing)
-- ---------------------------------------------------------------------------
create function app_private.content_role(p_actor uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p_actor is null or exists (select 1 from app_private.user_status s where s.user_id = p_actor and s.status = 'suspended') then null
    when exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'admin') then 'admin'
    when exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'reviewer') then 'reviewer'
    when exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = 'author') then 'author'
    else null
  end;
$$;

create function app_private.content_has_role(p_actor uuid, p_role public.app_role)
returns boolean language sql stable set search_path = '' as $$
  select p_actor is not null
     and exists (select 1 from public.user_roles r where r.user_id = p_actor and r.role = p_role)
     and not exists (select 1 from app_private.user_status s where s.user_id = p_actor and s.status = 'suspended');
$$;

revoke execute on function app_private.content_role(uuid), app_private.content_has_role(uuid, public.app_role) from public, anon, authenticated;
grant execute on function app_private.content_role(uuid), app_private.content_has_role(uuid, public.app_role) to service_role;

-- ---------------------------------------------------------------------------
-- List and read (documents only through fd_content_get)
-- ---------------------------------------------------------------------------
create function public.fd_content_list(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_role text := app_private.content_role(p_actor);
begin
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'role', v_role, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', i.slug, 'revision', i.revision, 'status', i.status, 'track', i.track, 'code', i.code, 'title', i.title,
             'level', i.level, 'authorId', i.author_id, 'reviewerId', i.reviewer_id, 'changeNote', i.change_note,
             'reviewNote', i.review_note, 'liveSynced', i.live_synced, 'updatedAt', i.updated_at,
             'submittedAt', i.submitted_at, 'publishedAt', i.published_at,
             'mine', i.author_id is not distinct from p_actor)
           order by i.code, i.revision desc)
      from app_private.content_items i
     where v_role in ('admin', 'reviewer')
        or i.status = 'published'
        or i.author_id is not distinct from p_actor), '[]'::jsonb));
end;
$$;

create function public.fd_content_get(p_actor uuid, p_slug text, p_revision integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_role text := app_private.content_role(p_actor);
  v_row  app_private.content_items;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_row from app_private.content_items i
   where i.slug = p_slug and i.revision = coalesce(p_revision, (select max(x.revision) from app_private.content_items x where x.slug = p_slug));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_role = 'author' and v_row.status <> 'published' and v_row.author_id is distinct from p_actor then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'item', jsonb_build_object(
    'slug', v_row.slug, 'revision', v_row.revision, 'status', v_row.status, 'track', v_row.track, 'code', v_row.code,
    'title', v_row.title, 'level', v_row.level, 'mission', v_row.mission, 'exercise', v_row.exercise, 'keys', v_row.keys,
    'exerciseKey', v_row.exercise_key, 'authorId', v_row.author_id, 'reviewerId', v_row.reviewer_id,
    'changeNote', v_row.change_note, 'reviewNote', v_row.review_note, 'liveSynced', v_row.live_synced,
    'mine', v_row.author_id is not distinct from p_actor));
end;
$$;

-- ---------------------------------------------------------------------------
-- Author: save a draft, submit, withdraw
-- ---------------------------------------------------------------------------
-- Saves into the open draft for this mission (own draft; admins may take over), or starts the next revision.
create function public.fd_content_save(
  p_actor uuid, p_slug text, p_track text, p_level public.course_level,
  p_mission jsonb, p_exercise jsonb, p_keys jsonb, p_exercise_key jsonb, p_change_note text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_open app_private.content_items;
  v_rev  integer;
begin
  if not (app_private.content_has_role(p_actor, 'author') or app_private.content_has_role(p_actor, 'admin')) then
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
    if v_open.author_id is distinct from p_actor and not app_private.content_has_role(p_actor, 'admin') then
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

create function public.fd_content_submit(p_actor uuid, p_slug text, p_revision integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  if not (app_private.content_has_role(p_actor, 'author') or app_private.content_has_role(p_actor, 'admin')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.author_id is distinct from p_actor and not app_private.content_has_role(p_actor, 'admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if v_row.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'not_a_draft'); end if;
  update app_private.content_items set status = 'in_review', submitted_at = now(), updated_at = now() where id = v_row.id;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'content_submit', 'content', p_slug, jsonb_build_object('revision', p_revision));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.fd_content_withdraw(p_actor uuid, p_slug text, p_revision integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.author_id is distinct from p_actor or not (app_private.content_has_role(p_actor, 'author') or app_private.content_has_role(p_actor, 'admin')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_row.status <> 'in_review' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  update app_private.content_items set status = 'draft', updated_at = now() where id = v_row.id;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'content_withdraw', 'content', p_slug, jsonb_build_object('revision', p_revision));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer: publish or return. Nobody reviews their own work.
-- ---------------------------------------------------------------------------
create function public.fd_content_review(p_actor uuid, p_slug text, p_revision integer, p_decision text, p_note text)
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
  end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, case when p_decision = 'publish' then 'content_publish' else 'content_return' end, 'content', p_slug,
          jsonb_build_object('revision', p_revision, 'author', v_row.author_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin only: take a published mission out of the catalogue (history stays).
create function public.fd_content_retire(p_actor uuid, p_slug text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update app_private.content_items set status = 'retired', live_synced = false, updated_at = now() where slug = p_slug and status = 'published';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'not_published'); end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id) values (p_actor, 'content_retire', 'content', p_slug);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.fd_content_list(uuid), public.fd_content_get(uuid, text, integer),
  public.fd_content_save(uuid, text, text, public.course_level, jsonb, jsonb, jsonb, jsonb, text),
  public.fd_content_submit(uuid, text, integer), public.fd_content_withdraw(uuid, text, integer),
  public.fd_content_review(uuid, text, integer, text, text), public.fd_content_retire(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.fd_content_list(uuid), public.fd_content_get(uuid, text, integer),
  public.fd_content_save(uuid, text, text, public.course_level, jsonb, jsonb, jsonb, jsonb, text),
  public.fd_content_submit(uuid, text, integer), public.fd_content_withdraw(uuid, text, integer),
  public.fd_content_review(uuid, text, integer, text, text), public.fd_content_retire(uuid, text)
  to service_role;
