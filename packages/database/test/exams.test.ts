// EXM-T01..T09: certificate exams (migration 20261125000100, ADR-016 stage 3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000600${n}`;
const L1 = id('1');
const L2 = id('2');
const ADMIN = id('3');
const plan = { tasks: [{ kind: 'sheet', slug: 'x', seed: 1 }] };

const start = (u: string, level = 'beginner') => `select public.fd_exam_start('${u}'::uuid, '${level}', '${JSON.stringify(plan)}'::jsonb) as r`;
const finish = (u: string, a: string, passed: boolean) =>
  `select public.fd_exam_finish('${u}'::uuid, '${a}'::uuid, '{"a":1}'::jsonb, '{"pastes":2}'::jsonb, '{"passed":${passed},"score":0.8}'::jsonb, 'Ada Learner') as r`;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local'), ('${ADMIN}', 'ad@t.local');
     insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

const one = (rows: { r: unknown }[]) => rows[0]!.r as Row;

describe('EXM exams', () => {
  it('EXM-T01 only service_role may call the exam functions', async () => {
    for (const who of [anon, user(L1)]) {
      await expect(db.as(who, `select public.fd_exam_state($1::uuid, 'beginner')`, [L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_exam_get($1::uuid, $1::uuid)`, [L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_certificate_verify('FD-B-26-0000000000')`)).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_admin_exam_attempts($1::uuid)`, [L1])).rejects.toThrow(DENIED);
    }
  });

  it('EXM-T02 one open attempt at a time; the clock is the database clock', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L1)));
      const b = one(await step<{ r: Row }>(service, start(L1)));
      const g = one(await step<{ r: Row }>(service, `select public.fd_exam_get('${L1}'::uuid, '${a.attemptId}'::uuid) as r`));
      return { a, b, g };
    });
    expect(r.a.ok).toBe(true);
    expect(r.b).toMatchObject({ ok: false, reason: 'open_attempt' });
    expect(Number(r.g.secondsLeft)).toBeGreaterThan(1700);
    expect(Number(r.g.secondsLeft)).toBeLessThanOrEqual(1800);
  });

  it('EXM-T03 another person cannot read or change my attempt', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L1)));
      const g = one(await step<{ r: Row }>(service, `select public.fd_exam_get('${L2}'::uuid, '${a.attemptId}'::uuid) as r`));
      const s = one(await step<{ r: Row }>(service, `select public.fd_exam_save('${L2}'::uuid, '${a.attemptId}'::uuid, '{}'::jsonb) as r`));
      return { g, s };
    });
    expect(r.g).toMatchObject({ ok: false, reason: 'not_found' });
    expect(r.s).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('EXM-T04 hints: budget of 2, the same hint twice is free', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L1)));
      const h = (t: number, n: number) => step<{ r: Row }>(service, `select public.fd_exam_hint('${L1}'::uuid, '${a.attemptId}'::uuid, ${t}, ${n}) as r`).then(one);
      return { h1: await h(0, 0), h1b: await h(0, 0), h2: await h(1, 0), h3: await h(2, 0) };
    });
    expect(r.h1).toMatchObject({ ok: true, charged: true, hintsLeft: 1 });
    expect(r.h1b).toMatchObject({ ok: true, charged: false, hintsLeft: 1 });
    expect(r.h2).toMatchObject({ ok: true, charged: true, hintsLeft: 0 });
    expect(r.h3).toMatchObject({ ok: false, reason: 'no_hints_left' });
  });

  it('EXM-T05 after the deadline saving is refused and a pass is turned into expired', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L1)));
      await step(service, `update app_private.exam_attempt set deadline_at = now() - interval '1 minute' where id = '${a.attemptId}'`);
      const s = one(await step<{ r: Row }>(service, `select public.fd_exam_save('${L1}'::uuid, '${a.attemptId}'::uuid, '{"x":1}'::jsonb) as r`));
      const f = one(await step<{ r: Row }>(service, finish(L1, String(a.attemptId), true)));
      const st = one(await step<{ r: Row }>(service, `select public.fd_exam_state('${L1}'::uuid, 'beginner') as r`));
      return { s, f, st };
    });
    expect(r.s).toMatchObject({ ok: false, reason: 'time_up' });
    expect(r.f).toMatchObject({ ok: true, status: 'expired', late: true });
    expect(r.f.certificateNumber).toBeNull();
    expect(r.st.certificate).toBeNull();
  });

  it('EXM-T06 three tries with a 24 hour gap, then no tries left', async () => {
    const r = await db.scenario(async (step) => {
      const out: Row[] = [];
      for (let i = 0; i < 3; i++) {
        const a = one(await step<{ r: Row }>(service, start(L1)));
        out.push(a);
        await step(service, finish(L1, String(a.attemptId), false).replace('select', 'select'));
        const wait = one(await step<{ r: Row }>(service, start(L1)));
        out.push(wait);
        await step(service, `update app_private.exam_attempt set submitted_at = now() - interval '25 hours' where user_id = '${L1}'`);
      }
      return out;
    });
    expect(r[0]).toMatchObject({ ok: true });
    expect(r[1]).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(r[2]).toMatchObject({ ok: true });
    expect(r[4]).toMatchObject({ ok: true });
    expect(r[5]).toMatchObject({ ok: false, reason: 'no_tries_left' });
  });

  it('EXM-T07 a pass issues one certificate, verifiable by number, no further exam for that level', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L1)));
      const f = one(await step<{ r: Row }>(service, finish(L1, String(a.attemptId), true)));
      const v = one(await step<{ r: Row }>(service, `select public.fd_certificate_verify('${String(f.certificateNumber).toLowerCase()}') as r`));
      const again = one(await step<{ r: Row }>(service, start(L1)));
      const mine = (await step<{ r: unknown }>(service, `select public.fd_certificates_of('${L1}'::uuid) as r`))[0]!.r as Row[];
      const bad = one(await step<{ r: Row }>(service, `select public.fd_certificate_verify('FD-B-26-FFFFFFFFFF') as r`));
      return { f, v, again, mine, bad };
    });
    expect(r.f).toMatchObject({ ok: true, status: 'passed' });
    expect(String(r.f.certificateNumber)).toMatch(/^FD-B-\d{2}-[0-9A-F]{10}$/);
    expect(r.v).toMatchObject({ ok: true, level: 'beginner', holder: 'Ada Learner', revoked: false });
    expect(JSON.stringify(r.v)).not.toContain('l1@t.local');
    expect(r.again).toMatchObject({ ok: false, reason: 'already_certified' });
    expect(r.mine).toHaveLength(1);
    expect(r.bad).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('EXM-T08 only an admin can change the rules, see attempts, or revoke', async () => {
    const r = await db.scenario(async (step) => {
      const a = one(await step<{ r: Row }>(service, start(L2, 'advanced')));
      const f = one(await step<{ r: Row }>(service, finish(L2, String(a.attemptId), true)));
      const no = one(await step<{ r: Row }>(service, `select public.fd_admin_exam_attempts('${L1}'::uuid) as r`));
      const noSet = one(await step<{ r: Row }>(service, `select public.fd_admin_exam_set('${L1}'::uuid, 'advanced', true, 20, 2, 3, 24, 70, 3, 6) as r`));
      const set = one(await step<{ r: Row }>(service, `select public.fd_admin_exam_set('${ADMIN}'::uuid, 'advanced', true, 20, 2, 3, 24, 70, 3, 6) as r`));
      const bad = one(await step<{ r: Row }>(service, `select public.fd_admin_exam_set('${ADMIN}'::uuid, 'advanced', true, 1, 2, 3, 24, 70, 3, 6) as r`));
      const list = one(await step<{ r: Row }>(service, `select public.fd_admin_exam_attempts('${ADMIN}'::uuid) as r`));
      const rev = one(await step<{ r: Row }>(service, `select public.fd_admin_certificate_revoke('${ADMIN}'::uuid, '${f.certificateNumber}', 'test') as r`));
      const v = one(await step<{ r: Row }>(service, `select public.fd_certificate_verify('${f.certificateNumber}') as r`));
      return { no, noSet, set, bad, list, rev, v };
    });
    expect(r.no).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.noSet).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.set).toMatchObject({ ok: true });
    expect(r.bad).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect((r.list.attempts as Row[]).length).toBeGreaterThan(0);
    expect(r.rev).toMatchObject({ ok: true });
    expect(r.v).toMatchObject({ ok: true, revoked: true });
  });

  it('EXM-T09 a disabled level cannot be started', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, `update app_private.exam_config set enabled = false where level = 'intermediate'`);
      return one(await step<{ r: Row }>(service, start(L2, 'intermediate')));
    });
    expect(r).toMatchObject({ ok: false, reason: 'disabled' });
  });
});
