// PROG-T01..T07: server-only progress recording (migration 20261115000700, ADR-008).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const L1 = '00000000-0000-4000-8000-0000000007a1';
const L2 = '00000000-0000-4000-8000-0000000007a2';
const GHOST = '00000000-0000-4000-8000-0000000007ff';

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(`insert into auth.users (id, email) values ('${L1}', 'l1@test.local'), ('${L2}', 'l2@test.local')`);
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

const rec = `select public.fd_record_assessment($1::uuid, $2, $3::numeric, $4::boolean) as r`;
const recX = `select public.fd_record_exercise($1::uuid, $2, $3::jsonb, $4::boolean, $5::numeric, $6) as r`;

describe('PROG-T01..T07 progress recording', () => {
  it('PROG-T01 only service_role may execute the recorders', async () => {
    for (const who of [anon, user(L1)]) {
      await expect(db.as(who, rec, [L1, 'excel-sum-101', 90, true])).rejects.toThrow(DENIED);
      await expect(db.as(who, recX, [L1, 'sum-relative-refs', '{}', true, 100, 'v1'])).rejects.toThrow(DENIED);
    }
    const ok = await db.as<{ r: Row }>(service, rec, [L1, 'excel-sum-101', 90, true]);
    expect(ok[0]!.r.saved).toBe(true);
  });

  it('PROG-T02 a failed assessment is stored, enrols the learner, and does not complete the step', async () => {
    const out = await db.scenario(async (step) => {
      const r = await step<{ r: Row }>(service, rec, [L1, 'excel-sum-101', 40, false]);
      const att = await step<Row>('postgres', `select attempt_no, status, score, passed from public.assessment_attempts where user_id = '${L1}'`);
      const enr = await step<Row>('postgres', `select count(*)::int as n from public.enrolments where user_id = '${L1}'`);
      const done = await step<Row>('postgres', `select count(*)::int as n from public.step_progress where user_id = '${L1}'`);
      return { r: r[0]!.r, att, enr: enr[0]!.n, done: done[0]!.n };
    });
    expect(out.r).toMatchObject({ saved: true, attemptNo: 1, passed: false });
    expect(out.att).toEqual([{ attempt_no: 1, status: 'graded', score: '40.00', passed: false }]);
    expect(out.enr).toBe(1);
    expect(out.done).toBe(0);
  });

  it('PROG-T03 a pass completes the assessment step once; later passes keep the first completion time', async () => {
    const out = await db.scenario(async (step) => {
      await step(service, rec, [L1, 'excel-sum-101', 85, true]);
      const first = await step<Row>('postgres', `select completed_at from public.step_progress where user_id = '${L1}'`);
      await step(service, rec, [L1, 'excel-sum-101', 95, true]);
      const rows = await step<Row>('postgres', `select status, completed_at from public.step_progress where user_id = '${L1}'`);
      const enr = await step<Row>('postgres', `select count(*)::int as n from public.enrolments where user_id = '${L1}'`);
      return { first, rows, enr: enr[0]!.n };
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.status).toBe('completed');
    expect(out.rows[0]!.completed_at).toEqual(out.first[0]!.completed_at);
    expect(out.enr).toBe(1);
  });

  it('PROG-T04 the attempt limit is respected and reported, not thrown', async () => {
    const out = await db.scenario(async (step) => {
      await step('postgres', `update app_private.mission_access set is_free = false where mission_slug = 'excel-sum-101'`); // a paid mission keeps the limit
      const results: Row[] = [];
      for (let i = 0; i < 4; i++) results.push((await step<{ r: Row }>(service, rec, [L1, 'excel-sum-101', 50, false]))[0]!.r);
      const n = await step<Row>('postgres', `select count(*)::int as n from public.assessment_attempts where user_id = '${L1}'`);
      return { results, n: n[0]!.n };
    });
    expect(out.results.map((r) => r.saved)).toEqual([true, true, true, false]);
    expect(out.results[3]).toMatchObject({ reason: 'attempt_limit' });
    expect(out.n).toBe(3);
  });

  it('PROG-T04b a FREE mission has unlimited attempts: ten failures and then a pass are all stored and the step completes', async () => {
    const out = await db.scenario(async (step) => {
      await step('postgres', `insert into app_private.mission_access (mission_slug, is_free) values ('excel-sum-101', true) on conflict (mission_slug) do update set is_free = true`);
      const results: Row[] = [];
      for (let i = 0; i < 10; i++) results.push((await step<{ r: Row }>(service, rec, [L1, 'excel-sum-101', 50, false]))[0]!.r);
      const last = (await step<{ r: Row }>(service, rec, [L1, 'excel-sum-101', 100, true]))[0]!.r;
      const n = await step<Row>('postgres', `select count(*)::int as n from public.assessment_attempts where user_id = '${L1}'`);
      const done = await step<Row>('postgres', `select count(*)::int as n from public.step_progress where user_id = '${L1}' and status = 'completed'`);
      return { results, last, n: n[0]!.n, done: done[0]!.n };
    });
    expect(out.results.every((r) => r.saved === true)).toBe(true);
    expect(out.last).toMatchObject({ saved: true, attemptNo: 11, passed: true });
    expect(out.n).toBe(11);
    expect(out.done).toBe(1);
  });

  it('PROG-T05 an exercise verdict is stored; a pass completes the simulation step', async () => {
    const out = await db.scenario(async (step) => {
      await step(service, recX, [L1, 'sum-relative-refs', '{"cells":{"B5":"=SUM(B2:B4)"}}', false, 50, 'v1']);
      const afterFail = await step<Row>('postgres', `select count(*)::int as n from public.step_progress where user_id = '${L1}'`);
      await step(service, recX, [L1, 'sum-relative-refs', '{"cells":{"B5":"=SUM(B2:B4)","C5":"=SUM(C2:C4)"}}', true, 100, 'v1']);
      const att = await step<Row>('postgres', `select status, passed from public.exercise_attempts where user_id = '${L1}' order by submitted_at, id`);
      const prog = await step<Row>('postgres', `select ms.kind from public.step_progress sp join public.mission_steps ms on ms.id = sp.mission_step_id where sp.user_id = '${L1}'`);
      return { fail: afterFail[0]!.n, att, prog };
    });
    expect(out.fail).toBe(0);
    expect(out.att.map((a) => a.status).sort()).toEqual(['rejected', 'validated']);
    expect(out.prog).toEqual([{ kind: 'simulation' }]);
  });

  it('PROG-T06 unknown mission, exercise or user is reported and leaves nothing behind', async () => {
    const out = await db.scenario(async (step) => {
      const a = await step<{ r: Row }>(service, rec, [L1, 'no-such-mission', 90, true]);
      const b = await step<{ r: Row }>(service, recX, [L1, 'no-such-exercise', '{}', true, 100, 'v1']);
      const c = await step<{ r: Row }>(service, rec, [GHOST, 'excel-sum-101', 90, true]);
      const n = await step<Row>('postgres', `select (select count(*) from public.enrolments where user_id in ('${L1}', '${GHOST}'))::int as n`);
      return { a: a[0]!.r, b: b[0]!.r, c: c[0]!.r, n: n[0]!.n };
    });
    expect(out.a).toMatchObject({ saved: false, reason: 'unknown_mission' });
    expect(out.b).toMatchObject({ saved: false, reason: 'unknown_exercise' });
    expect(out.c).toMatchObject({ saved: false, reason: 'unknown_user' });
    expect(out.n).toBe(0);
  });

  it('PROG-T07 each learner reads only their own saved progress, and every record is audited', async () => {
    const out = await db.scenario(async (step) => {
      await step(service, rec, [L1, 'excel-sum-101', 90, true]);
      await step(service, rec, [L2, 'excel-sum-101', 30, false]);
      const mine = await step<Row>(user(L1), `select count(*)::int as n from public.assessment_attempts`);
      const theirs = await step<Row>(user(L2), `select user_id from public.assessment_attempts`);
      const steps1 = await step<Row>(user(L1), `select count(*)::int as n from public.step_progress`);
      const steps2 = await step<Row>(user(L2), `select count(*)::int as n from public.step_progress`);
      const audit = await step<Row>('postgres', `select count(*)::int as n from app_private.audit_log where action = 'assessment_graded'`);
      return { mine: mine[0]!.n, theirs, steps1: steps1[0]!.n, steps2: steps2[0]!.n, audit: audit[0]!.n };
    });
    expect(out.mine).toBe(1);
    expect(out.theirs).toEqual([{ user_id: L2 }]);
    expect(out.steps1).toBe(1);
    expect(out.steps2).toBe(0);
    expect(out.audit).toBe(2);
  });
});
