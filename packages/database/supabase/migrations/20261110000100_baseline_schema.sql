-- FlightDeck baseline schema (FD-D01)
-- Target: Supabase PostgreSQL 15+ (tested on PostgreSQL 17 via PGlite).
-- Owner-scoped learner data lives in `public` behind RLS (see 20261110000200_grants_rls.sql).
-- Secrets, verdict inputs and integration records live in `app_private`, which is NOT exposed by the Data API.
-- AI-drafted: unreviewed until checks pass and the Data Architect + Security Architect sign off.

create schema if not exists app_private;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('learner', 'author', 'reviewer', 'admin', 'support');
create type public.publication_status as enum ('draft', 'in_review', 'approved', 'published', 'retired');
create type public.course_level as enum ('beginner', 'intermediate', 'advanced');
create type public.step_kind as enum ('briefing', 'training', 'simulation', 'assessment', 'debrief');
create type public.exercise_kind as enum ('excel', 'math');
create type public.item_kind as enum ('single_choice', 'multi_choice', 'numeric', 'formula');
create type public.enrolment_status as enum ('active', 'completed', 'withdrawn');
create type public.progress_status as enum ('started', 'completed');
create type public.attempt_status as enum ('open', 'submitted', 'graded');
create type public.exercise_attempt_status as enum ('submitted', 'validated', 'rejected');
create type public.entitlement_source as enum ('free', 'payment', 'grant');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Defence in depth: column grants already stop clients changing owners.
create function app_private.prevent_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'owner (user_id) is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  locale       text not null default 'en-KE' check (char_length(locale) <= 16),
  timezone     text not null default 'Africa/Nairobi' check (char_length(timezone) <= 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_preferences (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  theme                 text not null default 'system' check (theme in ('system', 'light', 'dark')),
  reduced_motion        boolean not null default false,
  email_product_updates boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- Role writes are server-only (no client grants).
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- Catalogue and versioned content
-- ---------------------------------------------------------------------------
create table public.tracks (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  title        text not null check (char_length(title) <= 120),
  sort_order   integer not null default 0,
  status       public.publication_status not null default 'draft',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null references public.tracks (id),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  title        text not null check (char_length(title) <= 160),
  summary      text check (char_length(summary) <= 2000),
  level        public.course_level not null default 'beginner',
  is_free      boolean not null default false,
  status       public.publication_status not null default 'draft',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
create index courses_track_id_idx on public.courses (track_id);

-- Content is immutable per version; a new edit round = a new version row.
create table public.course_versions (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id),
  version      integer not null check (version > 0),
  status       public.publication_status not null default 'draft',
  created_by   uuid not null references auth.users (id),
  published_by uuid references auth.users (id),
  published_at timestamptz,
  change_note  text check (char_length(change_note) <= 2000),
  created_at   timestamptz not null default now(),
  unique (course_id, version),
  unique (id, course_id),
  check (status <> 'published' or (published_at is not null and published_by is not null))
);
create unique index course_versions_one_published_idx on public.course_versions (course_id) where status = 'published';
create index course_versions_created_by_idx on public.course_versions (created_by);
create index course_versions_status_idx on public.course_versions (course_id, status);

create table public.missions (
  id                uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  position          integer not null check (position > 0),
  slug              text not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  title             text not null check (char_length(title) <= 160),
  summary           text check (char_length(summary) <= 2000),
  unique (course_version_id, position),
  unique (course_version_id, slug)
);

-- `definition` holds only learner-safe data (starter grid, allowed functions, limits, hints).
-- Expected answers and hidden tests live in app_private.exercise_keys.
create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  kind              public.exercise_kind not null,
  slug              text not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  title             text not null check (char_length(title) <= 160),
  definition        jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 65536),
  unique (course_version_id, slug)
);

create table public.assessments (
  id                 uuid primary key default gen_random_uuid(),
  course_version_id  uuid not null references public.course_versions (id) on delete cascade,
  slug               text not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  title              text not null check (char_length(title) <= 160),
  pass_mark          numeric(5, 2) not null check (pass_mark between 0 and 100),
  max_attempts       integer not null default 3 check (max_attempts between 1 and 20),
  time_limit_seconds integer check (time_limit_seconds > 0),
  unique (course_version_id, slug)
);

create table public.assessment_items (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  position      integer not null check (position > 0),
  kind          public.item_kind not null,
  prompt        jsonb not null check (octet_length(prompt::text) <= 16384),
  options       jsonb check (options is null or octet_length(options::text) <= 16384),
  points        numeric(6, 2) not null default 1 check (points > 0),
  unique (assessment_id, position)
);

create table public.mission_steps (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.missions (id) on delete cascade,
  position      integer not null check (position > 0),
  kind          public.step_kind not null,
  title         text not null check (char_length(title) <= 160),
  body          jsonb not null default '{}'::jsonb check (octet_length(body::text) <= 262144),
  exercise_id   uuid references public.exercises (id),
  assessment_id uuid references public.assessments (id),
  unique (mission_id, position),
  check (kind <> 'simulation' or exercise_id is not null),
  check (kind <> 'assessment' or assessment_id is not null)
);
create index mission_steps_exercise_id_idx on public.mission_steps (exercise_id);
create index mission_steps_assessment_id_idx on public.mission_steps (assessment_id);

-- Server-only content secrets
create table app_private.exercise_keys (
  exercise_id  uuid primary key references public.exercises (id) on delete cascade,
  expected     jsonb not null,
  hidden_tests jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

create table app_private.assessment_item_keys (
  item_id     uuid primary key references public.assessment_items (id) on delete cascade,
  correct     jsonb not null,
  explanation text
);

create table app_private.review_assignments (
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  reviewer_id       uuid not null references auth.users (id) on delete cascade,
  assigned_by       uuid references auth.users (id),
  assigned_at       timestamptz not null default now(),
  primary key (course_version_id, reviewer_id)
);
create index review_assignments_reviewer_id_idx on app_private.review_assignments (reviewer_id);

-- ---------------------------------------------------------------------------
-- Integrations (server-only)
-- ---------------------------------------------------------------------------
create table app_private.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id),
  course_id          uuid not null references public.courses (id),
  provider           text not null check (provider in ('paystack')),
  provider_reference text not null,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status             text not null check (status in ('pending', 'success', 'failed', 'refunded')),
  created_at         timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index payments_user_id_idx on app_private.payments (user_id);

-- unique (provider, event_id) rejects replayed webhooks (idempotency).
create table app_private.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  event_id        text not null,
  signature_valid boolean not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  unique (provider, event_id)
);

create table app_private.outbox (
  id           bigint generated always as identity primary key,
  topic        text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 0
);
create index outbox_pending_idx on app_private.outbox (available_at) where processed_at is null;

create table app_private.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb not null default '{}'::jsonb
);
create index audit_log_entity_idx on app_private.audit_log (entity, entity_id);

create function app_private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_append_only
  before update or delete on app_private.audit_log
  for each row execute function app_private.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Learner data (owner-scoped)
-- ---------------------------------------------------------------------------
create table public.enrolments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id         uuid not null references public.courses (id),
  course_version_id uuid not null,
  status            public.enrolment_status not null default 'active',
  enrolled_at       timestamptz not null default now(),
  completed_at      timestamptz,
  unique (user_id, course_id),
  foreign key (course_version_id, course_id) references public.course_versions (id, course_id),
  check ((status = 'completed') = (completed_at is not null))
);
create index enrolments_course_id_idx on public.enrolments (course_id);

-- Completion is a server verdict: no client write grants.
create table public.step_progress (
  user_id         uuid not null references auth.users (id) on delete cascade,
  mission_step_id uuid not null references public.mission_steps (id) on delete cascade,
  enrolment_id    uuid not null references public.enrolments (id) on delete cascade,
  status          public.progress_status not null default 'started',
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  primary key (user_id, mission_step_id),
  check ((status = 'completed') = (completed_at is not null))
);
create index step_progress_enrolment_id_idx on public.step_progress (enrolment_id);

create table public.notes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mission_step_id uuid not null references public.mission_steps (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 10000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index notes_user_id_idx on public.notes (user_id);
create index notes_mission_step_id_idx on public.notes (mission_step_id);

create table public.bookmarks (
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mission_step_id uuid not null references public.mission_steps (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, mission_step_id)
);

create table public.assessment_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id),
  attempt_no    integer not null default 1 check (attempt_no > 0),
  status        public.attempt_status not null default 'open',
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  graded_at     timestamptz,
  score         numeric(5, 2) check (score between 0 and 100),
  passed        boolean,
  unique (user_id, assessment_id, attempt_no),
  check (status = 'graded' or (score is null and passed is null and graded_at is null)),
  check (status <> 'graded' or (score is not null and passed is not null and graded_at is not null))
);
create unique index assessment_attempts_one_open_idx on public.assessment_attempts (user_id, assessment_id) where status = 'open';
create index assessment_attempts_assessment_id_idx on public.assessment_attempts (assessment_id);

-- Numbers the attempt and enforces max_attempts. Runs as the caller (own rows only via RLS).
create function app_private.assign_attempt_no()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max integer;
begin
  select a.max_attempts into v_max from public.assessments a where a.id = new.assessment_id;
  select coalesce(max(t.attempt_no), 0) + 1 into new.attempt_no
    from public.assessment_attempts t
   where t.user_id = new.user_id and t.assessment_id = new.assessment_id;
  if v_max is null or new.attempt_no > v_max then
    raise exception 'attempt limit reached' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger assessment_attempts_assign_no
  before insert on public.assessment_attempts
  for each row execute function app_private.assign_attempt_no();

create table public.assessment_answers (
  attempt_id     uuid not null references public.assessment_attempts (id) on delete cascade,
  item_id        uuid not null references public.assessment_items (id),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  response       jsonb not null check (octet_length(response::text) <= 16384),
  points_awarded numeric(6, 2),
  updated_at     timestamptz not null default now(),
  primary key (attempt_id, item_id)
);
create index assessment_answers_user_id_idx on public.assessment_answers (user_id);
create index assessment_answers_item_id_idx on public.assessment_answers (item_id);

-- Client evidence is stored but never trusted: passed/score/validated_at are server verdicts.
create table public.exercise_attempts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id       uuid not null references public.exercises (id),
  submission        jsonb not null check (octet_length(submission::text) <= 262144),
  client_evidence   jsonb check (client_evidence is null or octet_length(client_evidence::text) <= 16384),
  status            public.exercise_attempt_status not null default 'submitted',
  passed            boolean,
  score             numeric(5, 2) check (score between 0 and 100),
  validator_version text,
  validated_at      timestamptz,
  submitted_at      timestamptz not null default now(),
  check (status <> 'submitted' or (passed is null and score is null and validated_at is null)),
  check (status = 'submitted' or (passed is not null and validated_at is not null))
);
create index exercise_attempts_user_exercise_idx on public.exercise_attempts (user_id, exercise_id);
create index exercise_attempts_exercise_id_idx on public.exercise_attempts (exercise_id);

create table public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  course_id  uuid not null references public.courses (id),
  source     public.entitlement_source not null,
  payment_id uuid references app_private.payments (id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (source <> 'payment' or payment_id is not null)
);
create unique index entitlements_one_active_idx on public.entitlements (user_id, course_id) where revoked_at is null;
create index entitlements_course_id_idx on public.entitlements (course_id);

-- Exactly-once issue per enrolment; verification_code is opaque (122 random bits).
create table public.certificates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  enrolment_id      uuid not null unique references public.enrolments (id),
  course_id         uuid not null references public.courses (id),
  course_version_id uuid not null references public.course_versions (id),
  verification_code text not null unique default replace(gen_random_uuid()::text, '-', '')
                    check (verification_code ~ '^[0-9a-f]{32}$'),
  snapshot          jsonb not null,
  issued_at         timestamptz not null default now(),
  revoked_at        timestamptz
);
create index certificates_user_id_idx on public.certificates (user_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function app_private.set_updated_at();
create trigger notes_updated_at before update on public.notes
  for each row execute function app_private.set_updated_at();
create trigger assessment_answers_updated_at before update on public.assessment_answers
  for each row execute function app_private.set_updated_at();

create trigger profiles_owner_immutable before update on public.profiles
  for each row execute function app_private.prevent_owner_change();
create trigger user_preferences_owner_immutable before update on public.user_preferences
  for each row execute function app_private.prevent_owner_change();
create trigger notes_owner_immutable before update on public.notes
  for each row execute function app_private.prevent_owner_change();
create trigger enrolments_owner_immutable before update on public.enrolments
  for each row execute function app_private.prevent_owner_change();
create trigger assessment_attempts_owner_immutable before update on public.assessment_attempts
  for each row execute function app_private.prevent_owner_change();
create trigger assessment_answers_owner_immutable before update on public.assessment_answers
  for each row execute function app_private.prevent_owner_change();
create trigger exercise_attempts_owner_immutable before update on public.exercise_attempts
  for each row execute function app_private.prevent_owner_change();

-- New auth user -> profile, preferences, learner role.
create function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'learner');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
