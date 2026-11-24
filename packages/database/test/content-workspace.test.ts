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
    expect(r.adminOwn).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(r.ret).toMatchObject({ ok: true });
    expect((r.g.item as Row).status).toBe('draft');
    expect((r.g.item as Row).reviewNote).toBe('Fix the briefing');
  });

  it('CWS-T05 an author who is also admin cannot publish their own submission', async () => {
    const r = await db.scenario(async (step) => {
      await step(service, `insert into public.user_roles (user_id, role) values ('${AUTHOR}', 'admin')`);
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
