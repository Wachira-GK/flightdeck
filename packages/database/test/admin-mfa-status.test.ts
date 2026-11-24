// ADM-T15..T16: two-step status and reset read the database's own record (migration 20261124001100, ADR-010).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000110${n}`;
const MASTER = id('1');
const ADMIN = id('2');
const L1 = id('3');
const L2 = id('4');
const status = `select public.fd_admin_mfa_status($1::uuid, $2::uuid[]) as r`;
const reset = `select public.fd_admin_mfa_reset($1::uuid, $2::uuid) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
beforeAll(async () => {
  db = await createDb('');
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${MASTER}', 'm@t.local'), ('${ADMIN}', 'a@t.local'), ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local');
     insert into public.user_roles (user_id, role) values ('${MASTER}', 'admin'), ('${ADMIN}', 'admin');
     insert into app_private.platform_owner (user_id) values ('${MASTER}');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('ADM-T15..T16 two-step status from the database', () => {
  it('ADM-T15 only service_role may run it; only active admins get an answer; app roles cannot read the factor table', async () => {
    for (const who of [anon, user(ADMIN)]) {
      await expect(db.as(who, status, [ADMIN, [L1]])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select * from app_private.mfa_factors_of(array['${L1}']::uuid[])`)).rejects.toThrow(DENIED);
      await expect(db.as(who, `select * from auth.mfa_factors`)).rejects.toThrow(DENIED);
    }
    expect(out(await db.as(service, status, [L1, [L1]]))).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(out(await db.as(service, status, [null, [L1]]))).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(out(await db.as(service, status, [ADMIN, null]))).toMatchObject({ ok: false, reason: 'invalid_request' });
  });

  it('ADM-T16 reports confirmed and unconfirmed factors per user, and reset returns every factor id to remove', async () => {
    const r = await db.scenario(async (step) => {
      await step('postgres', `insert into auth.mfa_factors (user_id, status) values ('${L1}', 'verified'), ('${L2}', 'unverified'), ('${L2}', 'unverified')`);
      const st = out(await step<{ r: Row }>(service, status, [ADMIN, [L1, L2, ADMIN]]));
      const rs = out(await step<{ r: Row }>(service, reset, [ADMIN, L2]));
      const none = out(await step<{ r: Row }>(service, reset, [ADMIN, L1]));
      return { st, rs, none };
    });
    const factors = r.st.factors as { userId: string; status: string }[];
    expect(factors.filter((f) => f.userId === L1).map((f) => f.status)).toEqual(['verified']);
    expect(factors.filter((f) => f.userId === L2).map((f) => f.status)).toEqual(['unverified', 'unverified']);
    expect(factors.some((f) => f.userId === ADMIN)).toBe(false);
    expect(r.rs).toMatchObject({ ok: true });
    expect((r.rs.factorIds as string[]).length).toBe(2);
    expect((r.none.factorIds as string[]).length).toBe(1);
  });
});
