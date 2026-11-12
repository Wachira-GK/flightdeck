-- 20261112000400: SECURITY DEFINER helpers must not call auth.uid() (found on real Supabase, 12 Nov 2026).
--
-- Symptom: anon reading public.missions / exercises / mission_steps / course_versions failed with
-- "permission denied for schema auth". The catalogue policies call app_private.can_read_version(),
-- which is SECURITY DEFINER and owned by the NOLOGIN role app_definer, and it evaluated auth.uid().
-- On Supabase only anon / authenticated / service_role (and supabase roles) have USAGE on schema auth,
-- and the project's postgres role is not the owner of that schema, so it cannot grant USAGE to app_definer.
-- The PGlite test shim used to grant USAGE on schema auth to PUBLIC, which hid the gap (shim now faithful).
--
-- Fix: app_private.current_uid() reads the same per-request claim that auth.uid() reads (the JWT "sub"
-- that PostgREST sets for every request). It needs no schema or table privilege, so definer helpers can
-- call it. Trust is unchanged: auth.uid() itself reads this very setting. Policies that run as the caller
-- (and column defaults) keep using auth.uid(). CREATE OR REPLACE keeps owner and grants.

create function app_private.current_uid()
returns uuid language sql stable set search_path = '' as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid;
$$;
revoke all on function app_private.current_uid() from public;
grant execute on function app_private.current_uid() to anon, authenticated, service_role, app_definer;

create or replace function app_private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = (select app_private.current_uid()) and r.role = p_role
  );
$$;

create or replace function app_private.can_read_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_version_published(p_version)
      or ((select app_private.current_uid()) is not null and (
            exists (select 1 from public.course_versions v
                     where v.id = p_version and v.created_by = (select app_private.current_uid()))
         or exists (select 1 from app_private.review_assignments ra
                     where ra.course_version_id = p_version and ra.reviewer_id = (select app_private.current_uid()))
         or app_private.has_role('admin')));
$$;

create or replace function app_private.has_active_entitlement(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entitlements e
     where e.user_id = (select app_private.current_uid()) and e.course_id = p_course
       and e.revoked_at is null and (e.expires_at is null or e.expires_at > now())
  );
$$;

create or replace function app_private.can_enrol(p_course uuid, p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select app_private.current_uid()) is not null
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

create or replace function app_private.is_enrolled_in_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrolments e
     where e.user_id = (select app_private.current_uid()) and e.course_version_id = p_version
       and e.status in ('active', 'completed')
  );
$$;

create or replace function app_private.answer_slot_open(p_attempt uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.assessment_attempts t
      join public.assessments a on a.id = t.assessment_id
      join public.assessment_items i on i.assessment_id = t.assessment_id
     where t.id = p_attempt and i.id = p_item
       and t.user_id = (select app_private.current_uid())
       and t.status = 'open'
       and (a.time_limit_seconds is null
            or now() <= t.started_at + make_interval(secs => a.time_limit_seconds))
  );
$$;
