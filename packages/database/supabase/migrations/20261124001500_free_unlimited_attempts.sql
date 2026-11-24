-- Free missions have unlimited assessment attempts (Godfrey, 24 Nov 2026; ADR-011 addendum).
-- A learner may retry a FREE mission's assessment as often as they like (to reach 100%) and every attempt is stored.
-- Other missions keep the per-assessment max_attempts. A generous safety ceiling of 1,000 stored attempts per learner
-- per assessment stops a runaway script from filling the table.
-- "Free" is read from app_private.mission_access, so changing a mission's Free switch changes its limit at once.
-- If the caller cannot read that table (a direct, non-server insert), the normal limit applies.

create or replace function app_private.assign_attempt_no()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max  integer;
  v_free boolean := false;
begin
  select a.max_attempts into v_max from public.assessments a where a.id = new.assessment_id;
  begin
    select exists (
      select 1
        from public.assessments a
        join app_private.mission_access ma on a.slug = ma.mission_slug || '-assessment'
       where a.id = new.assessment_id and ma.is_free
    ) into v_free;
  exception when insufficient_privilege then
    v_free := false;
  end;
  select coalesce(max(t.attempt_no), 0) + 1 into new.attempt_no
    from public.assessment_attempts t
   where t.user_id = new.user_id and t.assessment_id = new.assessment_id;
  if v_free then v_max := 1000; end if;
  if v_max is null or new.attempt_no > v_max then
    raise exception 'attempt limit reached' using errcode = '42501';
  end if;
  return new;
end;
$$;
