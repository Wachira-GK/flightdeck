// ADM-T01..T12: user administration (migration 20261123000800, ADR-009).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000080${n}`;
const MASTER = id('1');
const ADMIN_A = id('2');
const ADMIN_B = id('3');
const LEARNER = id('4');
const LEARNER2 = id('5');
const GHOST = id('f');
const VERIFIER = 'A'.repeat(43);

let db: Db;
beforeAll(async () => {
  db = await createDb('');
  await db.pg.exec(
    `insert into auth.users (id, email) values
       ('${MASTER}', 'master@test.local'), ('${ADMIN_A}', 'a@test.local'), ('${ADMIN_B}', 'b@test.local'),
       ('${LEARNER}', 'l@test.local'), ('${LEARNER2}', 'l2@test.local');
     insert into public.user_roles (user_id, role) values ('${MASTER}', 'admin'), ('${ADMIN_A}', 'admin'), ('${ADMIN_B}', 'admin'), ('${ADMIN_B}', 'reviewer');
     insert into app_private.platform_owner (user_id) values ('${MASTER}');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

const roles = `select public.fd_admin_set_roles($1::uuid, $2::uuid, $3::text[], $4) as r`;
const status = `select public.fd_admin_set_status($1::uuid, $2::uuid, $3, $4) as r`;
const name = `select public.fd_admin_set_name($1::uuid, $2::uuid, $3) as r`;
const begin = `select public.fd_admin_reset_begin($1::uuid, $2::uuid, $3) as r`;
const detail = `select public.fd_admin_user_detail($1::uuid, $2::uuid) as r`;
const facts = `select public.fd_admin_user_facts($1::uuid, $2::uuid[]) as r`;
const first = (rows: { r: Row }[]) => rows[0]!.r;

describe('ADM-T01..T12 user administration', () => {
  it('ADM-T01 only service_role may execute the admin functions, even for an admin user', async () => {
    for (const who of [anon, user(ADMIN_A), user(MASTER)]) {
      await expect(db.as(who, roles, [ADMIN_A, LEARNER, ['author'], null])).rejects.toThrow(DENIED);
      await expect(db.as(who, facts, [ADMIN_A, [LEARNER]])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_reset_handoff_take('${GHOST}'::uuid)`)).rejects.toThrow(DENIED);
    }
  });

  it('ADM-T02 a learner, an unknown actor or a missing actor is refused everywhere', async () => {
    for (const actor of [LEARNER, GHOST, null]) {
      expect(first(await db.as(service, roles, [actor, LEARNER2, ['author'], null]))).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(first(await db.as(service, status, [actor, LEARNER2, 'suspended', null]))).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(first(await db.as(service, name, [actor, LEARNER2, 'X']))).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(first(await db.as(service, begin, [actor, LEARNER2, VERIFIER]))).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(first(await db.as(service, detail, [actor, LEARNER2]))).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(first(await db.as(service, facts, [actor, [LEARNER2]]))).toMatchObject({ ok: false, reason: 'forbidden' });
    }
  });

  it('ADM-T03 an admin sets roles; learner is always kept; the change is audited with before and after', async () => {
    const out = await db.scenario(async (step) => {
      const r = await step<{ r: Row }>(service, roles, [ADMIN_A, LEARNER, ['author', 'reviewer'], 'content team']);
      const rows = await step<Row>('postgres', `select role::text as role, granted_by from public.user_roles where user_id = '${LEARNER}' order by role`);
      const audit = await step<Row>('postgres', `select detail from app_private.audit_log where action = 'admin_set_roles' and entity_id = '${LEARNER}'`);
      return { r: first(r), rows, audit };
    });
    expect(out.r).toMatchObject({ ok: true, roles: ['author', 'learner', 'reviewer'] });
    expect(out.rows.map((x) => x.role)).toEqual(['author', 'learner', 'reviewer']);
    expect(out.rows.find((x) => x.role === 'author')!.granted_by).toBe(ADMIN_A);
    expect(out.audit[0]!.detail).toMatchObject({ before: ['learner'], after: ['author', 'learner', 'reviewer'], reason: 'content team' });
  });

  it('ADM-T04 an unknown role is rejected and nothing changes', async () => {
    const out = await db.scenario(async (step) => {
      const r = await step<{ r: Row }>(service, roles, [ADMIN_A, LEARNER, ['author', 'superuser'], null]);
      const n = await step<Row>('postgres', `select count(*)::int as n from public.user_roles where user_id = '${LEARNER}'`);
      return { r: first(r), n: n[0]!.n };
    });
    expect(out.r).toMatchObject({ ok: false, reason: 'invalid_role' });
    expect(out.n).toBe(1);
  });

  it('ADM-T05 admins can promote and demote other admins (not themselves, not the master)', async () => {
    const out = await db.scenario(async (step) => {
      const promote = await step<{ r: Row }>(service, roles, [ADMIN_A, LEARNER, ['admin', 'support'], null]);
      const demote = await step<{ r: Row }>(service, roles, [ADMIN_A, ADMIN_B, ['reviewer'], null]);
      const left = await step<Row>('postgres', `select role::text as role from public.user_roles where user_id = '${ADMIN_B}' order by role`);
      return { promote: first(promote), demote: first(demote), left };
    });
    expect(out.promote).toMatchObject({ ok: true });
    expect(out.demote).toMatchObject({ ok: true, roles: ['learner', 'reviewer'] });
    expect(out.left.map((x) => x.role)).toEqual(['learner', 'reviewer']);
  });

  it('ADM-T06 nobody but the master can touch the master; even the master cannot change its own roles', async () => {
    const out = await db.scenario(async (step) => {
      const a = await step<{ r: Row }>(service, roles, [ADMIN_A, MASTER, ['learner'], null]);
      const b = await step<{ r: Row }>(service, status, [ADMIN_A, MASTER, 'suspended', null]);
      const c = await step<{ r: Row }>(service, name, [ADMIN_A, MASTER, 'Hijacked']);
      const d = await step<{ r: Row }>(service, begin, [ADMIN_A, MASTER, VERIFIER]);
      const e = await step<{ r: Row }>(service, roles, [MASTER, MASTER, ['learner'], null]);
      const f = await step<{ r: Row }>(service, name, [MASTER, MASTER, 'Master Admin']);
      const still = await step<Row>('postgres', `select role::text as role from public.user_roles where user_id = '${MASTER}'`);
      return { a: first(a), b: first(b), c: first(c), d: first(d), e: first(e), f: first(f), still };
    });
    for (const k of ['a', 'b', 'c', 'd'] as const) expect(out[k]).toMatchObject({ ok: false, reason: 'master_protected' });
    expect(out.e).toMatchObject({ ok: false, reason: 'master_protected' });
    expect(out.f).toMatchObject({ ok: true }); // the master may rename itself
    expect(out.still.map((x) => x.role).sort()).toEqual(['admin', 'learner']);
  });

  it('ADM-T07 an admin cannot change their own roles or status', async () => {
    const r1 = first(await db.as(service, roles, [ADMIN_A, ADMIN_A, ['admin', 'author'], null]));
    const r2 = first(await db.as(service, status, [ADMIN_A, ADMIN_A, 'suspended', null]));
    const r3 = first(await db.as(service, begin, [ADMIN_A, ADMIN_A, VERIFIER]));
    expect(r1).toMatchObject({ ok: false, reason: 'self_change' });
    expect(r2).toMatchObject({ ok: false, reason: 'self_change' });
    expect(r3).toMatchObject({ ok: false, reason: 'self_change' });
  });

  it('ADM-T08 suspending an admin removes their admin power; reactivating restores it; both audited', async () => {
    const out = await db.scenario(async (step) => {
      const s = await step<{ r: Row }>(service, status, [MASTER, ADMIN_B, 'suspended', 'left the team']);
      const blocked = await step<{ r: Row }>(service, roles, [ADMIN_B, LEARNER, ['author'], null]);
      const list = await step<{ r: { users: Row[] } }>(service, facts, [ADMIN_A, [ADMIN_B]]);
      const back = await step<{ r: Row }>(service, status, [MASTER, ADMIN_B, 'active', null]);
      const works = await step<{ r: Row }>(service, roles, [ADMIN_B, LEARNER, ['author'], null]);
      const audit = await step<Row>('postgres', `select count(*)::int as n from app_private.audit_log where action = 'admin_set_status'`);
      return { s: first(s), blocked: first(blocked), user: list[0]!.r.users[0], back: first(back), works: first(works), audit: audit[0]!.n };
    });
    expect(out.s).toMatchObject({ ok: true, status: 'suspended' });
    expect(out.blocked).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(out.user).toMatchObject({ status: 'suspended' });
    expect(out.back).toMatchObject({ ok: true });
    expect(out.works).toMatchObject({ ok: true });
    expect(out.audit).toBe(2);
  });

  it('ADM-T09 an invalid status or name is rejected; a valid name is saved and audited', async () => {
    const out = await db.scenario(async (step) => {
      const s = await step<{ r: Row }>(service, status, [ADMIN_A, LEARNER, 'banned', null]);
      const empty = await step<{ r: Row }>(service, name, [ADMIN_A, LEARNER, '   ']);
      const long = await step<{ r: Row }>(service, name, [ADMIN_A, LEARNER, 'x'.repeat(81)]);
      const ok = await step<{ r: Row }>(service, name, [ADMIN_A, LEARNER, '  Wanjiku K  ']);
      const row = await step<Row>('postgres', `select display_name from public.profiles where user_id = '${LEARNER}'`);
      return { s: first(s), empty: first(empty), long: first(long), ok: first(ok), row };
    });
    expect(out.s).toMatchObject({ reason: 'invalid_status' });
    expect(out.empty).toMatchObject({ reason: 'invalid_name' });
    expect(out.long).toMatchObject({ reason: 'invalid_name' });
    expect(out.ok).toMatchObject({ ok: true });
    expect(out.row).toEqual([{ display_name: 'Wanjiku K' }]);
  });

  it('ADM-T10 reset handoff: one verifier per link, used once, expires, rate-limited, audited', async () => {
    const out = await db.scenario(async (step) => {
      const b = await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER, VERIFIER]);
      const rid = first(b).rid as string;
      const t1 = await step<{ v: string | null }>(service, `select public.fd_reset_handoff_take($1::uuid) as v`, [rid]);
      const t2 = await step<{ v: string | null }>(service, `select public.fd_reset_handoff_take($1::uuid) as v`, [rid]);
      const bad = await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER2, 'short']);
      await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER2, VERIFIER]);
      await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER2, VERIFIER]);
      await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER2, VERIFIER]);
      const limited = await step<{ r: Row }>(service, begin, [ADMIN_A, LEARNER2, VERIFIER]);
      const exp = await step<{ r: Row }>(service, begin, [MASTER, ADMIN_B, VERIFIER]);
      await step('postgres', `update app_private.reset_handoff set expires_at = now() - interval '1 minute' where user_id = '${ADMIN_B}'`);
      const t3 = await step<{ v: string | null }>(service, `select public.fd_reset_handoff_take($1::uuid) as v`, [first(exp).rid]);
      const audit = await step<Row>('postgres', `select action from app_private.audit_log where action like 'admin_%reset%' and entity_id = '${LEARNER}' order by id`);
      return { b: first(b), t1: t1[0]!.v, t2: t2[0]!.v, bad: first(bad), limited: first(limited), t3: t3[0]!.v, audit };
    });
    expect(out.b).toMatchObject({ ok: true });
    expect(out.t1).toBe(VERIFIER);
    expect(out.t2).toBeNull();
    expect(out.bad).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(out.limited).toMatchObject({ ok: false, reason: 'too_many' });
    expect(out.t3).toBeNull();
    expect(out.audit.map((a) => a.action)).toEqual(['admin_password_reset_requested', 'admin_reset_link_opened']);
  });

  it('ADM-T11 user detail returns a progress summary and records who looked; an admin may read the master', async () => {
    const out = await db.scenario(async (step) => {
      const d = await step<{ r: Row }>(service, detail, [ADMIN_A, LEARNER]);
      const m = await step<{ r: Row }>(service, detail, [ADMIN_A, MASTER]);
      const none = await step<{ r: Row }>(service, detail, [ADMIN_A, GHOST]);
      const audit = await step<Row>('postgres', `select actor_id, entity_id from app_private.audit_log where action = 'admin_view_user' order by id`);
      return { d: first(d), m: first(m), none: first(none), audit };
    });
    expect(out.d).toMatchObject({ ok: true, summary: { enrolments: 0, stepsCompleted: 0, assessmentAttempts: 0, exerciseAttempts: 0 } });
    expect((out.m as { user: Row }).user).toMatchObject({ isMaster: true });
    expect(out.none).toMatchObject({ ok: false, reason: 'unknown_user' });
    expect(out.audit).toEqual([
      { actor_id: ADMIN_A, entity_id: LEARNER },
      { actor_id: ADMIN_A, entity_id: MASTER },
    ]);
  });

  it('ADM-T12 the master is a single row and the new tables are invisible to the browser roles', async () => {
    await expect(db.pg.exec(`insert into app_private.platform_owner (user_id, singleton) values ('${ADMIN_A}', false)`)).rejects.toThrow();
    await expect(db.pg.exec(`insert into app_private.platform_owner (user_id) values ('${ADMIN_A}')`)).rejects.toThrow();
    for (const t of ['platform_owner', 'user_status', 'reset_handoff']) {
      await expect(db.as(user(ADMIN_A), `select * from app_private.${t}`)).rejects.toThrow(DENIED);
      await expect(db.as(anon, `select * from app_private.${t}`)).rejects.toThrow(DENIED);
    }
  });
});
