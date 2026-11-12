// RLS-T01..T24: Gate-1 authorisation evidence (FD-S01 / FD-D01 / FD-Q01).
// Every case runs in a rolled-back transaction as anon, a learner, an author/reviewer, or service_role.
import { beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import {
  ASMT, ATT, CERT, COURSE, ENROL, EX, ITEM, MISSION, NOTE, seedSql, STEP, TRACK, U, VER, XATT,
} from './fixtures';

let db: Db;
const A = user(U.A);
const B = user(U.B);

beforeAll(async () => {
  db = await createDb(seedSql);
}, 60_000);

const ids = (rows: Record<string, unknown>[], key = 'id') => rows.map((r) => r[key]).sort();

describe('RLS-T01..T24', () => {
  it('RLS-T01 anon cannot read any private learner table', async () => {
    for (const table of [
      'profiles', 'user_preferences', 'user_roles', 'enrolments', 'step_progress', 'notes', 'bookmarks',
      'assessment_attempts', 'assessment_answers', 'exercise_attempts', 'entitlements', 'certificates',
    ]) {
      await expect(db.as(anon, `select * from public.${table}`), table).rejects.toThrow(DENIED);
    }
  });

  it('RLS-T02 anon sees only published, already-live catalogue rows', async () => {
    expect(ids(await db.as(anon, 'select id from public.tracks'))).toEqual([TRACK.EXCEL]);
    expect(ids(await db.as(anon, 'select id from public.courses'))).toEqual([COURSE.FREE, COURSE.PAID].sort());
    expect(ids(await db.as(anon, 'select id from public.course_versions'))).toEqual([VER.FREE1, VER.PAID1].sort());
    expect(ids(await db.as(anon, 'select id from public.missions'))).toEqual([MISSION.M1, MISSION.PAID].sort());
  });

  it('RLS-T03 anon cannot read assessments or items; anon cannot write catalogue', async () => {
    await expect(db.as(anon, 'select * from public.assessments')).rejects.toThrow(DENIED);
    await expect(db.as(anon, 'select * from public.assessment_items')).rejects.toThrow(DENIED);
    await expect(db.as(anon, `insert into public.tracks (slug, title) values ('x-track', 'X')`)).rejects.toThrow(DENIED);
  });

  it('RLS-T04 learner A reads only own profile, enrolments, notes and attempts', async () => {
    expect(ids(await db.as(A, 'select user_id from public.profiles'), 'user_id')).toEqual([U.A]);
    expect(ids(await db.as(A, 'select id from public.enrolments'))).toEqual([ENROL.A]);
    expect(ids(await db.as(A, 'select id from public.notes'))).toEqual([NOTE.A]);
    expect(ids(await db.as(A, 'select id from public.assessment_attempts'))).toEqual([ATT.A_CLOSED, ATT.A_OPEN].sort());
    expect(ids(await db.as(A, 'select id from public.certificates'))).toEqual([CERT.A]);
  });

  it('RLS-T05 learner A cannot read learner B rows even by id', async () => {
    expect(await db.as(A, 'select * from public.notes where id = $1', [NOTE.B])).toHaveLength(0);
    expect(await db.as(A, 'select * from public.enrolments where id = $1', [ENROL.B])).toHaveLength(0);
    expect(await db.as(A, 'select * from public.exercise_attempts where id = $1', [XATT.B])).toHaveLength(0);
    expect(await db.as(A, 'select * from public.assessment_attempts where id = $1', [ATT.B_OPEN])).toHaveLength(0);
    expect(await db.as(A, 'select * from public.bookmarks where user_id = $1', [U.B])).toHaveLength(0);
    expect(await db.as(A, 'select * from public.profiles where user_id = $1', [U.B])).toHaveLength(0);
  });

  it('RLS-T06 owner-id substitution on insert is rejected; default owner is the caller', async () => {
    await expect(db.as(A, `insert into public.notes (user_id, mission_step_id, body) values ($1, $2, 'x')`, [U.B, STEP.S1]))
      .rejects.toThrow(DENIED);
    const rows = await db.as(A, `insert into public.notes (mission_step_id, body) values ($1, 'mine') returning user_id`, [STEP.S1]);
    expect(rows[0].user_id).toBe(U.A);
  });

  it('RLS-T07 learner A cannot update or delete learner B rows', async () => {
    const result = await db.scenario(async (step) => {
      const upd = await step(A, `update public.notes set body = 'hacked' where id = $1 returning id`, [NOTE.B]);
      const del = await step(A, `delete from public.notes where id = $1 returning id`, [NOTE.B]);
      const after = await step('postgres', 'select body from public.notes where id = $1', [NOTE.B]);
      return { upd, del, after };
    });
    expect(result.upd).toHaveLength(0);
    expect(result.del).toHaveLength(0);
    expect(result.after[0].body).toBe('B private note');
  });

  it('RLS-T08 owner reassignment is rejected', async () => {
    await expect(db.as(A, 'update public.notes set user_id = $1 where id = $2', [U.B, NOTE.A])).rejects.toThrow(DENIED);
    await expect(db.as(A, 'update public.profiles set user_id = $1', [U.B])).rejects.toThrow(DENIED);
    // Even a privileged writer cannot move ownership (trigger guard).
    await expect(db.as(service, 'update public.notes set user_id = $1 where id = $2', [U.B, NOTE.A])).rejects.toThrow(DENIED);
  });

  it('RLS-T09 learner cannot enrol another user or choose the enrolment status', async () => {
    await expect(db.as(user(U.NEWBIE), 'insert into public.enrolments (user_id, course_id, course_version_id) values ($1, $2, $3)',
      [U.A, COURSE.FREE, VER.FREE1])).rejects.toThrow(DENIED);
    await expect(db.as(user(U.NEWBIE), `insert into public.enrolments (course_id, course_version_id, status) values ($1, $2, 'completed')`,
      [COURSE.FREE, VER.FREE1])).rejects.toThrow(DENIED);
  });

  it('RLS-T10 client cannot set completion (enrolment or step progress)', async () => {
    await expect(db.as(A, `update public.enrolments set status = 'completed', completed_at = now() where id = $1`, [ENROL.A]))
      .rejects.toThrow(DENIED);
    await expect(db.as(A, 'insert into public.step_progress (user_id, mission_step_id, enrolment_id) values ($1, $2, $3)',
      [U.A, STEP.S2, ENROL.A])).rejects.toThrow(DENIED);
    await expect(db.as(A, `update public.step_progress set status = 'completed', completed_at = now()`)).rejects.toThrow(DENIED);
  });

  it('RLS-T11 client cannot set score or pass on assessment attempts', async () => {
    await expect(db.as(A, 'update public.assessment_attempts set score = 100, passed = true where id = $1', [ATT.A_OPEN]))
      .rejects.toThrow(DENIED);
    await expect(db.as(user(U.B), 'insert into public.assessment_attempts (assessment_id, score, passed) values ($1, 100, true)',
      [ASMT.AS1])).rejects.toThrow(DENIED);
  });

  it('RLS-T12 attempts require enrolment, one open attempt, and the attempt limit', async () => {
    await expect(db.as(user(U.NEWBIE), 'insert into public.assessment_attempts (assessment_id) values ($1)', [ASMT.AS1]))
      .rejects.toThrow(DENIED);
    await expect(db.as(A, 'insert into public.assessment_attempts (assessment_id) values ($1)', [ASMT.PAID]))
      .rejects.toThrow(DENIED);
    await expect(db.as(A, 'insert into public.assessment_attempts (assessment_id) values ($1)', [ASMT.AS1]))
      .rejects.toThrow(/duplicate key|unique/i);
  });

  it('RLS-T13 answers on a closed attempt cannot be created or changed', async () => {
    await expect(db.as(A, `insert into public.assessment_answers (attempt_id, item_id, response) values ($1, $2, '"x"')`,
      [ATT.A_CLOSED, ITEM.I2])).rejects.toThrow(DENIED);
    expect(await db.as(A, `update public.assessment_answers set response = '"SUM"' where attempt_id = $1 returning item_id`,
      [ATT.A_CLOSED])).toHaveLength(0);
  });

  it('RLS-T14 learner saves answers only in own open attempt and cannot award points', async () => {
    const saved = await db.scenario(async (step) => {
      await step(A, `insert into public.assessment_answers (attempt_id, item_id, response) values ($1, $2, '"SUM"')`, [ATT.A_OPEN, ITEM.I1]);
      return step(A, `update public.assessment_answers set response = '"AVERAGE"' where attempt_id = $1 returning response`, [ATT.A_OPEN]);
    });
    expect(saved[0].response).toBe('AVERAGE');
    await expect(db.as(A, `insert into public.assessment_answers (attempt_id, item_id, response, points_awarded) values ($1, $2, '1', 10)`,
      [ATT.A_OPEN, ITEM.I2])).rejects.toThrow(DENIED);
    await expect(db.as(A, `insert into public.assessment_answers (attempt_id, item_id, response) values ($1, $2, '"x"')`,
      [ATT.B_OPEN, ITEM.I1])).rejects.toThrow(DENIED);
    await expect(db.as(A, `insert into public.assessment_answers (attempt_id, item_id, response) values ($1, $2, '"x"')`,
      [ATT.A_OPEN, ITEM.PAID])).rejects.toThrow(DENIED);
  });

  it('RLS-T15 fabricated simulator pass is rejected; verdict is server-only', async () => {
    await expect(db.as(B, `insert into public.exercise_attempts (exercise_id, submission, passed) values ($1, '{}', true)`, [EX.X1]))
      .rejects.toThrow(DENIED);
    await expect(db.as(B, `insert into public.exercise_attempts (exercise_id, submission, status) values ($1, '{}', 'validated')`, [EX.X1]))
      .rejects.toThrow(DENIED);
    await expect(db.as(B, 'update public.exercise_attempts set passed = true where id = $1', [XATT.B])).rejects.toThrow(DENIED);
    await expect(db.as(B, `select app_private.record_exercise_verdict($1, true, 100, 'forged')`, [XATT.B])).rejects.toThrow(DENIED);
    const ok = await db.as(B, `insert into public.exercise_attempts (exercise_id, submission, client_evidence)
      values ($1, '{"cells": {}}', '{"claimsPass": true}') returning status, passed`, [EX.X1]);
    expect(ok[0]).toEqual({ status: 'submitted', passed: null });
    await expect(db.as(user(U.NEWBIE), `insert into public.exercise_attempts (exercise_id, submission) values ($1, '{}')`, [EX.X1]))
      .rejects.toThrow(DENIED);
  });

  it('RLS-T16 answer keys and hidden tests are unreachable from the browser', async () => {
    for (const who of [anon, A, user(U.AUTHOR), user(U.ADMIN)]) {
      await expect(db.as(who, 'select * from app_private.exercise_keys')).rejects.toThrow(DENIED);
      await expect(db.as(who, 'select * from app_private.assessment_item_keys')).rejects.toThrow(DENIED);
    }
    const defs = await db.as(anon, 'select definition from public.exercises');
    expect(JSON.stringify(defs)).not.toMatch(/expected|hidden|1234/);
  });

  it('RLS-T17 drafts and not-yet-live content are invisible to anon and learners', async () => {
    for (const who of [anon, A]) {
      expect(await db.as(who, 'select * from public.course_versions where id = $1', [VER.FREE2_DRAFT])).toHaveLength(0);
      expect(await db.as(who, 'select * from public.course_versions where id = $1', [VER.FUTURE1])).toHaveLength(0);
      expect(await db.as(who, 'select * from public.missions where id = $1', [MISSION.M2_DRAFT])).toHaveLength(0);
      expect(await db.as(who, 'select * from public.mission_steps where id = $1', [STEP.DRAFT])).toHaveLength(0);
      expect(await db.as(who, 'select * from public.exercises where id = $1', [EX.X2_DRAFT])).toHaveLength(0);
      expect(await db.as(who, 'select * from public.courses where id = $1', [COURSE.FUTURE])).toHaveLength(0);
    }
  });

  it('RLS-T18 author can read own draft but cannot self-publish', async () => {
    expect(await db.as(user(U.AUTHOR), 'select id from public.course_versions where id = $1', [VER.FREE2_DRAFT])).toHaveLength(1);
    await expect(db.as(user(U.AUTHOR), `update public.course_versions set status = 'published' where id = $1`, [VER.FREE2_DRAFT]))
      .rejects.toThrow(DENIED);
    await expect(db.as(user(U.AUTHOR), 'select app_private.publish_course_version($1, $2)', [VER.FREE2_DRAFT, U.AUTHOR]))
      .rejects.toThrow(DENIED);
    await expect(db.as(service, 'select app_private.publish_course_version($1, $2)', [VER.FREE2_DRAFT, U.AUTHOR]))
      .rejects.toThrow(/cannot publish own/);
  });

  it('RLS-T19 unassigned reviewer cannot publish; assigned reviewer can (audited, old version retired)', async () => {
    expect(await db.as(user(U.REVIEWER2), 'select id from public.course_versions where id = $1', [VER.FREE2_DRAFT])).toHaveLength(0);
    await expect(db.as(service, 'select app_private.publish_course_version($1, $2)', [VER.FREE2_DRAFT, U.REVIEWER2]))
      .rejects.toThrow(/not an assigned reviewer/);
    const after = await db.scenario(async (step) => {
      await step(service, 'select app_private.publish_course_version($1, $2)', [VER.FREE2_DRAFT, U.REVIEWER]);
      const versions = await step('postgres', 'select id, status from public.course_versions where course_id = $1 order by version', [COURSE.FREE]);
      const audit = await step('postgres', `select actor_id from app_private.audit_log where action = 'publish'`);
      return { versions, audit };
    });
    expect(after.versions.map((v) => v.status)).toEqual(['retired', 'published']);
    expect(after.audit[0].actor_id).toBe(U.REVIEWER);
  });

  it('RLS-T20 browser roles cannot touch audit, outbox, webhooks or payments; audit is append-only', async () => {
    for (const who of [anon, A, user(U.ADMIN)]) {
      for (const table of ['audit_log', 'outbox', 'webhook_events', 'payments', 'review_assignments']) {
        await expect(db.as(who, `select * from app_private.${table}`), table).rejects.toThrow(DENIED);
      }
      await expect(db.as(who, `insert into app_private.audit_log (action, entity) values ('x', 'y')`)).rejects.toThrow(DENIED);
    }
    await expect(db.as(service, `update app_private.audit_log set action = 'tampered'`)).rejects.toThrow(DENIED);
    await expect(db.as(service, 'delete from app_private.audit_log')).rejects.toThrow(DENIED);
    await expect(db.scenario((step) => step('postgres', 'delete from app_private.audit_log'))).rejects.toThrow(/append-only/);
  });

  it('RLS-T21 learner cannot create entitlements, certificates or roles (no privilege escalation)', async () => {
    await expect(db.as(A, `insert into public.entitlements (user_id, course_id, source) values ($1, $2, 'grant')`, [U.A, COURSE.PAID]))
      .rejects.toThrow(DENIED);
    await expect(db.as(A, `insert into public.certificates (user_id, enrolment_id, course_id, course_version_id, snapshot)
      values ($1, $2, $3, $4, '{}')`, [U.A, ENROL.A, COURSE.FREE, VER.FREE1])).rejects.toThrow(DENIED);
    await expect(db.as(A, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [U.A])).rejects.toThrow(DENIED);
    await expect(db.as(A, `update public.user_roles set role = 'admin' where user_id = $1`, [U.A])).rejects.toThrow(DENIED);
  });

  it('RLS-T22 paid course enrolment requires an active entitlement', async () => {
    await expect(db.as(A, 'insert into public.enrolments (course_id, course_version_id) values ($1, $2)', [COURSE.PAID, VER.PAID1]))
      .rejects.toThrow(DENIED);
    const rows = await db.scenario(async (step) => {
      await step('postgres', `insert into public.entitlements (user_id, course_id, source) values ($1, $2, 'grant')`, [U.A, COURSE.PAID]);
      return step(A, 'insert into public.enrolments (course_id, course_version_id) values ($1, $2) returning user_id, status', [COURSE.PAID, VER.PAID1]);
    });
    expect(rows[0]).toEqual({ user_id: U.A, status: 'active' });
  });

  it('RLS-T23 free enrolment works only for a published version of that course', async () => {
    const ok = await db.as(user(U.NEWBIE), 'insert into public.enrolments (course_id, course_version_id) values ($1, $2) returning user_id',
      [COURSE.FREE, VER.FREE1]);
    expect(ok[0].user_id).toBe(U.NEWBIE);
    await expect(db.as(user(U.NEWBIE), 'insert into public.enrolments (course_id, course_version_id) values ($1, $2)',
      [COURSE.FREE, VER.FREE2_DRAFT])).rejects.toThrow(DENIED);
    await expect(db.as(user(U.NEWBIE), 'insert into public.enrolments (course_id, course_version_id) values ($1, $2)',
      [COURSE.FUTURE, VER.FUTURE1])).rejects.toThrow(DENIED);
    await expect(db.as(user(U.NEWBIE), 'insert into public.enrolments (course_id, course_version_id) values ($1, $2)',
      [COURSE.FREE, VER.PAID1])).rejects.toThrow(DENIED);
  });

  it('RLS-T24 SECURITY DEFINER hygiene, RLS coverage and minimal certificate verification', async () => {
    const definers = await db.as<{ name: string; config: string[] | null; owner: string; public_exec: boolean }>(
      { role: 'service_role' },
      `select p.oid::regprocedure::text as name, p.proconfig as config, r.rolname as owner,
              has_function_privilege('public', p.oid, 'execute') as public_exec
         from pg_proc p join pg_roles r on r.oid = p.proowner
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'app_private')`);
    expect(definers.length).toBeGreaterThan(5);
    for (const f of definers) {
      expect(f.config, f.name).toContain('search_path=""');
      expect(f.owner, f.name).toBe('app_definer');
      expect(f.public_exec, f.name).toBe(false);
    }
    const noRls = await db.as(service, `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'app_private') and not c.relrowsecurity`);
    expect(noRls).toEqual([]);

    const verified = await db.as(anon, 'select * from public.verify_certificate($1)', [CERT.CODE]);
    expect(verified).toEqual([{ valid: true, course_title: 'Excel Foundations', issued_on: expect.any(Date) }]);
    expect(await db.as(anon, `select * from public.verify_certificate('%')`)).toHaveLength(0);
    expect(await db.as(anon, `select * from public.verify_certificate($1)`, ['f'.repeat(32)])).toHaveLength(0);
  });
});

describe('Data integrity (supporting evidence)', () => {
  it('DB-I01 replayed payment webhook is rejected (idempotency key)', async () => {
    await expect(db.as(service, `insert into app_private.webhook_events (provider, event_id, signature_valid, payload)
      values ('paystack', 'evt_001', true, '{}')`)).rejects.toThrow(/duplicate key/);
  });

  it('DB-I02 only one published version per course', async () => {
    await expect(db.as(service, `update public.course_versions set status = 'published', published_at = now(), published_by = $1
      where id = $2`, [U.REVIEWER, VER.FREE2_DRAFT])).rejects.toThrow(/duplicate key/);
  });

  it('DB-I03 simulator submission larger than 256 KB is rejected', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(270_000) });
    await expect(db.as(B, 'insert into public.exercise_attempts (exercise_id, submission) values ($1, $2::jsonb)', [EX.X1, big]))
      .rejects.toThrow(/check constraint/);
  });

  it('DB-I04 new auth user gets profile, preferences and learner role only', async () => {
    const rows = await db.scenario(async (step) => {
      await step('postgres', `insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ff', 'new@test.local')`);
      return step(user('00000000-0000-4000-8000-0000000000ff'), 'select role from public.user_roles');
    });
    expect(rows).toEqual([{ role: 'learner' }]);
  });

  it('DB-I05 sign-up display name is copied into the profile, cleaned and capped at 80 characters', async () => {
    const names = await db.scenario(async (step) => {
      const ins = (n: string, meta: string) =>
        step('postgres', `insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000${n}', '${n}@test.local', '${meta}'::jsonb)`);
      await ins('a1', JSON.stringify({ display_name: '  Ada\u0007 Lovelace  ' }));
      await ins('a2', JSON.stringify({ display_name: 'x'.repeat(200) }));
      await ins('a3', JSON.stringify({ display_name: 42 }));
      await ins('a4', '{}');
      return step('postgres', `select right(user_id::text, 2) as k, display_name from public.profiles where user_id::text like '00000000-0000-4000-8000-0000000000a%' order by 1`);
    });
    expect(names).toEqual([
      { k: 'a1', display_name: 'Ada Lovelace' },
      { k: 'a2', display_name: 'x'.repeat(80) },
      { k: 'a3', display_name: '' },
      { k: 'a4', display_name: '' },
    ]);
  });

  it('DB-I06 a Google account takes its name from full_name or name; display_name wins; blanks and non-text are skipped', async () => {
    const names = await db.scenario(async (step) => {
      const ins = (n: string, meta: object) =>
        step('postgres', `insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000${n}', '${n}@test.local', '${JSON.stringify(meta)}'::jsonb)`);
      await ins('b1', { full_name: 'Godfrey Kariuki', name: 'G K', avatar_url: 'https://x/y.png' });
      await ins('b2', { name: 'Only Name' });
      await ins('b3', { display_name: 'Chosen', full_name: 'Ignored' });
      await ins('b4', { display_name: '   ', full_name: 42, name: 'Third\u0007 Choice' });
      await ins('b5', { full_name: ['x'], name: null });
      return step('postgres', `select right(user_id::text, 2) as k, display_name from public.profiles where user_id::text like '00000000-0000-4000-8000-0000000000b%' order by 1`);
    });
    expect(names).toEqual([
      { k: 'b1', display_name: 'Godfrey Kariuki' },
      { k: 'b2', display_name: 'Only Name' },
      { k: 'b3', display_name: 'Chosen' },
      { k: 'b4', display_name: 'Third Choice' },
      { k: 'b5', display_name: '' },
    ]);
  });
});
