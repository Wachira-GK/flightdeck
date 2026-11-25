// CWS-T01..T07: content workspace, stage 2a (migration 20261124001600, ADR-015).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { generateSeed } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const id = (n: string) => `00000000-0000-4000-8000-00000000400${n}`;
const AUTHOR = id('1');
const AUTHOR2 = id('2');
const REVIEWER = id('3');
const ADMIN = id('4');
const LEARNER = id('5');

const SLUG = 'excel-demo-901';
const mission = (extra: Row = {}) => ({ slug: SLUG, code: 'EX-901', title: 'Demo mission', level: 'beginner', ...extra });
const keys = { schemaVersion: 1, missionSlug: SLUG, items: [{ id: 'q1', expected: 42, rationale: 'secret rationale' }] };

const save = `select public.fd_content_save($1::uuid, $2, 'excel', $3::public.course_level, $4::jsonb, null, $5::jsonb, null, $6) as r`;
const submit = `select public.fd_content_submit($1::uuid, $2, $3::integer) as r`;
const review = `select public.fd_content_review($1::uuid, $2, $3::integer, $4, $5) as r`;
const get = `select public.fd_content_get($1::uuid, $2, $3::integer) as r`;
const list = `select public.fd_content_list($1::uuid) as r`;
const out = (rows: { r: unknown }[]) => rows[0]!.r as Row;

let db: Db;
beforeAll(async () => {
  const seed = generateSeed();
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(
    `insert into auth.users (id, email) values ('${AUTHOR}', 'a1@t.local'), ('${AUTHOR2}', 'a2@t.local'), ('${REVIEWER}', 'r@t.local'), ('${ADMIN}', 'ad@t.local'), ('${LEARNER}', 'l@t.local');
     insert into public.user_roles (user_id, role) values ('${AUTHOR}', 'author'), ('${AUTHOR2}', 'author'), ('${REVIEWER}', 'reviewer'), ('${ADMIN}', 'admin');`,
  );
}, 60_000);
afterAll(async () => {
  await db.pg.close();
});

describe('CWS-T01..T07 content workspace', () => {
  it('CWS-T01 only service_role may call it; a learner actor is refused', async () => {
    for (const who of [anon, user(AUTHOR)]) await expect(db.as(who, list, [AUTHOR])).rejects.toThrow(DENIED);
    const r = await db.scenario(async (step) => out(await step<{ r: Row }>(service, list, [LEARNER])));
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    const s = await db.scenario(async (step) => out(await step<{ r: Row }>(service, save, [LEARNER, SLUG, 'beginner', mission(), keys, 'x'])));
    expect(s).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('CWS-T02 save creates revision 1 as a draft, saving again updates it, another author is refused', async () => {
    const r = await db.scenario(async (step) => {
      const a = out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, 'first']));
      const b = out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'intermediate', mission({ title: 'Renamed' }), keys, 'second']));
      const c = out(await step<{ r: Row }>(service, save, [AUTHOR2, SLUG, 'beginner', mission(), keys, 'hijack']));
      const g = out(await step<{ r: Row }>(service, get, [AUTHOR, SLUG, null]));
      return { a, b, c, g };
    });
    expect(r.a).toMatchObject({ ok: true, revision: 1 });
    expect(r.b).toMatchObject({ ok: true, revision: 1 });
    expect(r.c).toMatchObject({ ok: false, reason: 'not_yours' });
    expect((r.g.item as Row).title).toBe('Renamed');
    expect((r.g.item as Row).level).toBe('intermediate');
  });

  it('CWS-T03 invalid documents are refused (slug mismatch, missing code, bad track)', async () => {
    const r = await db.scenario(async (step) => ({
      slug: out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'beginner', mission({ slug: 'other-slug' }), keys, null])),
      code: out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'beginner', mission({ code: '' }), keys, null])),
      bad: out(await step<{ r: Row }>(service, save, [AUTHOR, 'Bad Slug', 'beginner', mission(), keys, null])),
    }));
    for (const v of Object.values(r)) expect(v).toMatchObject({ ok: false, reason: 'invalid_request' });
  });

  it('CWS-T04 submit locks the draft; nobody reviews their own work; return needs a comment and reopens the draft', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]);
      const sub = out(await step<{ r: Row }>(service, submit, [AUTHOR, SLUG, 1]));
      const locked = out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]));
      const own = out(await step<{ r: Row }>(service, review, [AUTHOR, SLUG, 1, 'publish', null]));
      const adminOwn = out(await step<{ r: Row }>(service, review, [ADMIN, SLUG, 1, 'return', '']));
      const ret = out(await step<{ r: Row }>(service, review, [REVIEWER, SLUG, 1, 'return', 'Fix the briefing']));
      const g = out(await step<{ r: Row }>(service, get, [AUTHOR, SLUG, 1]));
      return { sub, locked, own, adminOwn, ret, g };
    });
    expect(r.sub).toMatchObject({ ok: true });
    expect(r.locked).toMatchObject({ ok: false, reason: 'in_review_locked' });
    expect(r.own).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.adminOwn).toMatchObject({ ok: false, reason: 'forbidden' }); // an admin without the reviewer role cannot review
    expect(r.ret).toMatchObject({ ok: true });
    expect((r.g.item as Row).status).toBe('draft');
    expect((r.g.item as Row).reviewNote).toBe('Fix the briefing');
  });

  it('CWS-T05 an author who is also reviewer cannot publish their own submission', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, `insert into public.user_roles (user_id, role) values ('${AUTHOR}', 'reviewer')`);
      await step(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]);
      await step(service, submit, [AUTHOR, SLUG, 1]);
      return out(await step<{ r: Row }>(service, review, [AUTHOR, SLUG, 1, 'publish', null]));
    });
    expect(r).toMatchObject({ ok: false, reason: 'own_work' });
  });

  it('CWS-T06 publish retires the previous revision, keeps one published, and the next save starts revision 2', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]);
      await step(service, submit, [AUTHOR, SLUG, 1]);
      const p1 = out(await step<{ r: Row }>(service, review, [REVIEWER, SLUG, 1, 'publish', null]));
      const next = out(await step<{ r: Row }>(service, save, [AUTHOR, SLUG, 'beginner', mission({ title: 'Second' }), keys, 'v2']));
      await step(service, submit, [AUTHOR, SLUG, 2]);
      const p2 = out(await step<{ r: Row }>(service, review, [REVIEWER, SLUG, 2, 'publish', 'ok']));
      const rows = await step<{ revision: number; status: string }>(service, `select revision, status from app_private.content_items where slug = '${SLUG}' order by revision`);
      return { p1, next, p2, rows };
    });
    expect(r.p1).toMatchObject({ ok: true });
    expect(r.next).toMatchObject({ ok: true, revision: 2 });
    expect(r.p2).toMatchObject({ ok: true });
    expect(r.rows.map((x) => `${x.revision}:${x.status}`)).toEqual(['1:retired', '2:published']);
  });

  it('CWS-T07 the list never carries documents or keys; every step is audited; only an admin can retire', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]);
      await step(service, submit, [AUTHOR, SLUG, 1]);
      await step(service, review, [REVIEWER, SLUG, 1, 'publish', null]);
      const l = out(await step<{ r: Row }>(service, list, [AUTHOR2]));
      const notAdmin = out(await step<{ r: Row }>(service, `select public.fd_content_retire($1::uuid, $2) as r`, [REVIEWER, SLUG]));
      const retire = out(await step<{ r: Row }>(service, `select public.fd_content_retire($1::uuid, $2) as r`, [ADMIN, SLUG]));
      const audit = await step<{ action: string }>(service, `select action from app_private.audit_log where entity = 'content' and entity_id = '${SLUG}' order by id`);
      return { l, notAdmin, retire, audit };
    });
    const text = JSON.stringify(r.l);
    expect(text).not.toContain('secret rationale');
    expect(text).not.toContain('"mission"');
    expect((r.l.items as Row[])[0]).toMatchObject({ slug: SLUG, status: 'published', mine: false });
    expect(r.notAdmin).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(r.retire).toMatchObject({ ok: true });
    expect(r.audit.map((a) => a.action)).toEqual(['content_save', 'content_submit', 'content_publish', 'content_retire']);
  });
});

describe('CWS-T10 roles are separate: admin does not imply author or reviewer', () => {
  it('CWS-T10 an admin with no author/reviewer role gets no workspace and cannot save, submit, withdraw or review', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, save, [AUTHOR, SLUG, 'beginner', mission(), keys, null]);
      await step(service, submit, [AUTHOR, SLUG, 1]);
      return {
        l: out(await step<{ r: Row }>(service, list, [ADMIN])),
        s: out(await step<{ r: Row }>(service, save, [ADMIN, 'excel-admin-new', 'beginner', mission({ slug: 'excel-admin-new' }), keys, null])),
        sub: out(await step<{ r: Row }>(service, submit, [ADMIN, SLUG, 1])),
        wd: out(await step<{ r: Row }>(service, `select public.fd_content_withdraw($1::uuid, $2, $3) as r`, [ADMIN, SLUG, 1])),
        rv: out(await step<{ r: Row }>(service, review, [ADMIN, SLUG, 1, 'publish', null])),
      };
    });
    for (const v of Object.values(r)) expect(v).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('CWS-T10b an author sees canWrite only, a reviewer canReview only, and a user with both roles gets both', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, `insert into public.user_roles (user_id, role) values ('${ADMIN}', 'author'), ('${ADMIN}', 'reviewer')`);
      return {
        a: out(await step<{ r: Row }>(service, list, [AUTHOR])),
        v: out(await step<{ r: Row }>(service, list, [REVIEWER])),
        both: out(await step<{ r: Row }>(service, list, [ADMIN])),
      };
    });
    expect(r.a).toMatchObject({ ok: true, canWrite: true, canReview: false });
    expect(r.v).toMatchObject({ ok: true, canWrite: false, canReview: true });
    expect(r.both).toMatchObject({ ok: true, canWrite: true, canReview: true });
  });
});

describe('CWS-T08..T09 publishing keeps the live catalogue rows in step (stage 2a-ii)', () => {
  const full = (slug: string, title: string) => ({
    slug, code: 'EX-902', title, summary: 'A summary', passMark: 0.8, exerciseId: `${slug}-sheet`,
    steps: ['briefing', 'training', 'simulation', 'assessment', 'debrief'].map((id) => ({ id, title: id.toUpperCase(), blocks: [] })),
    assessment: { items: [] },
  });
  const sheet = (slug: string) => ({ id: `${slug}-sheet`, title: 'Sheet', version: 1, editableCells: ['B2'] });

  it('CWS-T08 a new mission gets mission, 5 steps, assessment (pass mark 80), exercise and an enabled access row; retire switches it off', async () => {
    const slug = 'excel-demo-902';
    const r = await db.scenario(async (step) => {
      await step(service, `select public.fd_content_save($1::uuid, $2, 'excel', 'beginner', $3::jsonb, $4::jsonb, $5::jsonb, null, null)`, [AUTHOR, slug, full(slug, 'Demo two'), sheet(slug), { schemaVersion: 1, missionSlug: slug, items: [] }]);
      await step(service, submit, [AUTHOR, slug, 1]);
      const pub = out(await step<{ r: Row }>(service, review, [REVIEWER, slug, 1, 'publish', null]));
      const live = await step<Row>(service, `select m.title, (select count(*) from public.mission_steps s where s.mission_id = m.id) as steps,
          (select a.pass_mark from public.assessments a where a.slug = m.slug || '-assessment') as pass,
          (select count(*) from public.exercises e where e.slug = '${slug}-sheet') as ex,
          (select count(*) from public.mission_steps s where s.mission_id = m.id and s.exercise_id is not null) as sim_linked,
          (select a.is_enabled from app_private.mission_access a where a.mission_slug = m.slug) as enabled,
          (select i.live_synced from app_private.content_items i where i.slug = m.slug and i.status = 'published') as synced
        from public.missions m where m.slug = '${slug}'`);
      const retire = out(await step<{ r: Row }>(service, `select public.fd_content_retire($1::uuid, $2) as r`, [ADMIN, slug]));
      const after = await step<Row>(service, `select is_enabled from app_private.mission_access where mission_slug = '${slug}'`);
      return { pub, live: live[0]!, retire, after: after[0]! };
    });
    expect(r.pub).toMatchObject({ ok: true });
    expect(r.live).toMatchObject({ title: 'Demo two', steps: 5, ex: 1, sim_linked: 1, enabled: true, synced: true });
    expect(Number(r.live.pass)).toBe(80);
    expect(r.retire).toMatchObject({ ok: true });
    expect(r.after).toMatchObject({ is_enabled: false });
  });

  it('CWS-T09 republishing an existing seeded mission updates it in place: same mission id, same steps, saved progress stays attached', async () => {
    const r = await db.scenario(async (step) => {
      const before = await step<Row>(service, `select m.id, (select array_agg(s.id order by s.position) from public.mission_steps s where s.mission_id = m.id) as steps from public.missions m where m.slug = 'excel-sum-101'`);
      const doc = { ...full('excel-sum-101', 'Totals with SUM (revised)'), code: 'EX-101' };
      await step(service, `select public.fd_content_save($1::uuid, 'excel-sum-101', 'excel', 'beginner', $2::jsonb, null, $3::jsonb, null, null)`, [AUTHOR, doc, { schemaVersion: 1, missionSlug: 'excel-sum-101', items: [] }]);
      await step(service, submit, [AUTHOR, 'excel-sum-101', 1]);
      await step(service, review, [REVIEWER, 'excel-sum-101', 1, 'publish', null]);
      const after = await step<Row>(service, `select m.id, m.title, (select array_agg(s.id order by s.position) from public.mission_steps s where s.mission_id = m.id) as steps from public.missions m where m.slug = 'excel-sum-101'`);
      return { before: before[0]!, after: after[0]! };
    });
    expect(r.after.id).toBe(r.before.id);
    expect(r.after.title).toBe('Totals with SUM (revised)');
    expect(r.after.steps).toEqual(r.before.steps);
  });
});
