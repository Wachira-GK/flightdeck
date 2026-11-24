-- FlightDeck content workspace, stage 2b (ADR-015): how the website reads published content.
-- Server-only (service_role). Learner-safe documents and SERVER-ONLY keys come out of different functions.
-- A learner is PINNED to the revision they first opened (app_private.mission_pin), so publishing a newer revision does
-- not change a mission they are partway through; they see (and are graded on) their pinned revision.

create table app_private.mission_pin (
  user_id    uuid not null references auth.users (id) on delete cascade,
  slug       text not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  revision   integer not null check (revision > 0),
  pinned_at  timestamptz not null default now(),
  primary key (user_id, slug),
  foreign key (slug, revision) references app_private.content_items (slug, revision)
);
alter table app_private.mission_pin enable row level security;
revoke all on app_private.mission_pin from public, anon, authenticated;
grant all on app_private.mission_pin to service_role;

-- Small list for the catalogue: no documents, no keys.
create function public.fd_content_published_summary()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', i.slug, 'revision', i.revision, 'track', i.track, 'code', i.code, 'title', i.title, 'level', i.level,
           'summary', i.mission->>'summary', 'estimatedMinutes', i.mission->'estimatedMinutes')
         order by i.code), '[]'::jsonb)
    from app_private.content_items i
   where i.status = 'published';
$$;

-- The learner-safe documents for one mission. With p_pin and a user, the first call pins the current revision.
create function public.fd_content_for_learner(p_user uuid, p_slug text, p_pin boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_rev integer;
  v_row app_private.content_items;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,64}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_user is not null then
    select p.revision into v_rev from app_private.mission_pin p where p.user_id = p_user and p.slug = p_slug;
  end if;
  if v_rev is null then
    select i.revision into v_rev from app_private.content_items i where i.slug = p_slug and i.status = 'published';
    if v_rev is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if p_user is not null and coalesce(p_pin, false) then
      insert into app_private.mission_pin (user_id, slug, revision) values (p_user, p_slug, v_rev) on conflict do nothing;
    end if;
  end if;
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = v_rev;
  return jsonb_build_object('ok', true, 'revision', v_row.revision, 'track', v_row.track, 'level', v_row.level,
                            'mission', v_row.mission, 'exercise', v_row.exercise);
end;
$$;

-- Keys for grading the assessment of one mission, from the learner's pinned revision (else the published one).
create function public.fd_content_grading(p_user uuid, p_slug text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_rev integer;
  v_row app_private.content_items;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,64}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_user is not null then
    select p.revision into v_rev from app_private.mission_pin p where p.user_id = p_user and p.slug = p_slug;
  end if;
  if v_rev is null then
    select i.revision into v_rev from app_private.content_items i where i.slug = p_slug and i.status = 'published';
  end if;
  select * into v_row from app_private.content_items i where i.slug = p_slug and i.revision = v_rev;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'revision', v_row.revision, 'mission', v_row.mission, 'keys', v_row.keys);
end;
$$;

-- Exercise document and answer key for the live simulation check, by exercise id (published revisions only).
create function public.fd_content_exercise(p_exercise_id text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_row app_private.content_items;
begin
  if p_exercise_id is null or p_exercise_id !~ '^[a-z0-9-]{2,64}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_row from app_private.content_items i
   where i.status = 'published' and i.exercise->>'id' = p_exercise_id and i.exercise_key is not null limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'slug', v_row.slug, 'exercise', v_row.exercise, 'exerciseKey', v_row.exercise_key);
end;
$$;

revoke execute on function
  public.fd_content_published_summary(), public.fd_content_for_learner(uuid, text, boolean),
  public.fd_content_grading(uuid, text), public.fd_content_exercise(text)
  from public, anon, authenticated;
grant execute on function
  public.fd_content_published_summary(), public.fd_content_for_learner(uuid, text, boolean),
  public.fd_content_grading(uuid, text), public.fd_content_exercise(text)
  to service_role;
