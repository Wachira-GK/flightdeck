// ACT-T01..T06: sign-in log and daily activity rollup (migration 20261124001200, ADR-012).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000200${n}`;
const MASTER = id('1');
const ADMIN = id('2');
const L1 = id('3');
const L2 = id('4');

const signIn = `select public.fd_activity_sign_in($1::uuid, $2) as r`;
const touch = `select public.fd_activity_touch($1::uuid) as r`;
const overview = `select public.fd_admin_activity_overview($1::uuid, $2::integer) as r`;
const userAct = `select public.fd_admin_user_activity($1::uuid, $2::uuid) as r`;
const purge = `select public.fd_activity_purge($1::integer) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${MASTER}', 'm@t.local'), ('${ADMIN}', 'a@t.local'), ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local');
     insert into public.user_roles (user_id, role) values ('${MASTER}', 'admin'), ('${ADMIN}', 'admin');
     insert into app_private.platform_owner (user_id) values ('${MASTER}');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('ACT-T01..T06 activity log and rollup', () => {
  it('ACT-T01 only service_role may record, read or purge activity', async () => {
    for (const who of [anon, user(L1), user(ADMIN)]) {
      await expect(db.as(who, signIn, [L1, 'password'])).rejects.toThrow(DENIED);
      await expect(db.as(who, touch, [L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, overview, [ADMIN, 30])).rejects.toThrow(DENIED);
      await expect(db.as(who, userAct, [ADMIN, L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, purge, [13])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select * from app_private.sign_in_event`)).rejects.toThrow(DENIED);
      await expect(db.as(who, `select * from app_private.activity_day`)).rejects.toThrow(DENIED);
    }
  });

  it('ACT-T02 a sign-in is logged once and rolls into today; bad input and unknown users are refused quietly', async () => {
    const r = await db.scenario(async (step) => {
      const a = out(await step<{ r: Row }>(service, signIn, [L1, 'password']));
      const b = out(await step<{ r: Row }>(service, signIn, [L1, 'google']));
      const bad = out(await step<{ r: Row }>(service, signIn, [L1, 'carrier-pigeon']));
      const none = out(await step<{ r: Row }>(service, signIn, [null, 'password']));
      const ghost = out(await step<{ r: Row }>(service, signIn, ['00000000-0000-4000-8000-0000000fffff', 'password']));
      const day = await step<{ sign_ins: number; visits: number }>(service, `select sign_ins, visits from app_private.activity_day where user_id = '${L1}'`);
      const events = await step<{ n: number }>(service, `select count(*)::int as n from app_private.sign_in_event where user_id = '${L1}'`);
      return { a, b, bad, none, ghost, day: day[0], events: events[0]!.n };
    });
    expect(r.a).toMatchObject({ ok: true });
    expect(r.b).toMatchObject({ ok: true });
    expect(r.bad).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.none).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.ghost).toMatchObject({ ok: false, reason: 'unknown_user' });
    expect(r.day).toMatchObject({ sign_ins: 2, visits: 0 });
    expect(r.events).toBe(2);
  });

  it('ACT-T03 page views: first counts as a visit, rapid repeats write nothing, a return after 30 quiet minutes is a new visit', async () => {
    const r = await db.scenario(async (step) => {
      const q = `select visits from app_private.activity_day where user_id = '${L2}'`;
      await step(service, touch, [L2]);
      const first = (await step<{ visits: number }>(service, q))[0]!.visits;
      await step(service, touch, [L2]);
      const rapid = (await step<{ visits: number }>(service, q))[0]!.visits;
      await step(service, `update app_private.activity_day set last_seen = now() - interval '5 minutes' where user_id = '${L2}'`);
      await step(service, touch, [L2]);
      const soon = (await step<{ visits: number }>(service, q))[0]!.visits;
      await step(service, `update app_private.activity_day set last_seen = now() - interval '45 minutes' where user_id = '${L2}'`);
      await step(service, touch, [L2]);
      const later = (await step<{ visits: number }>(service, q))[0]!.visits;
      return { first, rapid, soon, later };
    });
    expect(r).toEqual({ first: 1, rapid: 1, soon: 1, later: 2 });
  });

  it('ACT-T04 the overview is admin-only, gap-filled to the requested days (clamped 7..90) and ranks users', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, signIn, [L1, 'password']);
      await step(service, touch, [L2]);
      const forbidden = out(await step<{ r: Row }>(service, overview, [L1, 30]));
      const o = out(await step<{ r: Row }>(service, overview, [ADMIN, 30]));
      const small = out(await step<{ r: Row }>(service, overview, [ADMIN, 1]));
      const big = out(await step<{ r: Row }>(service, overview, [ADMIN, 9999]));
      return { forbidden, o, small, big };
    });
    expect(r.forbidden).toMatchObject({ ok: false, reason: 'forbidden' });
    const days = r.o.days as Row[];
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toMatchObject({ activeUsers: 2 });
    expect(days[0]).toMatchObject({ activeUsers: 0, signIns: 0, visits: 0 });
    expect(r.o.activeUsers).toBe(2);
    expect((r.o.topUsers as Row[]).map((u) => u.userId).sort()).toEqual([L1, L2].sort());
    expect(r.small.days as Row[]).toHaveLength(7);
    expect(r.big.days as Row[]).toHaveLength(90);
  });

  it('ACT-T05 per-user view: admin-only, counts and recent sign-ins, unknown users reported', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, signIn, [L1, 'password']);
      await step(service, signIn, [L1, 'google']);
      return {
        forbidden: out(await step<{ r: Row }>(service, userAct, [L1, L1])),
        unknown: out(await step<{ r: Row }>(service, userAct, [ADMIN, '00000000-0000-4000-8000-0000000fffff'])),
        mine: out(await step<{ r: Row }>(service, userAct, [ADMIN, L1])),
        master: out(await step<{ r: Row }>(service, userAct, [ADMIN, MASTER])),
        quiet: out(await step<{ r: Row }>(service, userAct, [ADMIN, L2])),
      };
    });
    expect(r.forbidden).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.unknown).toMatchObject({ ok: false, reason: 'unknown_user' });
    expect(r.mine).toMatchObject({ ok: true, signIns7: 2, signIns30: 2, daysActive30: 1 });
    expect(r.mine.recent as Row[]).toHaveLength(2);
    expect(r.master).toMatchObject({ ok: true, signIns7: 0 });
    expect(r.quiet).toMatchObject({ ok: true, signIns30: 0, firstSeen: null });
  });

  it('ACT-T06 purge removes only old activity, keeps at least 3 months, and leaves an audit entry', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, signIn, [L1, 'password']);
      await step(service, `insert into app_private.sign_in_event (user_id, at, method) values ('${L1}', now() - interval '20 months', 'password')`);
      await step(service, `insert into app_private.activity_day (user_id, day, sign_ins) values ('${L1}', (now() - interval '20 months')::date, 1)`);
      const tooShort = out(await step<{ r: Row }>(service, purge, [0]));
      const kept = (await step<{ n: number }>(service, `select count(*)::int as n from app_private.sign_in_event`))[0]!.n;
      const done = out(await step<{ r: Row }>(service, purge, [13]));
      const left = (await step<{ n: number }>(service, `select count(*)::int as n from app_private.sign_in_event`))[0]!.n;
      const days = (await step<{ n: number }>(service, `select count(*)::int as n from app_private.activity_day`))[0]!.n;
      const audit = await step<{ detail: Row }>(service, `select detail from app_private.audit_log where action = 'activity_purge' order by id desc limit 1`);
      return { tooShort, kept, done, left, days, audit: audit[0] };
    });
    expect(r.tooShort).toMatchObject({ ok: true, events: 1 }); // 0 is raised to 3 months, so only the 20-month row goes
    expect(r.kept).toBe(1);
    expect(r.done).toMatchObject({ ok: true, events: 0 });
    expect(r.left).toBe(1);
    expect(r.days).toBe(1);
    expect(r.audit?.detail).toMatchObject({ keepMonths: 13 });
  });
});
