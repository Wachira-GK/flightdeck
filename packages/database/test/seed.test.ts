// SEED-T01..T10: FD-C01 catalogue seed loads, respects RLS, keeps keys server-only, and has not drifted.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, DENIED, service, user, type Db } from './harness';
import { buildModel, generateSeed, OUTPUT_FILES, REPO_ROOT } from '../scripts/generate-seed.ts';

type Row = Record<string, unknown>;
const LEARNER = '00000000-0000-4000-8000-0000000005e1';
const learner = user(LEARNER);

const contentDir = join(REPO_ROOT, 'content');
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Row;
const isKey = (f: string) => /\.keys?\.json$/.test(f);
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

// Independent tally of the content files (not via the generator).
const missionFiles = readdirSync(contentDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => jsonFiles(join(contentDir, d.name, 'missions')).filter((f) => !isKey(f)).map((f) => join(contentDir, d.name, 'missions', f)));
const missions = missionFiles.map(readJson);
const excelDir = join(contentDir, 'excel', 'exercises');
const excelExercises = jsonFiles(excelDir).filter((f) => !isKey(f));
const mathMissions = missions.filter((m) => Array.isArray(m.datasets) && (m.datasets as unknown[]).length > 0);
const itemsOf = (m: Row) => ((m.assessment as { items?: unknown[] } | undefined)?.items ?? []).length;
const expected = {
  tracks: 3,
  courses: 2,
  course_versions: 2,
  missions: missions.length,
  mission_steps: missions.reduce((n, m) => n + (m.steps as unknown[]).length, 0),
  exercises: excelExercises.length + mathMissions.length,
  assessments: missions.filter((m) => itemsOf(m) > 0).length,
  assessment_items: missions.reduce((n, m) => n + itemsOf(m), 0),
};

let db: Db;
const seed = generateSeed();

beforeAll(async () => {
  db = await createDb('');
  await db.pg.exec(seed.localUsersSql);
  await db.pg.exec(seed.catalogueSql);
  await db.pg.exec(`insert into auth.users (id, email) values ('${LEARNER}', 'seed-learner@test.local')`);
}, 60_000);

const count = async (who: Parameters<Db['as']>[0] | 'postgres', table: string) =>
  Number((await db.scenario((step) => step<Row>(who, `select count(*)::int as n from ${table}`)))[0]!.n);

describe('SEED-T01..T10 catalogue seed', () => {
  it('SEED-T01 loads without error and is idempotent (re-run is a no-op)', async () => {
    const before = await count('postgres', 'public.mission_steps');
    await db.pg.exec(seed.localUsersSql);
    await db.pg.exec(seed.catalogueSql);
    expect(await count('postgres', 'public.mission_steps')).toBe(before);
    expect(await count('postgres', 'app_private.audit_log')).toBe(expected.course_versions);
  });

  it('SEED-T02 row counts match the content files', async () => {
    for (const [table, n] of Object.entries(expected)) {
      expect(await count('postgres', `public.${table}`), table).toBe(n);
    }
    expect(await count('postgres', 'app_private.exercise_keys')).toBe(expected.exercises);
    expect(await count('postgres', 'app_private.assessment_item_keys')).toBe(expected.assessment_items);
    expect(expected.missions).toBeGreaterThan(0);
  });

  it('SEED-T03 anon sees the published catalogue but not the draft CodeVerse track', async () => {
    const tracks = (await db.as<Row>(anon, 'select slug from public.tracks order by sort_order')).map((r) => r.slug);
    expect(tracks).toEqual(['excel-masterclass', 'mathlab']);
    expect(await count(anon, 'public.courses')).toBe(expected.courses);
    expect(await count(anon, 'public.course_versions')).toBe(expected.course_versions);
    expect(await count(anon, 'public.missions')).toBe(expected.missions);
    expect(await count(anon, 'public.mission_steps')).toBe(expected.mission_steps);
    expect(await count(anon, 'public.exercises')).toBe(expected.exercises);
    expect(await count('postgres', `public.tracks where slug = 'codeverse-sql' and status = 'draft'`)).toBe(1);
  });

  it('SEED-T04 anon cannot read assessments; an authenticated learner sees the items', async () => {
    await expect(db.as(anon, 'select * from public.assessment_items')).rejects.toThrow(DENIED);
    expect(await count(learner, 'public.assessments')).toBe(expected.assessments);
    expect(await count(learner, 'public.assessment_items')).toBe(expected.assessment_items);
  });

  it('SEED-T05 only service_role/postgres can read the keys', async () => {
    for (const table of ['app_private.exercise_keys', 'app_private.assessment_item_keys']) {
      await expect(db.as(anon, `select * from ${table}`), `anon ${table}`).rejects.toThrow(DENIED);
      await expect(db.as(learner, `select * from ${table}`), `learner ${table}`).rejects.toThrow(DENIED);
      expect(await count(service, table)).toBeGreaterThan(0);
    }
  });

  it('SEED-T06 public exercise definitions contain no expected values from the key files', async () => {
    const rows = await db.as<{ slug: string; definition: Row }>(anon, `select slug, definition from public.exercises where kind = 'excel'`);
    expect(rows.length).toBe(excelExercises.length);
    for (const file of excelExercises) {
      const def = rows.find((r) => `${r.slug}.json` === file)?.definition;
      expect(def, file).toBeDefined();
      const text = JSON.stringify(def);
      for (const k of ['expected', 'hiddenTests', 'requireFormula', 'requireFunctions', 'passThreshold']) expect(text).not.toContain(`"${k}"`);
      const key = readJson(join(excelDir, file.replace(/\.json$/, '.key.json')));
      const starter = (def!.starter ?? {}) as Row;
      for (const e of key.expected as { cell: string; value: unknown }[]) {
        expect(starter[e.cell] ?? '', `${file} ${e.cell} pre-filled`).toBe('');
        // A lookup's answer is a copy of a starter data cell (e.g. a price), so only computed values must be absent.
        const isStarterData = Object.values(starter).map(String).includes(String(e.value));
        if (typeof e.value === 'number' && !isStarterData) {
          expect(new RegExp(`(?<![\\d.])${String(e.value).replace('.', '\\.')}(?![\\d.])`).test(text), `${file} leaks ${e.value}`).toBe(false);
        }
      }
    }
  });

  it('SEED-T07 public steps, items and math exercises never carry assessment answers', async () => {
    const pub = JSON.stringify([
      await db.as(learner, 'select prompt, options from public.assessment_items'),
      await db.as(learner, 'select body from public.mission_steps'),
      await db.as(learner, `select definition from public.exercises where kind = 'math'`),
    ]);
    for (const k of ['"correct', '"rationale"', '"expected"', '"explain"']) expect(pub).not.toContain(k);
    for (const f of missionFiles) {
      const keysFile = f.replace(/\.json$/, '.keys.json');
      if (!existsSync(keysFile)) continue;
      for (const item of readJson(keysFile).items as Row[]) {
        // Non-integer answers (e.g. 105.2, 50.86) cannot occur in the raw data, so they must never appear publicly.
        if (typeof item.expected === 'number' && !Number.isInteger(item.expected)) expect(pub).not.toContain(String(item.expected));
      }
    }
    const keys = await db.as<Row>(service, 'select count(*)::int as n from app_private.assessment_item_keys k join public.assessment_items i on i.id = k.item_id');
    expect(Number(keys[0]!.n)).toBe(expected.assessment_items);
  });

  it('SEED-T08 every simulation step links an exercise and every assessment step an assessment', async () => {
    const bad = await db.as<Row>(service, `
      select s.id from public.mission_steps s
       where (s.kind = 'simulation' and s.exercise_id is null) or (s.kind = 'assessment' and s.assessment_id is null)`);
    expect(bad).toEqual([]);
    const versions = await db.as<Row>(anon, 'select status, published_by, published_at from public.course_versions');
    for (const v of versions) expect(v).toMatchObject({ status: 'published', published_by: expect.any(String) });
  });

  it('SEED-T09 committed seed files are up to date with content (drift check)', () => {
    const stale = 'is stale: run `pnpm --filter @flightdeck/database seed:generate`';
    // Boolean comparisons keep the failure message short (the SQL is large).
    expect(readFileSync(OUTPUT_FILES.catalogue, 'utf8') === seed.catalogueSql, `seeds/catalogue.sql ${stale}`).toBe(true);
    expect(readFileSync(OUTPUT_FILES.localUsers, 'utf8') === seed.localUsersSql, `seeds/local-users.sql ${stale}`).toBe(true);
    expect(generateSeed().catalogueSql === seed.catalogueSql, 'generator output is not deterministic').toBe(true);
  });
});

describe('SEED-T10 generator fails loudly on bad content', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fd-seed-'));
    cpSync(contentDir, join(root, 'content'), { recursive: true });
    cpSync(join(REPO_ROOT, 'packages', 'database', 'seeds', 'catalogue.config.json'), join(root, 'packages', 'database', 'seeds', 'catalogue.config.json'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const mathFile = () => join(root, 'content', 'math', 'missions', 'descriptive-stats-101.json');
  const mutate = (file: string, fn: (j: Row) => void) => {
    const original = readFileSync(file, 'utf8');
    const j = JSON.parse(original) as Row;
    fn(j);
    writeFileSync(file, JSON.stringify(j));
    return () => writeFileSync(file, original);
  };
  const expectFail = (file: string, fn: (j: Row) => void, msg: RegExp) => {
    const restore = mutate(file, fn);
    try {
      expect(() => buildModel(root)).toThrow(msg);
    } finally {
      restore();
    }
  };

  it('copy of real content builds', () => {
    expect(buildModel(root).missions.length).toBe(expected.missions);
  });
  it('rejects an invalid step kind', () =>
    expectFail(mathFile(), (j) => { (j.steps as Row[])[0]!.id = 'warmup'; }, /invalid kind "warmup"/));
  it('rejects an assessment item without a key', () =>
    expectFail(mathFile(), (j) => { ((j.assessment as Row).items as Row[]).push({ id: 'a9-new', type: 'numeric', prompt: 'x?', datasetId: 'store-b-weekly-pairs' }); }, /a9-new has no key/));
  it('rejects answers in a public file', () =>
    expectFail(mathFile(), (j) => { ((j.assessment as Row).items as Row[])[0]!.expected = 1; }, /answer-bearing property "expected"/));
  it('rejects a simulation step pointing at a missing exercise', () =>
    expectFail(mathFile(), (j) => { (j.steps as Row[]).find((s) => s.id === 'simulation')!.exerciseId = 'no-such-exercise'; }, /no-such-exercise/));
  it('rejects duplicate mission slugs', () => {
    const copy = join(root, 'content', 'math', 'missions', 'copy-mission.json');
    writeFileSync(copy, JSON.stringify({ ...readJson(mathFile()), slug: 'descriptive-stats-101' }));
    try {
      expect(() => buildModel(root)).toThrow(/must match the file name|duplicate mission slug/);
    } finally {
      rmSync(copy);
    }
  });
});
