-- 20261116000800: FlightDeck Sim Bay (spreadsheet simulator) tables in the FlightDeck Supabase project.
-- Principle (same as FlightDeck ADR-002/ADR-008): default-deny; learners may READ their own rows and the published
-- catalogue; every WRITE goes through the Sim Bay Worker, which verifies the user's token, grades on the server
-- and then calls these tables/functions with the service-role key. Answer keys live in app_private (never exposed).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------- lessons (public part)
create table if not exists public.sim_lessons (
  id          text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  slug        text not null check (char_length(slug) between 1 and 80),
  version     integer not null default 1 check (version > 0),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title       text not null check (char_length(title) between 1 and 200),
  public_doc  jsonb not null,            -- lesson WITHOUT checks, solution or hint text
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sim_lessons_status_idx on public.sim_lessons (status);

-- ---------------------------------------------------------------------------- lessons (answer keys)
create table if not exists app_private.sim_lesson_keys (
  lesson_id   text primary key references public.sim_lessons (id) on delete cascade,
  version     integer not null,
  full_doc    jsonb not null,            -- complete lesson incl. checks, solution, hints
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------- attempts
create table if not exists public.sim_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  lesson_id       text not null references public.sim_lessons (id) on delete cascade,
  lesson_version  integer not null,
  mode            text not null check (mode in ('practice', 'guided', 'assessment')),
  status          text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  attempt_no      integer not null check (attempt_no > 0),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  progress        jsonb not null default '{}'::jsonb,
  score           jsonb,
  score_percent   numeric(5, 2) check (score_percent is null or score_percent between 0 and 100),
  passed          boolean,
  results         jsonb,
  graded_by       text not null default 'server' check (graded_by in ('server')),
  workbook_id     text not null check (char_length(workbook_id) <= 80),
  workbook        text check (workbook is null or octet_length(workbook) <= 3000000), -- base64 engine bytes
  updated_at      timestamptz not null default now()
);
create index if not exists sim_attempts_user_lesson_idx on public.sim_attempts (user_id, lesson_id);
create index if not exists sim_attempts_lesson_status_idx on public.sim_attempts (lesson_id, status);
create unique index if not exists sim_attempts_one_open_idx on public.sim_attempts (user_id, lesson_id) where status = 'in_progress';

-- ---------------------------------------------------------------------------- learner action log
create table if not exists public.sim_events (
  id          text primary key check (char_length(id) <= 80),
  user_id     uuid not null references auth.users (id) on delete cascade,
  attempt_id  uuid references public.sim_attempts (id) on delete cascade,
  lesson_id   text,
  at          timestamptz not null,
  type        text not null check (char_length(type) <= 40),
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists sim_events_attempt_idx on public.sim_events (attempt_id);
create index if not exists sim_events_user_at_idx on public.sim_events (user_id, at);

-- ---------------------------------------------------------------------------- grants + RLS (default deny)
alter table public.sim_lessons        enable row level security;
alter table public.sim_attempts       enable row level security;
alter table public.sim_events         enable row level security;
alter table app_private.sim_lesson_keys enable row level security;

revoke all on public.sim_lessons, public.sim_attempts, public.sim_events from public, anon, authenticated;
revoke all on app_private.sim_lesson_keys from public, anon, authenticated;

grant select on public.sim_lessons to anon, authenticated;
drop policy if exists sim_published_read on public.sim_lessons;
create policy sim_published_read on public.sim_lessons for select to anon, authenticated using (status = 'published');

-- learners read their own attempts (without the stored workbook column) and their own events
grant select (id, user_id, lesson_id, lesson_version, mode, status, attempt_no, started_at, submitted_at, progress, score, score_percent, passed, graded_by)
  on public.sim_attempts to authenticated;
drop policy if exists sim_own_read on public.sim_attempts;
create policy sim_own_read on public.sim_attempts for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.sim_events to authenticated;
drop policy if exists sim_own_read on public.sim_events;
create policy sim_own_read on public.sim_events for select to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.sim_lessons, public.sim_attempts, public.sim_events to service_role;
grant select, insert, update, delete on app_private.sim_lesson_keys to service_role;

-- ---------------------------------------------------------------------------- server-only RPCs (service_role)
-- PostgREST does not expose app_private, so the Worker reads/writes keys through these two functions.
create or replace function public.sim_put_lesson(p_public jsonb, p_full jsonb, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id text := p_full ->> 'id';
begin
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,64}$' or (p_public ->> 'id') is distinct from v_id then
    raise exception 'invalid lesson id' using errcode = '22023';
  end if;
  if p_public ? 'solution' or jsonb_path_exists(p_public, '$.tasks[*].checks') then
    raise exception 'public document must not contain answer keys' using errcode = '22023';
  end if;
  insert into public.sim_lessons (id, slug, version, status, title, public_doc, created_by, updated_at)
  values (v_id, coalesce(p_full ->> 'slug', v_id), coalesce((p_full ->> 'version')::int, 1),
          coalesce(p_full ->> 'status', 'draft'), coalesce(p_full ->> 'title', v_id), p_public, p_actor, now())
  on conflict (id) do update
     set slug = excluded.slug, version = excluded.version, status = excluded.status, title = excluded.title,
         public_doc = excluded.public_doc, updated_at = now();
  insert into app_private.sim_lesson_keys (lesson_id, version, full_doc, updated_at)
  values (v_id, coalesce((p_full ->> 'version')::int, 1), p_full, now())
  on conflict (lesson_id) do update set version = excluded.version, full_doc = excluded.full_doc, updated_at = now();
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'sim.lesson.saved', 'sim_lessons', v_id, jsonb_build_object('status', p_full ->> 'status', 'version', p_full ->> 'version'));
  return jsonb_build_object('saved', true, 'id', v_id);
end;
$$;

create or replace function public.sim_get_lesson_full(p_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select k.full_doc from app_private.sim_lesson_keys k where k.lesson_id = p_id;
$$;

revoke all on function public.sim_put_lesson(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.sim_get_lesson_full(text) from public, anon, authenticated;
grant execute on function public.sim_put_lesson(jsonb, jsonb, uuid) to service_role;
grant execute on function public.sim_get_lesson_full(text) to service_role;
