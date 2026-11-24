// CWS-T10..T13: how the website reads published content (migration 20261124001800, ADR-015 stage 2b).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000500${n}`;
const AUTHOR = id('1');
const REVIEWER = id('2');
const L1 = id('3');
const L2 = id('4');
const SLUG = 'excel-pin-903';

const doc = (title: string) => ({
  slug: SLUG, code: 'EX-903', title, summary: 'S', passMark: 0.75, exerciseId: `${SLUG}-sheet`,
  steps: ['briefing', 'training', 'simulation', 'assessment', 'debrief'].map((s) => ({ id: s, title: s, blocks: [] })),
  assessment: { items: [] },
});
const sheet = { id: `${SLUG}-sheet`, title: 'Sheet', version: 1, editableCells: ['B2'] };
const keysOf = (tag: string) => ({ schemaVersion: 1, missionSlug: SLUG, items: [{ id: 'q1', expected: tag, rationale: `secret-${tag}` }] });

const save = `select public.fd_content_save($1::uuid, $2, 'excel', 'beginner', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, null) as r`;
const submit = `select public.fd_content_submit($1::uuid, $2, $3::integer) as r`;
const review = `select public.fd_content_review($1::uuid, $2, $3::integer, 'publish', null) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${AUTHOR}', 'a@t.local'), ('${REVIEWER}', 'r@t.local'), ('${L1}', 'l1@t.local'), ('${L2}', 'l2@t.local');
     insert into public.user_roles (user_id, role) values ('${AUTHOR}', 'author'), ('${REVIEWER}', 'reviewer');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

const publishRev = async (step: Parameters<Parameters<Db['scenario']>[0]>[0], rev: number, title: string, tag: string) => {
  await step(service, save, [AUTHOR, SLUG, doc(title), sheet, keysOf(tag), { schemaVersion: 1, exerciseId: sheet.id, exerciseVersion: 1, expected: [{ cell: 'B2', value: tag }] }]);
  await step(service, submit, [AUTHOR, SLUG, rev]);
  await step(service, review, [REVIEWER, SLUG, rev]);
};

describe('CWS-T10..T13 content read path', () => {
  it('CWS-T10 only service_role may call the read functions', async () => {
    for (const who of [anon, user(L1)]) {
      await expect(db.as(who, `select public.fd_content_published_summary()`)).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_content_for_learner($1::uuid, 'x-y', true)`, [L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_content_grading($1::uuid, 'x-y')`, [L1])).rejects.toThrow(DENIED);
      await expect(db.as(who, `select public.fd_content_exercise('x-y')`)).rejects.toThrow(DENIED);
    }
  });

  it('CWS-T11 the summary lists published missions only, with no documents or keys; learner documents carry no keys', async () => {
    const r = await db.scenario(async (step) => {
      await publishRev(step, 1, 'First', 'A');
      await step(service, save, [AUTHOR, SLUG, doc('Draft two'), sheet, keysOf('B'), null]);
      const list = (await step<{ r: unknown }>(service, `select public.fd_content_published_summary() as r`))[0]!.r as Row[];
      const mine = out(await step<{ r: Row }>(service, `select public.fd_content_for_learner(null, '${SLUG}', false) as r`));
      return { list, mine };
    });
    const entry = r.list.find((x) => x.slug === SLUG)!;
    expect(entry).toMatchObject({ code: 'EX-903', title: 'First', level: 'beginner', revision: 1 });
    expect(JSON.stringify(r.list)).not.toContain('secret-');
    expect(JSON.stringify(r.mine)).not.toContain('secret-');
    expect(JSON.stringify(r.mine)).not.toContain('"keys"');
    expect(r.mine.ok).toBe(true);
  });

  it('CWS-T12 a learner is pinned to the revision they first opened; new learners get the newer one; grading follows the pin', async () => {
    const r = await db.scenario(async (step) => {
      await publishRev(step, 1, 'First', 'A');
      const l1 = out(await step<{ r: Row }>(service, `select public.fd_content_for_learner($1::uuid, '${SLUG}', true) as r`, [L1]));
      await publishRev(step, 2, 'Second', 'B');
      const l1again = out(await step<{ r: Row }>(service, `select public.fd_content_for_learner($1::uuid, '${SLUG}', true) as r`, [L1]));
      const l2 = out(await step<{ r: Row }>(service, `select public.fd_content_for_learner($1::uuid, '${SLUG}', true) as r`, [L2]));
      const g1 = out(await step<{ r: Row }>(service, `select public.fd_content_grading($1::uuid, '${SLUG}') as r`, [L1]));
      const g2 = out(await step<{ r: Row }>(service, `select public.fd_content_grading($1::uuid, '${SLUG}') as r`, [L2]));
      const anonG = out(await step<{ r: Row }>(service, `select public.fd_content_grading(null, '${SLUG}') as r`));
      return { l1, l1again, l2, g1, g2, anonG };
    });
    expect(r.l1.revision).toBe(1);
    expect(r.l1again.revision).toBe(1);
    expect((r.l1again.mission as Row).title).toBe('First');
    expect(r.l2.revision).toBe(2);
    expect(JSON.stringify(r.g1)).toContain('secret-A');
    expect(JSON.stringify(r.g2)).toContain('secret-B');
    expect(r.anonG.revision).toBe(2);
  });

  it('CWS-T13 unknown missions and exercises are not found; the exercise lookup returns the published exercise and its key', async () => {
    const r = await db.scenario(async (step) => {
      await publishRev(step, 1, 'First', 'A');
      return {
        none: out(await step<{ r: Row }>(service, `select public.fd_content_for_learner(null, 'no-such-mission', false) as r`)),
        badSlug: out(await step<{ r: Row }>(service, `select public.fd_content_grading(null, 'Bad Slug') as r`)),
        ex: out(await step<{ r: Row }>(service, `select public.fd_content_exercise('${SLUG}-sheet') as r`)),
        noEx: out(await step<{ r: Row }>(service, `select public.fd_content_exercise('nope-sheet') as r`)),
      };
    });
    expect(r.none).toMatchObject({ ok: false, reason: 'not_found' });
    expect(r.badSlug).toMatchObject({ ok: false, reason: 'not_found' });
    expect(r.ex.ok).toBe(true);
    expect(r.ex.slug).toBe(SLUG);
    expect((r.ex.exercise as Row).id).toBe(`${SLUG}-sheet`);
    expect(r.ex.exerciseKey).toBeTruthy();
    expect(r.noEx).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('CWS-T14 the list says what the caller may do, including for someone with two roles; learners are refused', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, `insert into public.user_roles (user_id, role) values ($1::uuid, 'author'), ($1::uuid, 'reviewer')`, [L2]);
      const get = async (who: string) => out(await step<{ r: Row }>(service, `select public.fd_content_list($1::uuid) as r`, [who]));
      return { author: await get(AUTHOR), reviewer: await get(REVIEWER), both: await get(L2), learner: await get(L1) };
    });
    expect(r.author).toMatchObject({ ok: true, canWrite: true, canReview: false });
    expect(r.reviewer).toMatchObject({ ok: true, canWrite: false, canReview: true });
    expect(r.both).toMatchObject({ ok: true, role: 'reviewer', canWrite: true, canReview: true });
    expect(r.learner).toMatchObject({ ok: false, reason: 'forbidden' });
  });
});

