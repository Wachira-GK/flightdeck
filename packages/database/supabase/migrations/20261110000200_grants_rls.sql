-- FlightDeck grants + Row Level Security (FD-D01 / FD-S01)
-- Principle: default-deny -> revoke broad grants -> explicit table/column grants -> RLS policies.
-- Owner predicate: (select auth.uid()) = user_id. INSERT/UPDATE use WITH CHECK.
-- Verdict fields (score, passed, completion, entitlement, publication state) have no client grants.
-- AI-drafted: unreviewed until RLS-T01..T24 pass and the Security Architect signs off.

-- ---------------------------------------------------------------------------
-- 1. Revoke Supabase's broad defaults
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

revoke all on schema app_private from public, anon, authenticated;
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
alter default privileges in schema app_private revoke all on functions from public;

-- Helper functions are called from policies, so callers need USAGE on the schema.
-- No app_private table is granted to anon/authenticated; the schema is not exposed by the Data API.
grant usage on schema app_private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Non-login owner for SECURITY DEFINER helpers (least privilege, no BYPASSRLS)
-- ---------------------------------------------------------------------------
create role app_definer nologin noinherit;
grant app_definer to current_user;
grant usage on schema public, app_private to app_definer;

grant select on public.user_roles, public.courses, public.course_versions, public.missions,
  public.exercises, public.assessments, public.assessment_items, public.enrolments,
  public.entitlements, public.assessment_attempts, public.certificates
  to app_definer;
grant select on app_private.review_assignments to app_definer;
grant insert on public.profiles, public.user_preferences, public.user_roles to app_definer;

-- ---------------------------------------------------------------------------
-- 3. Enable RLS everywhere (app_private too: no policy = deny)
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.user_preferences    enable row level security;
alter table public.user_roles          enable row level security;
alter table public.tracks              enable row level security;
alter table public.courses             enable row level security;
alter table public.course_versions     enable row level security;
alter table public.missions            enable row level security;
alter table public.mission_steps       enable row level security;
alter table public.exercises           enable row level security;
alter table public.assessments         enable row level security;
alter table public.assessment_items    enable row level security;
alter table public.enrolments          enable row level security;
alter table public.step_progress       enable row level security;
alter table public.notes               enable row level security;
alter table public.bookmarks           enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_answers  enable row level security;
alter table public.exercise_attempts   enable row level security;
alter table public.entitlements        enable row level security;
alter table public.certificates        enable row level security;

alter table app_private.exercise_keys        enable row level security;
alter table app_private.assessment_item_keys enable row level security;
alter table app_private.review_assignments   enable row level security;
alter table app_private.payments             enable row level security;
alter table app_private.webhook_events       enable row level security;
alter table app_private.outbox               enable row level security;
alter table app_private.audit_log            enable row level security;

-- app_definer may read what the helpers need (and write the new-user bootstrap rows).
create policy definer_read on public.user_roles          for select to app_definer using (true);
create policy definer_read on public.courses             for select to app_definer using (true);
create policy definer_read on public.course_versions     for select to app_definer using (true);
create policy definer_read on public.missions            for select to app_definer using (true);
create policy definer_read on public.exercises           for select to app_definer using (true);
create policy definer_read on public.assessments         for select to app_definer using (true);
create policy definer_read on public.assessment_items    for select to app_definer using (true);
create policy definer_read on public.enrolments          for select to app_definer using (true);
create policy definer_read on public.entitlements        for select to app_definer using (true);
create policy definer_read on public.assessment_attempts for select to app_definer using (true);
create policy definer_read on public.certificates        for select to app_definer using (true);
create policy definer_read on app_private.review_assignments for select to app_definer using (true);
create policy definer_bootstrap on public.profiles         for insert to app_definer with check (true);
create policy definer_bootstrap on public.user_preferences for insert to app_definer with check (true);
create policy definer_bootstrap on public.user_roles       for insert to app_definer with check (role = 'learner');

-- ---------------------------------------------------------------------------
-- 4. Helper functions (SECURITY DEFINER, fixed empty search_path, use auth.uid() never a caller user_id)
-- ---------------------------------------------------------------------------
create function app_private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = (select auth.uid()) and r.role = p_role
  );
$$;

create function app_private.is_version_published(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.course_versions v
      join public.courses c on c.id = v.course_id
     where v.id = p_version
       and v.status = 'published' and v.published_at <= now()
       and c.status = 'published' and c.published_at <= now()
  );
$$;

create function app_private.can_read_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_version_published(p_version)
      or ((select auth.uid()) is not null and (
            exists (select 1 from public.course_versions v
                     where v.id = p_version and v.created_by = (select auth.uid()))
         or exists (select 1 from app_private.review_assignments ra
                     where ra.course_version_id = p_version and ra.reviewer_id = (select auth.uid()))
         or app_private.has_role('admin')));
$$;

create function app_private.can_read_mission(p_mission uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select app_private.can_read_version(m.course_version_id)
                     from public.missions m where m.id = p_mission), false);
$$;

create function app_private.can_read_assessment(p_assessment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select app_private.can_read_version(a.course_version_id)
                     from public.assessments a where a.id = p_assessment), false);
$$;

create function app_private.has_active_entitlement(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entitlements e
     where e.user_id = (select auth.uid()) and e.course_id = p_course
       and e.revoked_at is null and (e.expires_at is null or e.expires_at > now())
  );
$$;

create function app_private.can_enrol(p_course uuid, p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and app_private.is_version_published(p_version)
     and exists (
       select 1 from public.courses c
        where c.id = p_course
          and (c.is_free or app_private.has_active_entitlement(p_course))
     )
     and exists (
       select 1 from public.course_versions v where v.id = p_version and v.course_id = p_course
     );
$$;

create function app_private.is_enrolled_in_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrolments e
     where e.user_id = (select auth.uid()) and e.course_version_id = p_version
       and e.status in ('active', 'completed')
  );
$$;

create function app_private.can_start_attempt(p_assessment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select app_private.is_version_published(a.course_version_id)
       and app_private.is_enrolled_in_version(a.course_version_id)
      from public.assessments a where a.id = p_assessment), false);
$$;

create function app_private.can_attempt_exercise(p_exercise uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select app_private.is_version_published(x.course_version_id)
       and app_private.is_enrolled_in_version(x.course_version_id)
      from public.exercises x where x.id = p_exercise), false);
$$;

-- The attempt must be the caller's, still open, inside its time limit, and the item must belong to it.
create function app_private.answer_slot_open(p_attempt uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.assessment_attempts t
      join public.assessments a on a.id = t.assessment_id
      join public.assessment_items i on i.assessment_id = t.assessment_id
     where t.id = p_attempt and i.id = p_item
       and t.user_id = (select auth.uid())
       and t.status = 'open'
       and (a.time_limit_seconds is null
            or now() <= t.started_at + make_interval(secs => a.time_limit_seconds))
  );
$$;

-- Public, opaque, minimal certificate verification: no holder identity is returned.
create function public.verify_certificate(p_code text)
returns table (valid boolean, course_title text, issued_on date)
language sql stable security definer set search_path = '' as $$
  select c.revoked_at is null, co.title, c.issued_at::date
    from public.certificates c
    join public.courses co on co.id = c.course_id
   where p_code ~ '^[0-9a-f]{32}$' and c.verification_code = p_code;
$$;

alter function app_private.has_role(public.app_role)          owner to app_definer;
alter function app_private.is_version_published(uuid)          owner to app_definer;
alter function app_private.can_read_version(uuid)              owner to app_definer;
alter function app_private.can_read_mission(uuid)              owner to app_definer;
alter function app_private.can_read_assessment(uuid)           owner to app_definer;
alter function app_private.has_active_entitlement(uuid)        owner to app_definer;
alter function app_private.can_enrol(uuid, uuid)               owner to app_definer;
alter function app_private.is_enrolled_in_version(uuid)        owner to app_definer;
alter function app_private.can_start_attempt(uuid)             owner to app_definer;
alter function app_private.can_attempt_exercise(uuid)          owner to app_definer;
alter function app_private.answer_slot_open(uuid, uuid)        owner to app_definer;
alter function public.verify_certificate(text)                 owner to app_definer;
alter function app_private.handle_new_user()                   owner to app_definer;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.verify_certificate(text) from public;

grant execute on function
  app_private.is_version_published(uuid),
  app_private.can_read_version(uuid),
  app_private.can_read_mission(uuid),
  app_private.can_read_assessment(uuid)
  to anon, authenticated;
grant execute on function
  app_private.has_role(public.app_role),
  app_private.has_active_entitlement(uuid),
  app_private.can_enrol(uuid, uuid),
  app_private.is_enrolled_in_version(uuid),
  app_private.can_start_attempt(uuid),
  app_private.can_attempt_exercise(uuid),
  app_private.answer_slot_open(uuid, uuid)
  to authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;
-- Trigger functions need no EXECUTE grant: PostgreSQL checks it at CREATE TRIGGER, not when firing.

-- ---------------------------------------------------------------------------
-- 5. Table and column grants
-- ---------------------------------------------------------------------------
-- Public catalogue (published rows only, enforced by RLS)
grant select on public.tracks, public.courses, public.course_versions, public.missions,
  public.mission_steps, public.exercises
  to anon, authenticated;
grant select on public.assessments, public.assessment_items to authenticated;

-- Owner-only learner data
grant select on public.profiles to authenticated;
grant update (display_name, locale, timezone) on public.profiles to authenticated;
grant select on public.user_preferences to authenticated;
grant update (theme, reduced_motion, email_product_updates) on public.user_preferences to authenticated;
grant select on public.user_roles to authenticated;

grant select on public.enrolments to authenticated;
grant insert (course_id, course_version_id) on public.enrolments to authenticated;

grant select on public.step_progress to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (mission_step_id, body) on public.notes to authenticated;
grant update (body) on public.notes to authenticated;

grant select, delete on public.bookmarks to authenticated;
grant insert (mission_step_id) on public.bookmarks to authenticated;

grant select on public.assessment_attempts to authenticated;
grant insert (assessment_id) on public.assessment_attempts to authenticated;

grant select on public.assessment_answers to authenticated;
grant insert (attempt_id, item_id, response) on public.assessment_answers to authenticated;
grant update (response) on public.assessment_answers to authenticated;

grant select on public.exercise_attempts to authenticated;
grant insert (exercise_id, submission, client_evidence) on public.exercise_attempts to authenticated;

grant select on public.entitlements, public.certificates to authenticated;

-- Server (service_role bypasses RLS; grants still apply). Audit log is insert/select only.
grant usage on schema app_private to service_role;
grant all on all tables in schema public to service_role;
grant all on all tables in schema app_private to service_role;
grant usage, select on all sequences in schema app_private to service_role;
revoke update, delete, truncate on app_private.audit_log from service_role;

-- ---------------------------------------------------------------------------
-- 6. Policies
-- ---------------------------------------------------------------------------
-- Catalogue: status = 'published' and published_at <= now()
create policy catalogue_read on public.tracks for select to anon, authenticated
  using (status = 'published' and published_at <= now());
create policy catalogue_read on public.courses for select to anon, authenticated
  using (status = 'published' and published_at <= now());
create policy catalogue_read on public.course_versions for select to anon, authenticated
  using (app_private.can_read_version(id));
create policy catalogue_read on public.missions for select to anon, authenticated
  using (app_private.can_read_version(course_version_id));
create policy catalogue_read on public.mission_steps for select to anon, authenticated
  using (app_private.can_read_mission(mission_id));
create policy catalogue_read on public.exercises for select to anon, authenticated
  using (app_private.can_read_version(course_version_id));
create policy catalogue_read on public.assessments for select to authenticated
  using (app_private.can_read_version(course_version_id));
create policy catalogue_read on public.assessment_items for select to authenticated
  using (app_private.can_read_assessment(assessment_id));

-- Identity
create policy own_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_read on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));

-- Enrolment and progress
create policy own_read on public.enrolments for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.enrolments for insert to authenticated
  with check (user_id = (select auth.uid())
              and status = 'active' and completed_at is null
              and app_private.can_enrol(course_id, course_version_id));
create policy own_read on public.step_progress for select to authenticated
  using (user_id = (select auth.uid()));

-- Notes and bookmarks
create policy own_read on public.notes for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()) and app_private.can_read_mission(
    (select s.mission_id from public.mission_steps s where s.id = mission_step_id)));
create policy own_update on public.notes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.notes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy own_read on public.bookmarks for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy own_delete on public.bookmarks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Assessments
create policy own_read on public.assessment_attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.assessment_attempts for insert to authenticated
  with check (user_id = (select auth.uid())
              and status = 'open' and score is null and passed is null
              and app_private.can_start_attempt(assessment_id));

create policy own_read on public.assessment_answers for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert_open on public.assessment_answers for insert to authenticated
  with check (user_id = (select auth.uid()) and points_awarded is null
              and app_private.answer_slot_open(attempt_id, item_id));
create policy own_update_open on public.assessment_answers for update to authenticated
  using (user_id = (select auth.uid()) and app_private.answer_slot_open(attempt_id, item_id))
  with check (user_id = (select auth.uid()) and app_private.answer_slot_open(attempt_id, item_id));

-- Simulator submissions: client evidence only; the verdict is server-side
create policy own_read on public.exercise_attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.exercise_attempts for insert to authenticated
  with check (user_id = (select auth.uid())
              and status = 'submitted' and passed is null and score is null and validated_at is null
              and app_private.can_attempt_exercise(exercise_id));

-- Entitlements and certificates: read own, server writes
create policy own_read on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_read on public.certificates for select to authenticated
  using (user_id = (select auth.uid()));
