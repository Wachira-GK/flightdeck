// AUD-T01..T04: read-only audit log screen (migration 20261124001300, ADR-013).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000300${n}`;
const ADMIN = id('1');
const L1 = id('2');

const list = `select public.fd_admin_audit_list($1::uuid, $2, $3::bigint, $4::integer) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${ADMIN}', 'a@t.local'), ('${L1}', 'l1@t.local');
     insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

const seedRows = (n: number) =>
  `insert into app_private.audit_log (actor_id, action, entity, entity_id) select '${ADMIN}', case when g % 2 = 0 then 'even_action' else 'odd_action' end, 'test', g::text from generate_series(1, ${n}) g`;

describe('AUD-T01..T04 audit log screen', () => {
  it('AUD-T01 only service_role may call it; a non-admin actor is refused', async () => {
    for (const who of [anon, user(L1), user(ADMIN)]) await expect(db.as(who, list, [ADMIN, null, null, 50])).rejects.toThrow(DENIED);
    const r = await db.scenario(async (step) => out(await step<{ r: Row }>(service, list, [L1, null, null, 50])));
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('AUD-T02 newest first, pages by keyset with no overlap, limit clamped to 10..100', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, seedRows(25));
      const p1 = out(await step<{ r: Row }>(service, list, [ADMIN, null, null, 10]));
      const last = (p1.rows as Row[]).at(-1)!.id as number;
      const p2 = out(await step<{ r: Row }>(service, list, [ADMIN, null, last, 10]));
      const tiny = out(await step<{ r: Row }>(service, list, [ADMIN, null, null, 1]));
      return { p1, p2, tiny };
    });
    const ids1 = (r.p1.rows as Row[]).map((x) => x.id as number);
    const ids2 = (r.p2.rows as Row[]).map((x) => x.id as number);
    expect(ids1).toHaveLength(10);
    expect(ids1).toEqual([...ids1].sort((a, b) => b - a));
    expect(Math.max(...ids2)).toBeLessThan(Math.min(...ids1));
    expect(r.p1.more).toBe(true);
    expect((r.tiny.rows as Row[]).length).toBe(10);
  });

  it('AUD-T03 filters by action, lists the known actions, and the last page says there is no more', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, seedRows(6));
      const f = out(await step<{ r: Row }>(service, list, [ADMIN, 'even_action', null, 50]));
      return { f };
    });
    expect((r.f.rows as Row[]).every((x) => x.action === 'even_action')).toBe(true);
    expect((r.f.rows as Row[]).length).toBe(3);
    expect(r.f.more).toBe(false);
    expect(r.f.actions as string[]).toEqual(expect.arrayContaining(['even_action', 'odd_action']));
  });

  it('AUD-T04 opening the first page is recorded; later pages are not', async () => {
    const r = await db.scenario(async (step) => {
      const count = async () => (await step<{ n: number }>(service, `select count(*)::int as n from app_private.audit_log where action = 'admin_view_audit'`))[0]!.n;
      await step(service, seedRows(3));
      const a = await count();
      await step(service, list, [ADMIN, null, null, 10]);
      const b = await count();
      await step(service, list, [ADMIN, null, 999999, 10]);
      const c = await count();
      return { a, b, c };
    });
    expect(r).toEqual({ a: 0, b: 1, c: 1 });
  });
});
