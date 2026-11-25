// ENR-T01..T04: explicit enrolment (migration 20261125000600). Guest until the first enrolment; idempotent; server-only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const LEARNER = '00000000-0000-4000-8000-000000005001';
const SUSPENDED = '00000000-0000-4000-8000-000000005002';
const enrol = `select public.fd_enrol($1::uuid, $2) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
let slug = '';
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${LEARNER}', 'e1@t.local'), ('${SUSPENDED}', 'e2@t.local');
     insert into app_private.user_status (user_id, status) values ('${SUSPENDED}', 'suspended');`,
  );
  slug = (await db.scenario(async (step) => (await step<{ slug: string }>(service, `select slug from public.courses where status = 'published' order by slug limit 1`))[0]!.slug));
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('ENR-T01..T04 enrolment', () => {
  it('ENR-T01 only service_role may call it', async () => {
    for (const who of [anon, user(LEARNER)]) await expect(db.as(who, enrol, [LEARNER, slug])).rejects.toThrow(DENIED);
  });

  it('ENR-T02 the first enrolment creates one active row and one audit entry; enrolling again changes nothing', async () => {
    const r = await db.scenario(async (step) => {
      const before = await step<{ n: number }>(service, `select count(*)::int as n from public.enrolments where user_id = '${LEARNER}'`);
      const first = out(await step<{ r: Row }>(service, enrol, [LEARNER, slug]));
      const again = out(await step<{ r: Row }>(service, enrol, [LEARNER, slug]));
      const rows = await step<{ status: string }>(service, `select status from public.enrolments where user_id = '${LEARNER}'`);
      const audit = await step<{ n: number }>(service, `select count(*)::int as n from app_private.audit_log where action = 'enrol' and actor_id = '${LEARNER}'`);
      return { before: before[0]!.n, first, again, rows, audit: audit[0]!.n };
    });
    expect(r.before).toBe(0);
    expect(r.first).toMatchObject({ ok: true, already: false });
    expect(r.again).toMatchObject({ ok: true, already: true });
    expect(r.rows).toEqual([{ status: 'active' }]);
    expect(r.audit).toBe(1);
  });

  it('ENR-T03 bad input, an unknown course and a suspended account are refused', async () => {
    const r = await db.scenario(async (step) => ({
      bad: out(await step<{ r: Row }>(service, enrol, [LEARNER, 'Bad Slug'])),
      none: out(await step<{ r: Row }>(service, enrol, [LEARNER, 'no-such-course'])),
      ghost: out(await step<{ r: Row }>(service, enrol, ['00000000-0000-4000-8000-000000009999', slug])),
      susp: out(await step<{ r: Row }>(service, enrol, [SUSPENDED, slug])),
    }));
    expect(r.bad).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.none).toMatchObject({ ok: false, reason: 'not_found' });
    expect(r.ghost).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.susp).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('ENR-T04 a learner can read their own enrolment but nobody else’s', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, enrol, [LEARNER, slug]);
      const own = await db.as(user(LEARNER), `select count(*)::int as n from public.enrolments`, []);
      const other = await db.as(user(SUSPENDED), `select count(*)::int as n from public.enrolments`, []);
      return { own: (own as { n: number }[])[0]!.n, other: (other as { n: number }[])[0]!.n };
    });
    expect(r.own).toBe(1);
    expect(r.other).toBe(0);
  });
});
