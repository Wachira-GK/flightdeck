// ACC-T01..T07: mission access control (migration 20261124001000, ADR-011).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000100${n}`;
const MASTER = id('1');
const ADMIN = id('2');
const L1 = id('3');
const L2 = id('4');
const AUTHOR = id('5');
const SUSPENDED_ADMIN = id('6');
const A = 'excel-sum-101';
const B = 'excel-if-102';
const C = 'excel-lookup-103';

const access = `select public.fd_mission_access($1::uuid, $2) as r`;
const setM = `select public.fd_admin_set_mission($1::uuid, $2, $3::boolean, $4::boolean) as r`;
const unlock = `select public.fd_admin_set_unlocks($1::uuid, $2::uuid, $3::text[], $4::boolean) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${MASTER}', 'm@t.local'), ('${ADMIN}', 'a@t.local'), ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local'), ('${AUTHOR}', 'au@t.local'), ('${SUSPENDED_ADMIN}', 'sa@t.local');
     insert into public.user_roles (user_id, role) values ('${MASTER}', 'admin'), ('${ADMIN}', 'admin'), ('${AUTHOR}', 'author'), ('${SUSPENDED_ADMIN}', 'admin');
     insert into app_private.platform_owner (user_id) values ('${MASTER}');
     insert into app_private.user_status (user_id, status) values ('${SUSPENDED_ADMIN}', 'suspended');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('ACC-T01..T07 mission access', () => {
  it('ACC-T01 only service_role may run any of the access functions', async () => {
    for (const who of [anon, user(L1), user(ADMIN)]) {
      await expect(db.as(who, access, [L1, A])).rejects.toThrow(DENIED);
      await expect(db.as(who, setM, [ADMIN, A, true, true])).rejects.toThrow(DENIED);
      await expect(db.as(who, unlock, [ADMIN, L1, [A], true])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_admin_mission_list($1::uuid) as r`, [ADMIN])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_access_summary($1::uuid) as r`, [L1])).rejects.toThrow(DENIED);
    }
  });

  it('ACC-T02 by default a mission is locked for learners and visitors; unknown slugs are unknown', async () => {
    const r = await db.scenario(async (step) => ({
      visitor: out(await step<{ r: string }>(service, access, [null, A])),
      learner: out(await step<{ r: string }>(service, access, [L1, A])),
      unknown: out(await step<{ r: string }>(service, access, [L1, 'no-such-mission'])),
    }));
    expect(r).toEqual({ visitor: 'locked', learner: 'locked', unknown: 'unknown' });
  });

  it('ACC-T03 a free mission is open to everyone, including visitors; others stay locked', async () => {
    const r = await db.scenario(async (step) => {
      const set = await step<{ r: Row }>(service, setM, [ADMIN, A, true, true]);
      return {
        set: out(set),
        visitor: out(await step<{ r: string }>(service, access, [null, A])),
        learner: out(await step<{ r: string }>(service, access, [L1, A])),
        other: out(await step<{ r: string }>(service, access, [L1, B])),
      };
    });
    expect(r.set).toMatchObject({ ok: true });
    expect(r).toMatchObject({ visitor: 'open', learner: 'open', other: 'locked' });
  });

  it('ACC-T04 an unlock opens one mission for one learner only, and can be removed', async () => {
    const r = await db.scenario(async (step) => {
      const grant = await step<{ r: Row }>(service, unlock, [ADMIN, L1, [B, C], true]);
      const l1 = out(await step<{ r: string }>(service, access, [L1, B]));
      const l2 = out(await step<{ r: string }>(service, access, [L2, B]));
      const visitor = out(await step<{ r: string }>(service, access, [null, B]));
      const revoke = await step<{ r: Row }>(service, unlock, [ADMIN, L1, [B], false]);
      const after = out(await step<{ r: string }>(service, access, [L1, B]));
      const still = out(await step<{ r: string }>(service, access, [L1, C]));
      const audit = await step<Row>('postgres', `select action from app_private.audit_log where action in ('admin_unlock_missions','admin_lock_missions') order by id`);
      return { grant: out(grant), l1, l2, visitor, revoke: out(revoke), after, still, audit };
    });
    expect(r.grant).toMatchObject({ ok: true, changed: 2 });
    expect(r).toMatchObject({ l1: 'open', l2: 'locked', visitor: 'locked', after: 'locked', still: 'open' });
    expect(r.revoke).toMatchObject({ ok: true, changed: 1 });
    expect(r.audit).toEqual([{ action: 'admin_unlock_missions' }, { action: 'admin_lock_missions' }]);
  });

  it('ACC-T05 switching a mission off closes it for learners (even free or unlocked) and visitors; admins still open it', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, setM, [ADMIN, A, true, false]);
      await step(service, setM, [ADMIN, C, false, false]);
      return {
        freeOff: out(await step<{ r: string }>(service, access, [L1, A])),
        visitorOff: out(await step<{ r: string }>(service, access, [null, A])),
        unlockedOff: out(await step<{ r: string }>(service, access, [L1, C])),
        authorOff: out(await step<{ r: string }>(service, access, [AUTHOR, A])),
        adminOff: out(await step<{ r: string }>(service, access, [ADMIN, A])),
      };
    });
    expect(r).toEqual({ freeOff: 'disabled', visitorOff: 'disabled', unlockedOff: 'disabled', authorOff: 'disabled', adminOff: 'open' });
  });

  it('ACC-T06 staff (author, admin) open every enabled mission; a suspended admin does not', async () => {
    const r = await db.scenario(async (step) => ({
      author: out(await step<{ r: string }>(service, access, [AUTHOR, B])),
      admin: out(await step<{ r: string }>(service, access, [ADMIN, B])),
      suspended: out(await step<{ r: string }>(service, access, [SUSPENDED_ADMIN, B])),
    }));
    expect(r).toEqual({ author: 'open', admin: 'open', suspended: 'locked' });
  });

  it('ACC-T07 only active admins may change access; bad input is refused; the summary lists the switches', async () => {
    const r = await db.scenario(async (step) => {
      const learner = out(await step<{ r: Row }>(service, setM, [L1, A, true, true]));
      const suspended = out(await step<{ r: Row }>(service, setM, [SUSPENDED_ADMIN, A, true, true]));
      const nullActor = out(await step<{ r: Row }>(service, setM, [null, A, true, true]));
      const badSlug = out(await step<{ r: Row }>(service, setM, [ADMIN, 'no-such-mission', true, true]));
      const nullFlag = out(await step<{ r: Row }>(service, setM, [ADMIN, A, null, true]));
      const unlockLearner = out(await step<{ r: Row }>(service, unlock, [L1, L2, [B], true]));
      const unlockBad = out(await step<{ r: Row }>(service, unlock, [ADMIN, L2, ['no-such-mission'], true]));
      const unlockEmpty = out(await step<{ r: Row }>(service, unlock, [ADMIN, L2, [], true]));
      const unlockGhost = out(await step<{ r: Row }>(service, unlock, [ADMIN, id('f'), [B], true]));
      const list = out(await step<{ r: Row }>(service, `select public.fd_admin_mission_list($1::uuid) as r`, [ADMIN]));
      const listLearner = out(await step<{ r: Row }>(service, `select public.fd_admin_mission_list($1::uuid) as r`, [L1]));
      await step(service, setM, [ADMIN, A, true, true]);
      await step(service, setM, [ADMIN, C, false, false]);
      await step(service, unlock, [ADMIN, L1, [B], true]);
      const summary = out(await step<{ r: Row }>(service, `select public.fd_access_summary($1::uuid) as r`, [L1]));
      return { learner, suspended, nullActor, badSlug, nullFlag, unlockLearner, unlockBad, unlockEmpty, unlockGhost, list, listLearner, summary };
    });
    for (const k of ['learner', 'suspended', 'nullActor'] as const) expect(r[k]).toMatchObject({ ok: false, reason: 'forbidden' });
    for (const k of ['badSlug', 'nullFlag', 'unlockBad', 'unlockEmpty'] as const) expect(r[k]).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.unlockLearner).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.unlockGhost).toMatchObject({ ok: false, reason: 'unknown_user' });
    const missions = (r.list as { missions: { slug: string }[] }).missions;
    expect(r.list).toMatchObject({ ok: true });
    expect(missions.length).toBeGreaterThanOrEqual(50);
    expect(r.listLearner).toMatchObject({ ok: false, reason: 'forbidden' });
    const s = r.summary as { staff: boolean; free: string[]; disabled: string[]; unlocked: string[] };
    expect(s.staff).toBe(false);
    expect(s.free).toContain(A);
    expect(s.disabled).toContain(C);
    expect(s.unlocked).toContain(B);
  });
});
