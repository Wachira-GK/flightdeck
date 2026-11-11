// FD-C01 catalogue seed generator: content/** -> seeds/catalogue.sql (+ seeds/local-users.sql).
// Run: pnpm --filter @flightdeck/database seed:generate   (or: node scripts/generate-seed.ts)
// Check only (CI): node scripts/generate-seed.ts --check   (exit 1 if the committed SQL has drifted)
//
// Rules (docs/data/CATALOGUE-SEEDING.md):
// - Public tables get learner-safe data only. Answer keys and hidden tests go ONLY to
//   app_private.exercise_keys / app_private.assessment_item_keys.
// - Ids are stable: a UUID derived from the slug path (SHA-1, RFC 4122 v5 layout).
// - Output is deterministic (sorted inputs, fixed timestamps) and every insert is
//   `on conflict do nothing`, so re-running on the same database is a no-op.
// - Validation fails loudly (throws) on duplicate slugs, invalid step kinds, dangling exercise
//   references, assessment items without keys, keys without items, or answers in public files.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const here = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = join(here, '..');
export const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
export const SEEDS_DIR = join(PACKAGE_DIR, 'seeds');

export const STEP_KINDS = ['briefing', 'training', 'simulation', 'assessment', 'debrief'] as const;
const ITEM_KINDS: Record<string, string> = {
  'single-choice': 'single_choice', single_choice: 'single_choice',
  'multi-choice': 'multi_choice', multi_choice: 'multi_choice',
  numeric: 'numeric', formula: 'formula',
};
/** Property names that may only ever appear in server-only key files. */
export const FORBIDDEN_PUBLIC_KEYS = [
  'expected', 'expectedValue', 'hiddenTests', 'requireFormula', 'requireFunctions', 'passThreshold',
  'correct', 'correctOptionId', 'correctOptionIds', 'rationale', 'answer', 'answers', 'solution',
];
const SLUG = /^[a-z0-9-]{2,64}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class SeedError extends Error {}
const fail = (msg: string): never => {
  throw new SeedError(`[seed] ${msg}`);
};

const NAMESPACE = 'flightdeck:catalogue:v1';
/** Stable UUID from a name path, RFC 4122 version-5 layout (SHA-1 over namespace + name). */
export function stableId(...parts: string[]): string {
  const h = createHash('sha1').update(`${NAMESPACE}:${parts.join('/')}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, where: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fail(`${where}: expected a non-empty string`);
const readJson = (file: string): Obj => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${rel(file)}: invalid JSON (${(e as Error).message})`);
  }
  return isObj(parsed) ? parsed : fail(`${rel(file)}: top level must be an object`);
};
const rel = (file: string) => relative(REPO_ROOT, file).replaceAll('\\', '/');
const listJson = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
const isKeyFile = (f: string) => f.endsWith('.key.json') || f.endsWith('.keys.json');

/** Throws if any forbidden (answer-bearing) property name occurs anywhere in a public JSON value. */
export function assertLearnerSafe(value: unknown, where: string, path = '$'): void {
  if (Array.isArray(value)) value.forEach((v, i) => assertLearnerSafe(v, where, `${path}[${i}]`));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_PUBLIC_KEYS.includes(k)) fail(`${where}: answer-bearing property "${k}" at ${path} in a public file`);
      assertLearnerSafe(v, where, `${path}.${k}`);
    }
  }
}

/** Collect every string under a property named `exerciseId` (recursive). */
function exerciseRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => exerciseRefs(v, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'exerciseId' && typeof v === 'string') out.push(v);
      else exerciseRefs(v, out);
    }
  }
  return out;
}

const hasBlockType = (value: unknown, type: string): boolean =>
  Array.isArray(value) ? value.some((v) => hasBlockType(v, type))
    : isObj(value) ? value.type === type || Object.values(value).some((v) => hasBlockType(v, type)) : false;

// --- Descriptive statistics for math practice keys (mirrors packages/math/src/stats.ts) ---
function statistic(kind: string, values: number[], where: string): number {
  const n = values.length;
  if (n === 0) fail(`${where}: empty dataset`);
  const s = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  const median = (xs: number[]) => {
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
  };
  const pct = (p: number) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    return s[lo]! + (h - lo) * ((s[Math.min(lo + 1, n - 1)] ?? s[lo]!) - s[lo]!);
  };
  switch (kind) {
    case 'mean': return mean;
    case 'median': return median(s);
    case 'min': return s[0]!;
    case 'max': return s[n - 1]!;
    case 'range': return s[n - 1]! - s[0]!;
    case 'populationVariance': return ss / n;
    case 'sampleVariance': return n > 1 ? ss / (n - 1) : fail(`${where}: sample statistic needs n >= 2`);
    case 'populationStdDev': return Math.sqrt(ss / n);
    case 'sampleStdDev': return n > 1 ? Math.sqrt(ss / (n - 1)) : fail(`${where}: sample statistic needs n >= 2`);
    case 'q1': return pct(0.25);
    case 'q3': return pct(0.75);
    case 'iqr': return pct(0.75) - pct(0.25);
    default: return fail(`${where}: unknown statistic "${kind}"`);
  }
}
const roundTo = (v: number, decimals: number | undefined) =>
  decimals === undefined ? v : Number(v.toFixed(decimals));

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
export type SeedConfig = {
  publishedAt: string;
  seedActors: { author: { id: string; email: string }; reviewer: { id: string; email: string } };
  tracks: {
    slug: string; title: string; subject: string; description: string; contentDir: string | null;
    contentTrackIds: string[]; status: 'published' | 'draft'; sortOrder: number; lockedReason?: string;
  }[];
  courses: {
    slug: string; track: string; title: string; summary: string; level: string; isFree: boolean;
    version: number; changeNote: string;
  }[];
};

type ExerciseRow = { id: string; versionId: string; kind: 'excel' | 'math'; slug: string; title: string; definition: Obj; expected: Json; hiddenTests: Json; source: string };
type ItemRow = { id: string; assessmentId: string; position: number; kind: string; prompt: Obj; options: Json | null; points: number; correct: Obj; explanation: string | null };
type AssessmentRow = { id: string; versionId: string; slug: string; title: string; passMark: number; items: ItemRow[] };
type StepRow = { id: string; missionId: string; position: number; kind: string; title: string; body: Obj; exerciseId: string | null; assessmentId: string | null };
type MissionRow = { id: string; versionId: string; position: number; slug: string; code: string; title: string; summary: string | null; estimatedMinutes: number | null; steps: StepRow[]; source: string };

export type SeedModel = {
  config: SeedConfig;
  tracks: (SeedConfig['tracks'][number] & { id: string })[];
  courses: (SeedConfig['courses'][number] & { id: string; trackId: string; versionId: string })[];
  exercises: ExerciseRow[];
  assessments: AssessmentRow[];
  missions: MissionRow[];
};

export function loadConfig(root = REPO_ROOT): SeedConfig {
  const cfg = readJson(join(root, 'packages', 'database', 'seeds', 'catalogue.config.json')) as unknown as SeedConfig;
  if (Number.isNaN(Date.parse(cfg.publishedAt))) fail('catalogue.config.json: publishedAt is not a timestamp');
  const seen = new Set<string>();
  for (const t of cfg.tracks) {
    if (!SLUG.test(t.slug) || seen.has(`t:${t.slug}`)) fail(`track slug invalid or duplicate: ${t.slug}`);
    seen.add(`t:${t.slug}`);
  }
  for (const c of cfg.courses) {
    if (!SLUG.test(c.slug) || seen.has(`c:${c.slug}`)) fail(`course slug invalid or duplicate: ${c.slug}`);
    if (!cfg.tracks.some((t) => t.slug === c.track)) fail(`course ${c.slug}: unknown track ${c.track}`);
    if (!Number.isInteger(c.version) || c.version < 1) fail(`course ${c.slug}: version must be a positive integer`);
    seen.add(`c:${c.slug}`);
  }
  return cfg;
}

/** Read and validate content/** into rows. Pure apart from reading files; throws SeedError on any problem. */
export function buildModel(root = REPO_ROOT): SeedModel {
  const config = loadConfig(root);
  const tracks = config.tracks.map((t) => ({ ...t, id: stableId('track', t.slug) }));
  const courses = config.courses.map((c) => {
    const id = stableId('course', c.slug);
    return { ...c, id, trackId: stableId('track', c.track), versionId: stableId('course_version', c.slug, String(c.version)) };
  });
  const courseForTrack = (trackSlug: string) => {
    const matches = courses.filter((c) => c.track === trackSlug);
    if (matches.length !== 1) fail(`track ${trackSlug}: expected exactly one course to seed into, found ${matches.length}`);
    return matches[0]!;
  };
  const trackForContent = (contentDir: string, trackId: unknown, where: string) => {
    const t = tracks.find((x) => x.contentDir === contentDir);
    if (!t) return fail(`${where}: no track maps content/${contentDir}`);
    if (trackId !== undefined && !t.contentTrackIds.includes(String(trackId)))
      fail(`${where}: trackId "${String(trackId)}" does not belong to content/${contentDir} (track ${t.slug})`);
    if (t.status !== 'published') fail(`${where}: track ${t.slug} is not published; do not seed content into it yet`);
    return t;
  };

  const exercises: ExerciseRow[] = [];
  const assessments: AssessmentRow[] = [];
  const missions: MissionRow[] = [];

  // --- Excel exercise bank: content/excel/exercises/<id>.json + <id>.key.json ---
  const excelDir = join(root, 'content', 'excel', 'exercises');
  const excelTrack = tracks.find((t) => t.contentDir === 'excel');
  for (const file of listJson(excelDir).filter((f) => !isKeyFile(f))) {
    if (!excelTrack) fail('content/excel exists but no track maps it');
    const course = courseForTrack(excelTrack!.slug);
    const path = join(excelDir, file);
    const where = rel(path);
    const def = readJson(path);
    const slug = str(def.id, `${where} id`);
    if (`${slug}.json` !== file) fail(`${where}: id "${slug}" must match the file name`);
    if (!SLUG.test(slug)) fail(`${where}: id is not a valid slug`);
    if (!Number.isInteger(def.version)) fail(`${where}: version must be an integer`);
    assertLearnerSafe(def, where);
    const keyPath = join(excelDir, `${slug}.key.json`);
    if (!existsSync(keyPath)) fail(`${where}: missing answer key ${slug}.key.json`);
    const key = readJson(keyPath);
    if (key.exerciseId !== slug || key.exerciseVersion !== def.version)
      fail(`${rel(keyPath)}: exerciseId/exerciseVersion do not match ${slug} v${String(def.version)}`);
    if (!Array.isArray(key.expected) || key.expected.length === 0) fail(`${rel(keyPath)}: expected[] is empty`);
    const editable = Array.isArray(def.editableCells) ? def.editableCells.map(String) : [];
    const starter = isObj(def.starter) ? def.starter : {};
    for (const e of key.expected as Json[]) {
      if (!isObj(e) || typeof e.cell !== 'string') fail(`${rel(keyPath)}: each expected entry needs a cell`);
      const cell = (e as Obj).cell as string;
      if (!editable.includes(cell)) fail(`${rel(keyPath)}: expected cell ${cell} is not an editable cell`);
      if (starter[cell] !== undefined && starter[cell] !== '') fail(`${where}: starter pre-fills answer cell ${cell}`);
    }
    const { hiddenTests = [], ...expected } = key;
    exercises.push({
      id: stableId('exercise', course.slug, String(course.version), slug),
      versionId: course.versionId, kind: 'excel', slug,
      title: str(def.title, `${where} title`), definition: def, expected, hiddenTests, source: where,
    });
  }
  for (const file of listJson(excelDir).filter(isKeyFile)) {
    const slug = file.replace(/\.keys?\.json$/, '');
    if (!exercises.some((x) => x.slug === slug)) fail(`content/excel/exercises/${file}: key without an exercise`);
  }

  // --- Missions: content/<dir>/missions/<slug>.json (+ <slug>.keys.json for assessment keys) ---
  const contentDir = join(root, 'content');
  const dirs = existsSync(contentDir)
    ? readdirSync(contentDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  const missionSlugs = new Map<string, string>();
  const missionCodes = new Map<string, string>();
  const perVersion = new Map<string, MissionRow[]>();

  for (const dir of dirs) {
    const mdir = join(contentDir, dir, 'missions');
    for (const file of listJson(mdir).filter((f) => !isKeyFile(f))) {
      const path = join(mdir, file);
      const where = rel(path);
      const m = readJson(path);
      const slug = str(m.slug, `${where} slug`);
      if (!SLUG.test(slug)) fail(`${where}: slug "${slug}" is not valid`);
      if (`${slug}.json` !== file) fail(`${where}: slug "${slug}" must match the file name`);
      if (missionSlugs.has(slug)) fail(`duplicate mission slug "${slug}" in ${where} and ${missionSlugs.get(slug)}`);
      missionSlugs.set(slug, where);
      const code = str(m.code, `${where} code`);
      if (missionCodes.has(code)) fail(`duplicate mission code "${code}" in ${where} and ${missionCodes.get(code)}`);
      missionCodes.set(code, where);
      assertLearnerSafe(m, where);

      const track = trackForContent(dir, m.trackId, where);
      const course = courseForTrack(track.slug);
      const vkey = `${course.slug}/${course.version}`;
      const missionId = stableId('mission', course.slug, String(course.version), slug);

      // Math missions: datasets + practice become one 'math' exercise (the Simulation's interactive part).
      const datasets = Array.isArray(m.datasets) ? (m.datasets as Obj[]) : [];
      const practice = Array.isArray(m.practice) ? (m.practice as Obj[]) : [];
      let mathExerciseId: string | null = null;
      if (dir === 'math' || datasets.length > 0) {
        const exSlug = `${slug}-practice`;
        if (exercises.some((x) => x.versionId === course.versionId && x.slug === exSlug)) fail(`${where}: exercise slug ${exSlug} collides`);
        const answers = practice.map((p) => {
          const pid = str(p.id, `${where} practice id`);
          const ds = datasets.find((d) => d.id === p.datasetId) ?? fail(`${where}: practice ${pid} references unknown dataset ${String(p.datasetId)}`);
          const values = (ds as Obj).values;
          if (!Array.isArray(values) || !values.every((v) => typeof v === 'number')) fail(`${where}: dataset ${String(ds.id)} needs numeric values`);
          const value = roundTo(statistic(str(p.statistic, `${where} practice ${pid} statistic`), values as number[], `${where} practice ${pid}`),
            typeof p.decimals === 'number' ? p.decimals : undefined);
          return { id: pid, type: 'numeric', expected: value, tolerance: p.tolerance ?? null } as Obj;
        });
        mathExerciseId = stableId('exercise', course.slug, String(course.version), exSlug);
        exercises.push({
          id: mathExerciseId, versionId: course.versionId, kind: 'math', slug: exSlug,
          title: `${String(m.title)}: practice`.slice(0, 160),
          definition: { schemaVersion: 1, missionSlug: slug, datasets, practice },
          expected: { schemaVersion: 1, derivedFrom: 'public datasets', items: answers },
          hiddenTests: [], source: where,
        });
      }

      // Assessment
      const items = isObj(m.assessment) && Array.isArray(m.assessment.items) ? (m.assessment.items as Obj[]) : [];
      let assessment: AssessmentRow | null = null;
      const keyFile = ['keys.json', 'key.json'].map((s) => join(mdir, `${slug}.${s}`)).find((p) => existsSync(p));
      if (items.length > 0) {
        if (!keyFile) fail(`${where}: has assessment items but no ${slug}.keys.json`);
        const keys = readJson(keyFile!);
        if (keys.missionSlug !== undefined && keys.missionSlug !== slug) fail(`${rel(keyFile!)}: missionSlug does not match ${slug}`);
        const keyItems = Array.isArray(keys.items) ? (keys.items as Obj[]) : fail(`${rel(keyFile!)}: items[] missing`);
        const asId = stableId('assessment', course.slug, String(course.version), `${slug}-assessment`);
        const passRaw = typeof m.passMark === 'number' ? m.passMark : fail(`${where}: passMark (0..1) is required with an assessment`);
        const passMark = passRaw <= 1 ? Math.round(passRaw * 10000) / 100 : passRaw;
        const seenItems = new Set<string>();
        const rows = items.map((it, i): ItemRow => {
          const itemId = str(it.id, `${where} assessment item ${i + 1} id`);
          if (seenItems.has(itemId)) fail(`${where}: duplicate assessment item id ${itemId}`);
          seenItems.add(itemId);
          const kind = ITEM_KINDS[String(it.type)] ?? fail(`${where}: item ${itemId} has invalid type "${String(it.type)}"`);
          const key = keyItems.find((k) => k.id === itemId) ?? fail(`${where}: assessment item ${itemId} has no key in ${rel(keyFile!)}`);
          if (key.type !== undefined && key.type !== it.type) fail(`${rel(keyFile!)}: item ${itemId} type does not match`);
          const { id: _id, type: _t, prompt, options, points, ...rest } = it;
          const promptObj: Obj = { itemId, text: str(prompt, `${where} item ${itemId} prompt`), ...rest };
          if (typeof it.datasetId === 'string') {
            promptObj.dataset = datasets.find((d) => d.id === it.datasetId) ?? fail(`${where}: item ${itemId} references unknown dataset ${it.datasetId}`);
          }
          if ((kind === 'single_choice' || kind === 'multi_choice') && !Array.isArray(options)) fail(`${where}: item ${itemId} needs options`);
          if (kind === 'single_choice') {
            const opt = String(key.correctOptionId);
            if (!(options as Obj[]).some((o) => o.id === opt)) fail(`${rel(keyFile!)}: item ${itemId} correctOptionId "${opt}" is not an option`);
          }
          const { id: _kid, rationale, ...correct } = key;
          return {
            id: stableId('assessment_item', course.slug, String(course.version), slug, itemId),
            assessmentId: asId, position: i + 1, kind, prompt: promptObj, options: (options ?? null) as Json,
            points: typeof points === 'number' && points > 0 ? points : 1,
            correct, explanation: typeof rationale === 'string' ? rationale : null,
          };
        });
        for (const k of keyItems) {
          if (!seenItems.has(String(k.id))) fail(`${rel(keyFile!)}: key ${String(k.id)} has no matching assessment item`);
        }
        assessment = {
          id: asId, versionId: course.versionId, slug: `${slug}-assessment`,
          title: `${code} assessment: ${String(m.title)}`.slice(0, 160), passMark, items: rows,
        };
        assessments.push(assessment);
      } else if (keyFile) {
        fail(`${rel(keyFile)}: keys without assessment items in ${where}`);
      }

      // Steps
      const stepsRaw = Array.isArray(m.steps) ? (m.steps as Obj[]) : fail(`${where}: steps[] is required`);
      if (stepsRaw.length === 0) fail(`${where}: steps[] is empty`);
      const usedKinds = new Set<string>();
      const steps = stepsRaw.map((s, i): StepRow => {
        const kind = String(s.kind ?? s.id);
        if (!(STEP_KINDS as readonly string[]).includes(kind)) fail(`${where}: step ${i + 1} has invalid kind "${kind}" (allowed: ${STEP_KINDS.join(', ')})`);
        if (usedKinds.has(kind)) fail(`${where}: duplicate step kind "${kind}"`);
        usedKinds.add(kind);
        const { id: stepId, title, kind: _k, ...rest } = s;
        let exerciseId: string | null = null;
        let assessmentId: string | null = null;
        if (kind === 'simulation') {
          // Step-level exerciseId wins; otherwise the mission-level exerciseId (content/excel/missions shape).
          const stepRefs = [...new Set(exerciseRefs(s))];
          const refs = stepRefs.length > 0 ? stepRefs : typeof m.exerciseId === 'string' ? [m.exerciseId] : [];
          if (refs.length > 1) fail(`${where}: simulation step references several exercises (${refs.join(', ')}); the schema links one`);
          if (refs.length === 1) {
            const ex = exercises.find((x) => x.versionId === course.versionId && x.slug === refs[0]);
            if (!ex) fail(`${where}: simulation step references exercise "${refs[0]}" which does not exist in content/excel/exercises`);
            exerciseId = ex!.id;
          } else if (mathExerciseId && hasBlockType(s, 'stats-explorer')) {
            exerciseId = mathExerciseId;
          } else {
            fail(`${where}: simulation step must reference an exercise (exerciseId)`);
          }
        }
        if (kind === 'assessment') {
          if (!assessment) fail(`${where}: assessment step but the mission has no assessment items`);
          assessmentId = assessment!.id;
        }
        return {
          id: stableId('mission_step', course.slug, String(course.version), slug, kind),
          missionId, position: i + 1, kind, title: str(title, `${where} step ${i + 1} title`),
          body: { stepId: String(stepId ?? kind), ...rest }, exerciseId, assessmentId,
        };
      });

      const row: MissionRow = {
        id: missionId, versionId: course.versionId, position: 0, slug, code,
        title: str(m.title, `${where} title`), summary: typeof m.summary === 'string' ? m.summary : null,
        estimatedMinutes: typeof m.estimatedMinutes === 'number' ? m.estimatedMinutes : null, steps, source: where,
      };
      perVersion.set(vkey, [...(perVersion.get(vkey) ?? []), row]);
    }
  }

  // Positions: by mission code (EX-101 < EX-102), then slug.
  for (const rows of perVersion.values()) {
    rows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.slug.localeCompare(b.slug));
    rows.forEach((r, i) => { r.position = i + 1; missions.push(r); });
  }
  missions.sort((a, b) => a.versionId.localeCompare(b.versionId) || a.position - b.position);
  exercises.sort((a, b) => a.versionId.localeCompare(b.versionId) || a.slug.localeCompare(b.slug));
  assessments.sort((a, b) => a.versionId.localeCompare(b.versionId) || a.slug.localeCompare(b.slug));

  // Every public payload is re-checked after transformation.
  for (const x of exercises) assertLearnerSafe(x.definition, `exercise ${x.slug}`);
  for (const a of assessments) for (const it of a.items) assertLearnerSafe({ p: it.prompt, o: it.options }, `assessment item ${a.slug}#${it.position}`);
  for (const m of missions) for (const s of m.steps) assertLearnerSafe(s.body, `mission ${m.slug} step ${s.kind}`);

  return { config, tracks, courses, exercises, assessments, missions };
}

// ---------------------------------------------------------------------------
// SQL rendering
// ---------------------------------------------------------------------------
const lit = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
const jsonb = (v: Json | null) => (v === null ? 'null' : `${lit(JSON.stringify(v))}::jsonb`);
const num = (v: number) => String(v);
const ts = (v: string) => `${lit(v)}::timestamptz`;

function insert(table: string, cols: string[], rows: string[][], conflict = 'on conflict do nothing'): string {
  if (rows.length === 0) return `-- ${table}: no rows\n`;
  return `insert into ${table} (${cols.join(', ')}) values\n${rows.map((r) => `  (${r.join(', ')})`).join(',\n')}\n${conflict};\n`;
}

export function renderCatalogueSql(model: SeedModel): string {
  const { config, tracks, courses, exercises, assessments, missions } = model;
  const at = config.publishedAt;
  const author = `(select id from auth.users where email = ${lit(config.seedActors.author.email)})`;
  const reviewer = `(select id from auth.users where email = ${lit(config.seedActors.reviewer.email)})`;
  const items = assessments.flatMap((a) => a.items);
  const steps = missions.flatMap((m) => m.steps);
  const out: string[] = [];

  out.push(`-- FlightDeck catalogue seed (FD-C01). GENERATED FILE: do not edit by hand.
-- Source: content/** + packages/database/seeds/catalogue.config.json
-- Regenerate: pnpm --filter @flightdeck/database seed:generate
-- Counts: tracks=${tracks.length} courses=${courses.length} course_versions=${courses.length} missions=${missions.length} mission_steps=${steps.length} exercises=${exercises.length} exercise_keys=${exercises.length} assessments=${assessments.length} assessment_items=${items.length} assessment_item_keys=${items.length}
-- Public tables receive learner-safe data only; answer keys and hidden tests go to app_private only.
-- Requires the seed author and reviewer in auth.users (local/test: seeds/local-users.sql; production: see docs/data/CATALOGUE-SEEDING.md).
-- Idempotent: every insert is "on conflict do nothing". Published rows are never updated: a content change is a new course version.

begin;

do $$
begin
  if (select count(*) from auth.users where email in (${lit(config.seedActors.author.email)}, ${lit(config.seedActors.reviewer.email)})) <> 2 then
    raise exception 'catalogue seed: seed author/reviewer missing from auth.users (apply seeds/local-users.sql locally, or create the accounts; see docs/data/CATALOGUE-SEEDING.md)';
  end if;
end;
$$;
`);

  out.push('\n-- Tracks\n' + insert('public.tracks', ['id', 'slug', 'title', 'sort_order', 'status', 'published_at'],
    tracks.map((t) => [lit(t.id), lit(t.slug), lit(t.title), num(t.sortOrder), lit(t.status), t.status === 'published' ? ts(at) : 'null'])));

  out.push('\n-- Courses\n' + insert('public.courses', ['id', 'track_id', 'slug', 'title', 'summary', 'level', 'is_free', 'status', 'published_at'],
    courses.map((c) => [lit(c.id), lit(c.trackId), lit(c.slug), lit(c.title), lit(c.summary), lit(c.level), String(c.isFree), lit('published'), ts(at)])));

  out.push('\n-- Course versions (published; a new content round = a new version row)\n' + insert('public.course_versions',
    ['id', 'course_id', 'version', 'status', 'created_by', 'published_by', 'published_at', 'change_note', 'created_at'],
    courses.map((c) => [lit(c.versionId), lit(c.id), num(c.version), lit('published'), author, reviewer, ts(at), lit(c.changeNote), ts(at)])));

  out.push('\n-- Review record: the seed reviewer was the assigned reviewer of each seeded version\n' + insert('app_private.review_assignments',
    ['course_version_id', 'reviewer_id', 'assigned_by', 'assigned_at'],
    courses.map((c) => [lit(c.versionId), reviewer, author, ts(at)])));

  out.push('\n-- Exercises (learner-safe definition only)\n' + insert('public.exercises', ['id', 'course_version_id', 'kind', 'slug', 'title', 'definition'],
    exercises.map((x) => [lit(x.id), lit(x.versionId), lit(x.kind), lit(x.slug), lit(x.title), jsonb(x.definition)])));

  out.push('\n-- Exercise keys (SERVER-ONLY: expected values and hidden tests)\n' + insert('app_private.exercise_keys', ['exercise_id', 'expected', 'hidden_tests', 'updated_at'],
    exercises.map((x) => [lit(x.id), jsonb(x.expected), jsonb(x.hiddenTests), ts(at)])));

  out.push('\n-- Assessments\n' + insert('public.assessments', ['id', 'course_version_id', 'slug', 'title', 'pass_mark', 'max_attempts'],
    assessments.map((a) => [lit(a.id), lit(a.versionId), lit(a.slug), lit(a.title), num(a.passMark), '3'])));

  out.push('\n-- Assessment items (prompt and options only)\n' + insert('public.assessment_items', ['id', 'assessment_id', 'position', 'kind', 'prompt', 'options', 'points'],
    items.map((i) => [lit(i.id), lit(i.assessmentId), num(i.position), lit(i.kind), jsonb(i.prompt), jsonb(i.options), num(i.points)])));

  out.push('\n-- Assessment item keys (SERVER-ONLY)\n' + insert('app_private.assessment_item_keys', ['item_id', 'correct', 'explanation'],
    items.map((i) => [lit(i.id), jsonb(i.correct), lit(i.explanation)])));

  out.push('\n-- Missions\n' + insert('public.missions', ['id', 'course_version_id', 'position', 'slug', 'title', 'summary'],
    missions.map((m) => [lit(m.id), lit(m.versionId), num(m.position), lit(m.slug), lit(m.title), lit(m.summary)])));

  out.push('\n-- Mission steps\n' + insert('public.mission_steps', ['id', 'mission_id', 'position', 'kind', 'title', 'body', 'exercise_id', 'assessment_id'],
    steps.map((s) => [lit(s.id), lit(s.missionId), num(s.position), lit(s.kind), lit(s.title), jsonb(s.body), lit(s.exerciseId), lit(s.assessmentId)])));

  out.push(`\n-- Audit trail for the seeded publications (once per version)
insert into app_private.audit_log (at, actor_id, action, entity, entity_id, detail)
select ${ts(at)}, ${reviewer}, 'publish', 'course_version', v.id::text,
       jsonb_build_object('course_id', v.course_id, 'version', v.version, 'source', 'catalogue seed')
  from public.course_versions v
 where v.id in (${courses.map((c) => lit(c.versionId)).join(', ')})
   and not exists (select 1 from app_private.audit_log l
                    where l.entity = 'course_version' and l.entity_id = v.id::text and l.action = 'publish');

commit;
`);
  return out.join('');
}

export function renderLocalUsersSql(config: SeedConfig): string {
  const { author, reviewer } = config.seedActors;
  return `-- FlightDeck LOCAL/TEST seed users (FD-C01). GENERATED FILE: do not edit by hand.
-- NEVER apply to production. Placeholder accounts with no password: they cannot sign in.
-- Apply BEFORE seeds/catalogue.sql on a local Supabase (supabase db reset) or the PGlite test harness.
-- The on_auth_user_created trigger also gives each a profile, preferences and the learner role.

begin;

do $$
begin
  if coalesce(current_setting('flightdeck.allow_local_seed_users', true), '') = 'off' then
    raise exception 'local-users.sql is for local/test databases only';
  end if;
end;
$$;

${insert('auth.users', ['id', 'email'], [[lit(author.id), lit(author.email)], [lit(reviewer.id), lit(reviewer.email)]])}
${insert('public.user_roles', ['user_id', 'role'], [[lit(author.id), lit('author')], [lit(reviewer.id), lit('reviewer')]])}
commit;
`;
}

export type SeedOutput = { catalogueSql: string; localUsersSql: string; model: SeedModel };

export function generateSeed(root = REPO_ROOT): SeedOutput {
  const model = buildModel(root);
  return { catalogueSql: renderCatalogueSql(model), localUsersSql: renderLocalUsersSql(model.config), model };
}

export const OUTPUT_FILES = {
  catalogue: join(SEEDS_DIR, 'catalogue.sql'),
  localUsers: join(SEEDS_DIR, 'local-users.sql'),
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { catalogueSql, localUsersSql, model } = generateSeed();
    const files: [string, string][] = [[OUTPUT_FILES.catalogue, catalogueSql], [OUTPUT_FILES.localUsers, localUsersSql]];
    if (process.argv.includes('--check')) {
      const stale = files.filter(([f, sql]) => !existsSync(f) || readFileSync(f, 'utf8') !== sql).map(([f]) => rel(f));
      if (stale.length) {
        console.error(`Seed drift: ${stale.join(', ')} out of date. Run: pnpm --filter @flightdeck/database seed:generate`);
        process.exit(1);
      }
      console.log('Seed files are up to date.');
    } else {
      for (const [f, sql] of files) writeFileSync(f, sql);
      const items = model.assessments.reduce((n, a) => n + a.items.length, 0);
      const steps = model.missions.reduce((n, m) => n + m.steps.length, 0);
      console.log(`Wrote ${files.map(([f]) => rel(f)).join(', ')}: tracks=${model.tracks.length} courses=${model.courses.length} missions=${model.missions.length} steps=${steps} exercises=${model.exercises.length} assessments=${model.assessments.length} items=${items}`);
    }
  } catch (e) {
    console.error(e instanceof SeedError ? e.message : e);
    process.exit(1);
  }
}
