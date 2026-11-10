// Deterministic fixture ids for the RLS harness.
const id = (n: string) => `00000000-0000-4000-8000-0000000000${n}`;

export const U = {
  A: id('01'), B: id('02'), AUTHOR: id('03'), REVIEWER: id('04'),
  REVIEWER2: id('05'), ADMIN: id('06'), NEWBIE: id('07'),
};
export const TRACK = { EXCEL: id('11'), SQL: id('12') };
export const COURSE = { FREE: id('21'), PAID: id('22'), FUTURE: id('23') };
export const VER = { FREE1: id('31'), FREE2_DRAFT: id('32'), PAID1: id('33'), FUTURE1: id('34') };
export const MISSION = { M1: id('41'), M2_DRAFT: id('42'), PAID: id('43') };
export const EX = { X1: id('51'), X2_DRAFT: id('52') };
export const ASMT = { AS1: id('61'), PAID: id('62') };
export const ITEM = { I1: id('71'), I2: id('72'), PAID: id('73') };
export const STEP = { S1: id('81'), S2: id('82'), S3: id('83'), DRAFT: id('84') };
export const ENROL = { A: id('91'), B: id('92') };
export const ATT = { A_CLOSED: id('a1'), A_OPEN: id('a2'), B_OPEN: id('a3') };
export const NOTE = { A: id('b1'), B: id('b2') };
export const XATT = { B: id('c1') };
export const CERT = { A: id('d1'), CODE: '0123456789abcdef0123456789abcdef' };
export const PAY = { P1: id('e1') };

export const seedSql = `
insert into auth.users (id, email) values
  ('${U.A}', 'a@test.local'), ('${U.B}', 'b@test.local'), ('${U.AUTHOR}', 'author@test.local'),
  ('${U.REVIEWER}', 'reviewer@test.local'), ('${U.REVIEWER2}', 'reviewer2@test.local'),
  ('${U.ADMIN}', 'admin@test.local'), ('${U.NEWBIE}', 'newbie@test.local');

insert into public.user_roles (user_id, role) values
  ('${U.AUTHOR}', 'author'), ('${U.REVIEWER}', 'reviewer'), ('${U.REVIEWER2}', 'reviewer'), ('${U.ADMIN}', 'admin');

insert into public.tracks (id, slug, title, status, published_at) values
  ('${TRACK.EXCEL}', 'excel-masterclass', 'Excel Masterclass', 'published', now() - interval '1 day'),
  ('${TRACK.SQL}', 'codeverse-sql', 'CodeVerse SQL', 'draft', null);

insert into public.courses (id, track_id, slug, title, is_free, status, published_at) values
  ('${COURSE.FREE}', '${TRACK.EXCEL}', 'excel-foundations', 'Excel Foundations', true, 'published', now() - interval '1 day'),
  ('${COURSE.PAID}', '${TRACK.EXCEL}', 'excel-advanced', 'Excel Advanced', false, 'published', now() - interval '1 day'),
  ('${COURSE.FUTURE}', '${TRACK.EXCEL}', 'excel-future', 'Excel Future', true, 'published', now() + interval '7 days');

insert into public.course_versions (id, course_id, version, status, created_by, published_by, published_at) values
  ('${VER.FREE1}', '${COURSE.FREE}', 1, 'published', '${U.AUTHOR}', '${U.REVIEWER}', now() - interval '1 day'),
  ('${VER.FREE2_DRAFT}', '${COURSE.FREE}', 2, 'in_review', '${U.AUTHOR}', null, null),
  ('${VER.PAID1}', '${COURSE.PAID}', 1, 'published', '${U.AUTHOR}', '${U.REVIEWER}', now() - interval '1 day'),
  ('${VER.FUTURE1}', '${COURSE.FUTURE}', 1, 'published', '${U.AUTHOR}', '${U.REVIEWER}', now() - interval '1 day');

insert into app_private.review_assignments (course_version_id, reviewer_id, assigned_by) values
  ('${VER.FREE2_DRAFT}', '${U.REVIEWER}', '${U.ADMIN}');

insert into public.missions (id, course_version_id, position, slug, title) values
  ('${MISSION.M1}', '${VER.FREE1}', 1, 'sum-101', 'SUM and relative references'),
  ('${MISSION.M2_DRAFT}', '${VER.FREE2_DRAFT}', 1, 'sum-101', 'SUM (draft rewrite)'),
  ('${MISSION.PAID}', '${VER.PAID1}', 1, 'lookups', 'Lookups');

insert into public.exercises (id, course_version_id, kind, slug, title, definition) values
  ('${EX.X1}', '${VER.FREE1}', 'excel', 'sum-range', 'Total the sales column',
   '{"grid": {"rows": 10, "cols": 4}, "allowedFunctions": ["SUM"], "hint": "Use SUM over B2:B9"}'),
  ('${EX.X2_DRAFT}', '${VER.FREE2_DRAFT}', 'excel', 'sum-range', 'Draft exercise', '{}');

insert into app_private.exercise_keys (exercise_id, expected, hidden_tests) values
  ('${EX.X1}', '{"B10": 1234}', '[{"cell": "B10", "equals": 1234}]');

insert into public.assessments (id, course_version_id, slug, title, pass_mark, max_attempts) values
  ('${ASMT.AS1}', '${VER.FREE1}', 'sum-check', 'SUM check', 70, 3),
  ('${ASMT.PAID}', '${VER.PAID1}', 'lookup-check', 'Lookup check', 70, 3);

insert into public.assessment_items (id, assessment_id, position, kind, prompt, options) values
  ('${ITEM.I1}', '${ASMT.AS1}', 1, 'single_choice', '{"text": "Which function adds a range?"}', '["SUM","AVERAGE"]'),
  ('${ITEM.I2}', '${ASMT.AS1}', 2, 'numeric', '{"text": "SUM of 2 and 3?"}', null),
  ('${ITEM.PAID}', '${ASMT.PAID}', 1, 'single_choice', '{"text": "Lookup?"}', '["XLOOKUP","SUM"]');

insert into app_private.assessment_item_keys (item_id, correct) values
  ('${ITEM.I1}', '"SUM"'), ('${ITEM.I2}', '5'), ('${ITEM.PAID}', '"XLOOKUP"');

insert into public.mission_steps (id, mission_id, position, kind, title, exercise_id, assessment_id) values
  ('${STEP.S1}', '${MISSION.M1}', 1, 'briefing', 'Briefing', null, null),
  ('${STEP.S2}', '${MISSION.M1}', 2, 'simulation', 'Simulation', '${EX.X1}', null),
  ('${STEP.S3}', '${MISSION.M1}', 3, 'assessment', 'Assessment', null, '${ASMT.AS1}'),
  ('${STEP.DRAFT}', '${MISSION.M2_DRAFT}', 1, 'briefing', 'Draft briefing', null, null);

insert into public.enrolments (id, user_id, course_id, course_version_id) values
  ('${ENROL.A}', '${U.A}', '${COURSE.FREE}', '${VER.FREE1}'),
  ('${ENROL.B}', '${U.B}', '${COURSE.FREE}', '${VER.FREE1}');

insert into public.step_progress (user_id, mission_step_id, enrolment_id) values
  ('${U.A}', '${STEP.S1}', '${ENROL.A}');

insert into public.assessment_attempts (id, user_id, assessment_id, status, submitted_at, graded_at, score, passed) values
  ('${ATT.A_CLOSED}', '${U.A}', '${ASMT.AS1}', 'graded', now() - interval '1 hour', now() - interval '1 hour', 50, false);
insert into public.assessment_attempts (id, user_id, assessment_id) values
  ('${ATT.A_OPEN}', '${U.A}', '${ASMT.AS1}'),
  ('${ATT.B_OPEN}', '${U.B}', '${ASMT.AS1}');

insert into public.assessment_answers (attempt_id, item_id, user_id, response, points_awarded) values
  ('${ATT.A_CLOSED}', '${ITEM.I1}', '${U.A}', '"AVERAGE"', 0);

insert into public.notes (id, user_id, mission_step_id, body) values
  ('${NOTE.A}', '${U.A}', '${STEP.S1}', 'A private note'),
  ('${NOTE.B}', '${U.B}', '${STEP.S1}', 'B private note');

insert into public.bookmarks (user_id, mission_step_id) values ('${U.B}', '${STEP.S2}');

insert into public.exercise_attempts (id, user_id, exercise_id, submission) values
  ('${XATT.B}', '${U.B}', '${EX.X1}', '{"cells": {"B10": "=SUM(B2:B9)"}}');

insert into public.certificates (id, user_id, enrolment_id, course_id, course_version_id, verification_code, snapshot) values
  ('${CERT.A}', '${U.A}', '${ENROL.A}', '${COURSE.FREE}', '${VER.FREE1}', '${CERT.CODE}', '{"name": "Learner A"}');

insert into app_private.payments (id, user_id, course_id, provider, provider_reference, amount_minor, currency, status) values
  ('${PAY.P1}', '${U.B}', '${COURSE.PAID}', 'paystack', 'ref_001', 250000, 'KES', 'success');
insert into app_private.webhook_events (provider, event_id, signature_valid, payload) values
  ('paystack', 'evt_001', true, '{"event": "charge.success"}');
insert into app_private.outbox (topic, payload) values ('email.welcome', '{"user": "${U.A}"}');
insert into app_private.audit_log (actor_id, action, entity, entity_id) values ('${U.ADMIN}', 'seed', 'system', null);
`;
