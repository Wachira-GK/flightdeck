// SBX-T01..T04: Sim Bay tables in the shared database (migration 20261125000300, stage 4b). Default deny, own rows only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

const id = (n: string) => `00000000-0000-4000-8000-00000000700${n}`;
const L1 = id('1');
const L2 = id('2');
let db: Db;

beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(`insert into auth.users (id, email) values ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local');`);
  await db.pg.exec(
    `insert into public.sim_lessons (id, slug, status, title, public_doc) values ('L-pub', 'pub', 'published', 'Pub', '{"id":"L-pub"}'), ('L-draft', 'draft', 'draft', 'Draft', '{"id":"L-draft"}');
     insert into public.sim_attempts (id, user_id, lesson_id, lesson_version, mode, attempt_no, workbook_id, workbook)
       values ('00000000-0000-4000-8000-000000007101', '${L1}', 'L-pub', 1, 'practice', 1, 'w1', 'SECRET-WORKBOOK'),
              ('00000000-0000-4000-8000-000000007102', '${L2}', 'L-pub', 1, 'practice', 1, 'w2', 'OTHER');
     insert into app_private.sim_lesson_keys (lesson_id, version, full_doc) values ('L-pub', 1, '{"solution":"SECRET-KEY"}');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('SBX Sim Bay tables', () => {
  it('SBX-T01 anonymous visitors see published lessons only, nothing else', async () => {
    const rows = await db.as(anon, `select id from public.sim_lessons order by id`);
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(['L-pub']);
    await expect(db.as(anon, `select * from public.sim_attempts`)).rejects.toThrow(DENIED);
    await expect(db.as(anon, `select * from public.sim_events`)).rejects.toThrow(DENIED);
  });

  it('SBX-T02 a learner reads only their own attempts, never the stored workbook column', async () => {
    const rows = await db.as(user(L1), `select id, user_id from public.sim_attempts`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { user_id: string }).user_id).toBe(L1);
    await expect(db.as(user(L1), `select workbook from public.sim_attempts`)).rejects.toThrow(DENIED);
  });

  it('SBX-T03 learners cannot write attempts, events or lessons, or reach the answer keys', async () => {
    await expect(db.as(user(L1), `update public.sim_attempts set passed = true`)).rejects.toThrow(DENIED);
    await expect(db.as(user(L1), `insert into public.sim_lessons (id, slug, title, public_doc) values ('x', 'x', 'x', '{}')`)).rejects.toThrow(DENIED);
    await expect(db.as(user(L1), `select * from app_private.sim_lesson_keys`)).rejects.toThrow(DENIED);
    await expect(db.as(user(L1), `select public.sim_get_lesson_full('L-pub')`)).rejects.toThrow(DENIED);
    await expect(db.as(anon, `select public.sim_get_lesson_full('L-pub')`)).rejects.toThrow(DENIED);
  });

  it('SBX-T04 the server can read keys, and a public document with answer keys is refused', async () => {
    const r = await db.as(service, `select public.sim_get_lesson_full('L-pub') as r`);
    expect(JSON.stringify(r)).toContain('SECRET-KEY');
    await expect(
      db.as(service, `select public.sim_put_lesson('{"id":"L-bad","solution":"x"}'::jsonb, '{"id":"L-bad"}'::jsonb, null)`),
    ).rejects.toThrow(/answer keys/);
  });
});
