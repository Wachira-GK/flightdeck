// ADM-T13..T14: admin reset of two-step sign-in (migration 20261124000900, ADR-010).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000090${n}`;
const MASTER = id('1');
const ADMIN = id('2');
const LEARNER = id('3');
const GHOST = id('f');
const reset = `select public.fd_admin_mfa_reset($1::uuid, $2::uuid) as r`;
const first = (rows: { r: Row }[]) => rows[0]!.r;

let db: Db;
beforeAll(async () => {
  db = await createDb('');
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${MASTER}', 'm@test.local'), ('${ADMIN}', 'a@test.local'), ('${LEARNER}', 'l@test.local');
     insert into public.user_roles (user_id, role) values ('${MASTER}', 'admin'), ('${ADMIN}', 'admin');
     insert into app_private.platform_owner (user_id) values ('${MASTER}');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('ADM-T13..T14 two-step reset', () => {
  it('ADM-T13 only service_role may run it; non-admins and unknown users are refused', async () => {
    for (const who of [anon, user(ADMIN), user(MASTER)]) await expect(db.as(who, reset, [ADMIN, LEARNER])).rejects.toThrow(DENIED);
    expect(first(await db.as(service, reset, [LEARNER, LEARNER]))).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(first(await db.as(service, reset, [null, LEARNER]))).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(first(await db.as(service, reset, [ADMIN, GHOST]))).toMatchObject({ ok: false, reason: 'unknown_user' });
  });

  it('ADM-T14 an admin may reset another user (audited); never themselves; never the master', async () => {
    const out = await db.scenario(async (step) => {
      const ok = await step<{ r: Row }>(service, reset, [ADMIN, LEARNER]);
      const self = await step<{ r: Row }>(service, reset, [ADMIN, ADMIN]);
      const master = await step<{ r: Row }>(service, reset, [ADMIN, MASTER]);
      const masterSelf = await step<{ r: Row }>(service, reset, [MASTER, MASTER]);
      const masterOnAdmin = await step<{ r: Row }>(service, reset, [MASTER, ADMIN]);
      const audit = await step<Row>('postgres', `select actor_id, entity_id from app_private.audit_log where action = 'admin_mfa_reset' order by id`);
      return { ok: first(ok), self: first(self), master: first(master), masterSelf: first(masterSelf), masterOnAdmin: first(masterOnAdmin), audit };
    });
    expect(out.ok).toMatchObject({ ok: true });
    expect(out.self).toMatchObject({ reason: 'self_change' });
    expect(out.master).toMatchObject({ reason: 'master_protected' });
    expect(out.masterSelf).toMatchObject({ reason: 'master_protected' });
    expect(out.masterOnAdmin).toMatchObject({ ok: true });
    expect(out.audit).toEqual([
      { actor_id: ADMIN, entity_id: LEARNER },
      { actor_id: MASTER, entity_id: ADMIN },
    ]);
  });
});
