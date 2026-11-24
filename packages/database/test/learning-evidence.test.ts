// EVD-T01..T05: active time per mission and fast-pass review flags (migration 20261124001400, ADR-012 stage 2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000400${n}`;
const ADMIN = id('1');
const L1 = id('2');
const L2 = id('3');
const A = 'excel-sum-101';

const beat = `select public.fd_activity_heartbeat($1::uuid, $2, $3::integer) as r`;
const flags = `select public.fd_admin_review_flags($1::uuid, $2::integer, $3::integer) as r`;
const mtime = `select public.fd_admin_user_mission_time($1::uuid, $2::uuid) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;
const secs = `select coalesce(sum(seconds), 0)::int as n from app_private.mission_time where user_id = $1`;
const pass = (u: string) =>
  `insert into public.assessment_attempts (user_id, assessment_id, status, submitted_at, graded_at, score, passed)
   select '${u}', s.id, 'graded', now(), now(), 90, true from public.assessments s where s.slug = '${A}-assessment' limit 1`;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${ADMIN}', 'a@t.local'), ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local');
     insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('EVD-T01..T05 learning evidence', () => {
  it('EVD-T01 only service_role may record or read evidence', async () => {
    for (const who of [anon, user(L1), user(ADMIN)]) {
      await expect(db.as(who, beat, [L1, A, 10])).rejects.toThrow(DENIED);
      await expect(db.as(who, flags, [ADMIN, 30, 180])).rejects.toThrow(DENIED);
      await expect(db.as(who, mtime, [ADMIN, L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select * from app_private.mission_time`)).rejects.toThrow(DENIED);
    }
  });

  it('EVD-T02 bad input and unknown missions or users are refused quietly', async () => {
    const r = await db.scenario(async (step) => ({
      noUser: out(await step<{ r: Row }>(service, beat, [null, A, 10])),
      noSlug: out(await step<{ r: Row }>(service, beat, [L1, null, 10])),
      unknown: out(await step<{ r: Row }>(service, beat, [L1, 'no-such-mission', 10])),
      ghost: out(await step<{ r: Row }>(service, beat, ['00000000-0000-4000-8000-0000000fffff', A, 10])),
    }));
    expect(r.noUser).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.noSlug).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.unknown).toMatchObject({ ok: false, reason: 'unknown_mission' });
    expect(r.ghost).toMatchObject({ ok: false, reason: 'unknown_user' });
  });

  it('EVD-T03 time only accrues as fast as the clock: spamming heartbeats earns almost nothing', async () => {
    const r = await db.scenario(async (step) => {
      const first = out(await step<{ r: Row }>(service, beat, [L1, A, 30]));
      for (let i = 0; i < 20; i++) await step(service, beat, [L1, A, 30]); // same instant: no real time has passed
      const spam = (await step<{ n: number }>(service, secs, [L1]))[0]!.n;
      await step(service, `update app_private.mission_time set last_beat = now() - interval '20 seconds' where user_id = '${L1}'`);
      const honest = out(await step<{ r: Row }>(service, beat, [L1, A, 30]));
      const after = (await step<{ n: number }>(service, secs, [L1]))[0]!.n;
      return { first, spam, honest, after };
    });
    expect(r.first).toMatchObject({ ok: true, added: 5 });
    expect(r.spam).toBeLessThanOrEqual(5 + 21 * 2); // at most the 2s slack per call
    expect(r.honest).toMatchObject({ ok: true, added: 22 });
    expect(r.after).toBeGreaterThan(r.spam);
  });

  it('EVD-T04 a mission counts at most 4 hours a day', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, beat, [L2, A, 5]);
      await step(service, `update app_private.mission_time set seconds = 14395, last_beat = now() - interval '1 minute' where user_id = '${L2}'`);
      await step(service, beat, [L2, A, 30]);
      return (await step<{ n: number }>(service, secs, [L2]))[0]!.n;
    });
    expect(r).toBe(14400);
  });

  it('EVD-T05 passes with little or no recorded time are flagged; enough time is not; admin-only', async () => {
    const r = await db.scenario(async (step) => {
      await step('postgres', pass(L1)); // no time at all
      await step('postgres', pass(L2));
      await step(service, `insert into app_private.mission_time (user_id, mission_slug, day, seconds) values ('${L2}', '${A}', app_private.nairobi_day(), 600)`);
      const forbidden = out(await step<{ r: Row }>(service, flags, [L1, 30, 180]));
      const f = out(await step<{ r: Row }>(service, flags, [ADMIN, 30, 180]));
      const strict = out(await step<{ r: Row }>(service, flags, [ADMIN, 30, 3600]));
      const per = out(await step<{ r: Row }>(service, mtime, [ADMIN, L2]));
      return { forbidden, f, strict, per };
    });
    expect(r.forbidden).toMatchObject({ ok: false, reason: 'forbidden' });
    const list = r.f.flags as Row[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: L1, slug: A, reason: 'no_time', seconds: 0 });
    expect((r.strict.flags as Row[]).map((x) => x.userId).sort()).toEqual([L1, L2].sort());
    expect((r.strict.flags as Row[]).find((x) => x.userId === L2)).toMatchObject({ reason: 'fast', seconds: 600 });
    expect((r.per.missions as Row[])[0]).toMatchObject({ slug: A, seconds: 600 });
  });
});
