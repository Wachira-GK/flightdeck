-- FlightDeck certificate exams (ADR-016, step 3). One exam per level. Everything here is SERVER-ONLY: tables live in
-- app_private and the functions are callable by service_role alone; the website passes the verified user id.
-- The database owns the CLOCK (deadline_at is set with now() here, never by the browser), the attempt rules (tries,
-- cooldown, one open attempt, hint budget) and certificate issuing. Grading itself needs the spreadsheet engine, so the
-- website grades and hands the verdict to fd_exam_finish, which refuses anything that arrives after the deadline.
-- Practice (the existing missions) is untouched and never counts toward a certificate: only exams issue certificates.

create table app_private.exam_config (
  level          public.course_level primary key,
  enabled        boolean not null default true,
  minutes        integer not null default 30 check (minutes between 5 and 240),
  max_hints      integer not null default 2 check (max_hints between 0 and 10),
  max_attempts   integer not null default 3 check (max_attempts between 1 and 20),
  cooldown_hours integer not null default 24 check (cooldown_hours between 0 and 720),
  pass_pct       integer not null default 70 check (pass_pct between 1 and 100),
  sheet_tasks    integer not null default 3 check (sheet_tasks between 0 and 10),
  questions      integer not null default 6 check (questions between 0 and 30),
  updated_at     timestamptz not null default now(),
  check (sheet_tasks + questions > 0)
);
insert into app_private.exam_config (level) select unnest(enum_range(null::public.course_level));

create table app_private.exam_attempt (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  level       public.course_level not null,
  attempt_no  integer not null check (attempt_no > 0),
  started_at  timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  status      text not null default 'in_progress' check (status in ('in_progress', 'passed', 'failed', 'expired')),
  plan        jsonb not null check (octet_length(plan::text) <= 400000),
  answers     jsonb not null default '{}'::jsonb check (octet_length(answers::text) <= 200000),
  hints_used  integer not null default 0 check (hints_used >= 0),
  hint_log    jsonb not null default '[]'::jsonb,
  result      jsonb,
  flags       jsonb not null default '{}'::jsonb,
  unique (user_id, level, attempt_no)
);
create unique index exam_attempt_one_open on app_private.exam_attempt (user_id, level) where status = 'in_progress';
create index exam_attempt_user_idx on app_private.exam_attempt (user_id, level, started_at desc);

create table app_private.certificate (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique check (number ~ '^FD-[BIA]-[0-9]{2}-[0-9A-F]{10}$'),
  user_id     uuid not null references auth.users (id) on delete cascade,
  level       public.course_level not null,
  holder_name text not null check (length(holder_name) between 1 and 120),
  attempt_id  uuid not null references app_private.exam_attempt (id),
  issued_at   timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_reason text,
  unique (user_id, level)
);

alter table app_private.exam_config  enable row level security;
alter table app_private.exam_attempt enable row level security;
alter table app_private.certificate enable row level security;
revoke all on app_private.exam_config, app_private.exam_attempt, app_private.certificate from public, anon, authenticated;
grant all on app_private.exam_config, app_private.exam_attempt, app_private.certificate to service_role;

-- Where one person stands for one level: config, tries used, when the next try is allowed, the open attempt, the certificate.
create function public.fd_exam_state(p_user uuid, p_level public.course_level)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  c        app_private.exam_config;
  v_used   integer;
  v_last   timestamptz;
  v_open   app_private.exam_attempt;
  v_cert   app_private.certificate;
  v_next   timestamptz;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into c from app_private.exam_config where level = p_level;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select count(*), max(coalesce(a.submitted_at, a.deadline_at)) into v_used, v_last
    from app_private.exam_attempt a where a.user_id = p_user and a.level = p_level and a.status <> 'in_progress';
  select * into v_open from app_private.exam_attempt a where a.user_id = p_user and a.level = p_level and a.status = 'in_progress';
  select * into v_cert from app_private.certificate x where x.user_id = p_user and x.level = p_level and x.revoked_at is null;
  v_next := case when v_last is null then null else v_last + make_interval(hours => c.cooldown_hours) end;
  return jsonb_build_object('ok', true,
    'config', jsonb_build_object('enabled', c.enabled, 'minutes', c.minutes, 'maxHints', c.max_hints, 'maxAttempts', c.max_attempts,
                                 'cooldownHours', c.cooldown_hours, 'passPct', c.pass_pct, 'sheetTasks', c.sheet_tasks, 'questions', c.questions),
    'used', v_used, 'triesLeft', greatest(c.max_attempts - v_used, 0),
    'nextAllowedAt', case when v_next is not null and v_next > now() then v_next end,
    'openAttemptId', v_open.id, 'openDeadline', v_open.deadline_at,
    'certificate', case when v_cert.id is not null then jsonb_build_object('number', v_cert.number, 'issuedAt', v_cert.issued_at) end,
    'now', now());
end;
$$;

-- Starts an attempt. The plan (which items, which variants) is built by the website; the rules are enforced here.
create function public.fd_exam_start(p_user uuid, p_level public.course_level, p_plan jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  c        app_private.exam_config;
  v_used   integer;
  v_last   timestamptz;
  v_id     uuid;
  v_no     integer;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  select * into c from app_private.exam_config where level = p_level for share;
  if not found or not c.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if exists (select 1 from app_private.certificate x where x.user_id = p_user and x.level = p_level and x.revoked_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'already_certified');
  end if;
  select a.id into v_id from app_private.exam_attempt a where a.user_id = p_user and a.level = p_level and a.status = 'in_progress';
  if found then return jsonb_build_object('ok', false, 'reason', 'open_attempt', 'attemptId', v_id); end if;
  select count(*), max(coalesce(a.submitted_at, a.deadline_at)) into v_used, v_last
    from app_private.exam_attempt a where a.user_id = p_user and a.level = p_level;
  if v_used >= c.max_attempts then return jsonb_build_object('ok', false, 'reason', 'no_tries_left'); end if;
  if v_last is not null and v_last + make_interval(hours => c.cooldown_hours) > now() then
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'nextAllowedAt', v_last + make_interval(hours => c.cooldown_hours));
  end if;
  v_no := v_used + 1;
  insert into app_private.exam_attempt (user_id, level, attempt_no, deadline_at, plan)
  values (p_user, p_level, v_no, now() + make_interval(mins => c.minutes), p_plan)
  returning id into v_id;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_user, 'exam_start', 'exam', v_id::text, jsonb_build_object('level', p_level, 'attempt', v_no));
  return jsonb_build_object('ok', true, 'attemptId', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'open_attempt');
end;
$$;

-- One attempt, as the website needs it to show or grade it. Only the owner can read it.
create function public.fd_exam_get(p_user uuid, p_attempt uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  a app_private.exam_attempt;
  c app_private.exam_config;
begin
  select * into a from app_private.exam_attempt x where x.id = p_attempt and x.user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from app_private.exam_config where level = a.level;
  return jsonb_build_object('ok', true, 'id', a.id, 'level', a.level, 'attemptNo', a.attempt_no, 'status', a.status,
    'startedAt', a.started_at, 'deadlineAt', a.deadline_at, 'submittedAt', a.submitted_at, 'now', now(),
    'secondsLeft', greatest(floor(extract(epoch from (a.deadline_at - now())))::integer, 0),
    'plan', a.plan, 'answers', a.answers, 'hintsUsed', a.hints_used, 'maxHints', c.max_hints, 'hintLog', a.hint_log,
    'result', a.result, 'passPct', c.pass_pct);
end;
$$;

-- Autosave of the answers so far. Refused after the deadline (plus 10 s for the network).
create function public.fd_exam_save(p_user uuid, p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a app_private.exam_attempt;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 200000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select * into a from app_private.exam_attempt x where x.id = p_attempt and x.user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if now() > a.deadline_at + interval '10 seconds' then return jsonb_build_object('ok', false, 'reason', 'time_up'); end if;
  update app_private.exam_attempt set answers = p_answers where id = a.id;
  return jsonb_build_object('ok', true, 'secondsLeft', greatest(floor(extract(epoch from (a.deadline_at - now())))::integer, 0));
end;
$$;

-- Spends one hint from the attempt's budget. The same hint twice costs nothing. The hint text itself is supplied by the website.
create function public.fd_exam_hint(p_user uuid, p_attempt uuid, p_task integer, p_hint integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a app_private.exam_attempt;
  c app_private.exam_config;
begin
  if p_task is null or p_task < 0 or p_task > 50 or p_hint is null or p_hint < 0 or p_hint > 20 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select * into a from app_private.exam_attempt x where x.id = p_attempt and x.user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status <> 'in_progress' or now() > a.deadline_at + interval '10 seconds' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  select * into c from app_private.exam_config where level = a.level;
  if exists (select 1 from jsonb_array_elements(a.hint_log) h where (h->>'task')::int = p_task and (h->>'hint')::int = p_hint) then
    return jsonb_build_object('ok', true, 'charged', false, 'hintsLeft', c.max_hints - a.hints_used);
  end if;
  if a.hints_used >= c.max_hints then return jsonb_build_object('ok', false, 'reason', 'no_hints_left'); end if;
  update app_private.exam_attempt
     set hints_used = hints_used + 1, hint_log = hint_log || jsonb_build_array(jsonb_build_object('task', p_task, 'hint', p_hint, 'at', now()))
   where id = a.id;
  return jsonb_build_object('ok', true, 'charged', true, 'hintsLeft', c.max_hints - a.hints_used - 1);
end;
$$;

-- Closes an attempt with the website's verdict. Anything arriving after the deadline (plus 10 s) can never pass.
-- A pass issues the certificate (once per person and level) and returns its number.
create function public.fd_exam_finish(p_user uuid, p_attempt uuid, p_answers jsonb, p_flags jsonb, p_result jsonb, p_holder text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a       app_private.exam_attempt;
  v_late  boolean;
  v_pass  boolean;
  v_status text;
  v_number text;
  v_cert  app_private.certificate;
  v_tries integer := 0;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' or octet_length(coalesce(p_flags, '{}'::jsonb)::text) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select * into a from app_private.exam_attempt x where x.id = p_attempt and x.user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  v_late := now() > a.deadline_at + interval '10 seconds';
  v_pass := coalesce((p_result->>'passed')::boolean, false) and not v_late;
  v_status := case when v_late then 'expired' when v_pass then 'passed' else 'failed' end;
  update app_private.exam_attempt
     set status = v_status, submitted_at = least(now(), a.deadline_at + interval '10 seconds'),
         answers = coalesce(p_answers, a.answers), flags = coalesce(p_flags, '{}'::jsonb),
         result = p_result || jsonb_build_object('passed', v_pass, 'late', v_late)
   where id = a.id;
  if v_pass then
    for v_tries in 1..5 loop
      v_number := 'FD-' || upper(left(a.level::text, 1)) || '-' || to_char(now(), 'YY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || a.id::text), 1, 10));
      begin
        insert into app_private.certificate (number, user_id, level, holder_name, attempt_id)
        values (v_number, p_user, a.level, left(coalesce(nullif(btrim(p_holder), ''), 'FlightDeck learner'), 120), a.id)
        on conflict (user_id, level) do nothing
        returning * into v_cert;
        exit;
      exception when unique_violation then
        v_number := null; -- number clash: try another
      end;
    end loop;
    if v_cert.id is null then
      select * into v_cert from app_private.certificate x where x.user_id = p_user and x.level = a.level;
    end if;
    insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
    values (p_user, 'certificate_issued', 'certificate', v_cert.number, jsonb_build_object('level', a.level, 'attempt', a.id));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'late', v_late, 'certificateNumber', v_cert.number);
end;
$$;

-- Public check of a certificate number (the website shows this on /verify/<number>). No email or id is returned.
create function public.fd_certificate_verify(p_number text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v app_private.certificate;
begin
  if p_number is null or upper(p_number) !~ '^FD-[BIA]-[0-9]{2}-[0-9A-F]{10}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v from app_private.certificate x where x.number = upper(p_number);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'number', v.number, 'level', v.level, 'holder', v.holder_name, 'issuedAt', v.issued_at,
                            'revoked', v.revoked_at is not null);
end;
$$;

-- The person's own certificates (for their Cockpit / exams page).
create function public.fd_certificates_of(p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('number', c.number, 'level', c.level, 'holder', c.holder_name, 'issuedAt', c.issued_at, 'revoked', c.revoked_at is not null) order by c.issued_at), '[]'::jsonb)
    from app_private.certificate c where c.user_id = p_user;
$$;

-- Admin: read and change the exam rules, list attempts with their soft integrity flags, revoke a certificate.
create function public.fd_admin_exam_config(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'levels', (select jsonb_agg(jsonb_build_object('level', c.level, 'enabled', c.enabled, 'minutes', c.minutes, 'maxHints', c.max_hints,
    'maxAttempts', c.max_attempts, 'cooldownHours', c.cooldown_hours, 'passPct', c.pass_pct, 'sheetTasks', c.sheet_tasks, 'questions', c.questions) order by c.level) from app_private.exam_config c));
end;
$$;

create function public.fd_admin_exam_set(p_actor uuid, p_level public.course_level, p_enabled boolean, p_minutes integer, p_max_hints integer,
                                          p_max_attempts integer, p_cooldown_hours integer, p_pass_pct integer, p_sheet_tasks integer, p_questions integer)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_minutes not between 5 and 240 or p_max_hints not between 0 and 10 or p_max_attempts not between 1 and 20 or p_cooldown_hours not between 0 and 720
     or p_pass_pct not between 1 and 100 or p_sheet_tasks not between 0 and 10 or p_questions not between 0 and 30 or p_sheet_tasks + p_questions < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  update app_private.exam_config set enabled = coalesce(p_enabled, enabled), minutes = p_minutes, max_hints = p_max_hints, max_attempts = p_max_attempts,
         cooldown_hours = p_cooldown_hours, pass_pct = p_pass_pct, sheet_tasks = p_sheet_tasks, questions = p_questions, updated_at = now()
   where level = p_level;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'exam_config_set', 'exam', p_level::text, jsonb_build_object('minutes', p_minutes, 'maxHints', p_max_hints, 'maxAttempts', p_max_attempts,
          'cooldownHours', p_cooldown_hours, 'passPct', p_pass_pct, 'sheetTasks', p_sheet_tasks, 'questions', p_questions, 'enabled', p_enabled));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.fd_admin_exam_attempts(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'attempts', coalesce((
    select jsonb_agg(x order by (x->>'startedAt') desc) from (
      select jsonb_build_object('id', a.id, 'userId', a.user_id, 'level', a.level, 'attemptNo', a.attempt_no, 'status', a.status,
               'startedAt', a.started_at, 'submittedAt', a.submitted_at, 'score', a.result->'score', 'hintsUsed', a.hints_used,
               'flags', a.flags, 'seconds', case when a.submitted_at is not null then floor(extract(epoch from (a.submitted_at - a.started_at)))::int end) as x
        from app_private.exam_attempt a order by a.started_at desc limit 200) t), '[]'::jsonb));
end;
$$;

create function public.fd_admin_certificate_revoke(p_actor uuid, p_number text, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not app_private.content_has_role(p_actor, 'admin') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update app_private.certificate set revoked_at = now(), revoked_reason = left(p_reason, 300) where number = upper(p_number) and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail) values (p_actor, 'certificate_revoked', 'certificate', upper(p_number), jsonb_build_object('reason', left(p_reason, 300)));
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.fd_exam_state(uuid, public.course_level), public.fd_exam_start(uuid, public.course_level, jsonb), public.fd_exam_get(uuid, uuid),
  public.fd_exam_save(uuid, uuid, jsonb), public.fd_exam_hint(uuid, uuid, integer, integer), public.fd_exam_finish(uuid, uuid, jsonb, jsonb, jsonb, text),
  public.fd_certificate_verify(text), public.fd_certificates_of(uuid), public.fd_admin_exam_config(uuid),
  public.fd_admin_exam_set(uuid, public.course_level, boolean, integer, integer, integer, integer, integer, integer, integer),
  public.fd_admin_exam_attempts(uuid), public.fd_admin_certificate_revoke(uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.fd_exam_state(uuid, public.course_level), public.fd_exam_start(uuid, public.course_level, jsonb), public.fd_exam_get(uuid, uuid),
  public.fd_exam_save(uuid, uuid, jsonb), public.fd_exam_hint(uuid, uuid, integer, integer), public.fd_exam_finish(uuid, uuid, jsonb, jsonb, jsonb, text),
  public.fd_certificate_verify(text), public.fd_certificates_of(uuid), public.fd_admin_exam_config(uuid),
  public.fd_admin_exam_set(uuid, public.course_level, boolean, integer, integer, integer, integer, integer, integer, integer),
  public.fd_admin_exam_attempts(uuid), public.fd_admin_certificate_revoke(uuid, text, text)
  to service_role;
