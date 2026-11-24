// SERVER-ONLY (ADR-015, stage 2c/2e). Turns what an author typed (EditorDoc) into the four stored documents:
//   mission (learner-safe), exercise (learner-safe), keys (assessment answers) and exerciseKey (sheet answers).
// The author types a SOLUTION (formulas); the engine works the expected values out, so nobody types a computed answer by hand.
// buildContent always returns best-effort documents plus `issues`: a draft may be saved with issues, but a mission
// can only be sent for review when `issues` is empty (the same gates the built-in content passes in all-missions.test.ts
// and the seed leak tests SEED-T06/T07).
import {
  checkExercise,
  collectFunctions,
  evaluateSheet,
  isCellError,
  isSupportedFunction,
  parseFormula,
  SUPPORTED_FUNCTIONS,
  validateSubmission,
  type CellValue,
  type ExerciseDefinition,
  type ExerciseKey,
  type ExpectedValue,
  type FunctionName,
} from "@flightdeck/excel-engine";
import {
  validateExcelMission,
  type ExcelAnswerKeyItem,
  type ExcelAssessmentItem,
  type ExcelMission,
  type ExcelMissionBlock,
  type ExcelMissionKeys,
} from "../../components/excel/missions";
import { expandCells, parseOverrides, PLACEHOLDER, STEP_ORDER, STEP_TITLES, type AuthorLevel, type EditorDoc, type EditorQuestion } from "../../lib/author/doc";

/** Stored beside the sheet answer key; server-only. `doc` is the author's whole form so editing round-trips exactly. */
export interface Authoring {
  doc?: EditorDoc;
  /** Imported built-in missions: the reference solution, so they can be edited too. */
  solution?: Record<string, string>;
}
export type StoredExerciseKey = ExerciseKey & { authoring?: Authoring };

export interface BuiltContent {
  mission: ExcelMission;
  exercise: ExerciseDefinition;
  keys: ExcelMissionKeys;
  exerciseKey: StoredExerciseKey;
  /** Plain-language problems; empty means the mission may be sent for review. */
  issues: string[];
}

const MAX_TEXT = 6000;
const LEVELS: AuthorLevel[] = ["beginner", "intermediate", "advanced"];
const TOL = 0.000001;
const canon = (k: string) => k.trim().toUpperCase();

function toExpected(v: CellValue): ExpectedValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (isCellError(v)) return { error: v.error };
  return v;
}

function sheetValues(cells: Record<string, string>, ex: Pick<ExerciseDefinition, "grid">, issues: string[], where: string): Record<string, CellValue> {
  try {
    return evaluateSheet(cells, { maxRows: ex.grid.rows, maxCols: ex.grid.cols });
  } catch (e) {
    issues.push(`${where}: the sheet could not be calculated (${e instanceof Error ? e.message : "error"}).`);
    return {};
  }
}

function texts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) texts(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) texts(v, out);
  return out;
}

const cleanBlock = (b: ExcelMissionBlock): ExcelMissionBlock => {
  switch (b.type) {
    case "paragraph":
      return { type: "paragraph", text: String(b.text ?? "").trim() };
    case "list":
      return { type: "list", items: (b.items ?? []).map((s) => String(s).trim()).filter(Boolean) };
    case "formula":
      return { type: "formula", formula: String(b.formula ?? "").trim(), text: String(b.text ?? "").trim() };
    case "table":
      return { type: "table", caption: String(b.caption ?? "").trim(), columns: (b.columns ?? []).map((s) => String(s).trim()), rows: (b.rows ?? []).map((r) => r.map((s) => String(s).trim())) };
    case "assessment-items":
      return { type: "assessment-items", itemIds: (b.itemIds ?? []).map(String) };
    default:
      return { type: b.type } as ExcelMissionBlock;
  }
};

export function buildContent(doc: EditorDoc, previousPublished?: ExerciseDefinition | null): BuiltContent {
  const issues: string[] = [];
  const sh = doc.sheet;

  // ---- sheet ------------------------------------------------------------------------------------------------
  const starter: Record<string, string> = {};
  for (const [k, v] of Object.entries(sh.starter ?? {})) {
    const val = String(v ?? "");
    if (val.trim() !== "") starter[canon(k)] = val;
  }
  const ed = expandCells(sh.editable ?? "");
  if (ed.bad.length) issues.push(`Editable cells: "${ed.bad.join(", ")}" are not cell references (write them like F2:F6, G2).`);
  if (ed.cells.length === 0) issues.push("Choose at least one cell the learner fills in.");
  const solution: Record<string, string> = {};
  for (const [k, v] of Object.entries(sh.solution ?? {})) if (String(v ?? "").trim() !== "") solution[canon(k)] = String(v).trim();

  const used: FunctionName[] = [];
  for (const cell of ed.cells) {
    const f = solution[cell];
    if (f === undefined) {
      issues.push(`Cell ${cell} needs your solution (the formula or value a perfect answer would have).`);
      continue;
    }
    if (!f.startsWith("=")) continue;
    try {
      for (const name of collectFunctions(parseFormula(f))) if (!used.includes(name)) used.push(name);
    } catch (e) {
      issues.push(`Solution ${cell}: ${e instanceof Error ? e.message : "formula not understood"}.`);
    }
  }
  for (const k of Object.keys(solution)) if (!ed.cells.includes(k)) issues.push(`A solution is given for ${k}, which the learner is not allowed to edit.`);
  const extras = (sh.extraFunctions ?? []).map((s) => String(s).toUpperCase()).filter(isSupportedFunction);
  const allowedFunctions = [...new Set<FunctionName>([...used, ...extras])];

  const hints = (sh.hints ?? []).map((s) => String(s).trim()).filter(Boolean);
  let version = Math.max(1, Math.trunc(Number(sh.version) || 1));
  const exercise: ExerciseDefinition = {
    schemaVersion: 1,
    id: String(sh.id ?? "").trim(),
    version,
    title: String(sh.title ?? "").trim(),
    objective: String(sh.objective ?? "").trim(),
    instructions: String(sh.instructions ?? "").trim(),
    grid: { rows: Math.trunc(Number(sh.rows) || 0), cols: Math.trunc(Number(sh.cols) || 0) },
    starter,
    editableCells: ed.cells,
    allowedFunctions,
    hints,
    namedRanges: {},
    timeoutMs: 500,
  };
  // The sheet rules are immutable per version: any change from the published sheet must be a new version.
  if (previousPublished && previousPublished.id === exercise.id) {
    // Order never matters: the same cells and functions in another order are the same sheet.
    const shape = (e: ExerciseDefinition) =>
      JSON.stringify([e.grid, Object.entries(e.starter).sort(([x], [y]) => x.localeCompare(y)), [...e.editableCells].sort(), [...e.allowedFunctions].sort()]);
    const same = (a: ExerciseDefinition, b: ExerciseDefinition) => shape(a) === shape(b);
    version = same(previousPublished, exercise) ? previousPublished.version : Math.max(version, previousPublished.version + 1);
    exercise.version = version;
  }
  if (!exercise.title || !exercise.objective || !exercise.instructions) issues.push("The practice sheet needs a title, an objective and instructions.");
  if (hints.length === 0) issues.push("Add at least one hint for the practice sheet.");
  for (const p of checkExercise(exercise)) issues.push(`Practice sheet: ${p}.`);

  // ---- sheet answer key (expected values come from the engine, not from the author) ----------------------------
  const base = { ...starter, ...solution };
  const values = sheetValues(base, exercise, issues, "Solution");
  const expected: ExerciseKey["expected"] = [];
  for (const cell of ed.cells) {
    const v = toExpected(values[cell] ?? null);
    if (solution[cell] !== undefined && v === undefined) issues.push(`Your solution for ${cell} produces an empty result.`);
    if (v !== undefined) {
      if (typeof v === "object" && "error" in v) issues.push(`Your solution for ${cell} produces an error (${v.error}).`);
      expected.push({ id: `chk-${cell.toLowerCase()}`, cell, value: v, ...(typeof v === "number" ? { tolerance: TOL } : {}), label: (sh.labels?.[cell] ?? "").trim() || `Result in ${cell}` });
    }
  }
  const requireFunctions: Record<string, FunctionName[]> = {};
  for (const [cell, text] of Object.entries(sh.requireFunctions ?? {})) {
    const c = canon(cell);
    const names = String(text ?? "").split(/[,\s]+/).map((s) => s.toUpperCase()).filter(Boolean);
    if (names.length === 0) continue;
    const ok = names.filter(isSupportedFunction);
    if (ok.length !== names.length) issues.push(`Required functions for ${c}: ${names.filter((n) => !isSupportedFunction(n)).join(", ")} is not a supported function.`);
    if (ok.length) requireFunctions[c] = ok;
  }
  const hiddenTests: ExerciseKey["hiddenTests"] = [];
  const seenScenario = new Set<string>();
  for (const sc of sh.scenarios ?? []) {
    const id = String(sc.id ?? "").trim() || `scenario-${hiddenTests.length + 1}`;
    const { overrides, bad } = parseOverrides(sc.overrides ?? "");
    if (bad.length) issues.push(`What-if "${sc.label}": "${bad.join(", ")}" should look like C2=160 (one change per line).`);
    if (Object.keys(overrides).length === 0 || !String(sc.label ?? "").trim()) {
      if (Object.keys(overrides).length || String(sc.label ?? "").trim()) issues.push("Each what-if needs a name and at least one input change.");
      continue;
    }
    if (seenScenario.has(id)) issues.push(`Two what-ifs share the id ${id}.`);
    seenScenario.add(id);
    const vv = sheetValues({ ...starter, ...overrides, ...solution }, exercise, issues, `What-if "${sc.label}"`);
    const expect: Record<string, ExpectedValue> = {};
    for (const cell of ed.cells) {
      const v = toExpected(vv[cell] ?? null);
      if (v !== undefined) expect[cell] = v;
    }
    hiddenTests.push({ id, label: String(sc.label).trim(), overrides, expect, tolerance: TOL });
  }
  if (hiddenTests.length === 0) issues.push("Add at least one what-if (change an input cell and the answers must follow), so typing the numbers cannot pass.");
  const exerciseKey: StoredExerciseKey = {
    schemaVersion: 1,
    exerciseId: exercise.id,
    exerciseVersion: exercise.version,
    expected,
    requireFormula: ed.cells.filter((c) => solution[c]?.startsWith("=")),
    ...(Object.keys(requireFunctions).length ? { requireFunctions } : {}),
    hiddenTests,
    passThreshold: 100,
    authoring: { doc },
  };

  // ---- questions + keys ---------------------------------------------------------------------------------------
  const items: ExcelAssessmentItem[] = [];
  const keyItems: ExcelAnswerKeyItem[] = [];
  for (const q of doc.questions ?? []) {
    const id = String(q.id ?? "").trim();
    const prompt = String(q.prompt ?? "").trim();
    const rationale = String(q.rationale ?? "").trim();
    if (!/^[a-z0-9-]{1,40}$/.test(id)) issues.push(`Question id "${id}" must use lowercase letters, digits and dashes.`);
    if (!prompt) issues.push(`Question ${id}: write the question.`);
    if (rationale.length < 15) issues.push(`Question ${id}: explain why the answer is right (at least a sentence).`);
    if (q.type === "numeric") {
      const hint = String(q.answerHint ?? "").trim();
      items.push({ id, type: "numeric", prompt, ...(hint ? { answerHint: hint } : {}) });
      const exp = Number(String(q.expected).trim());
      const tol = String(q.tolerance ?? "").trim() === "" ? 0.01 : Number(q.tolerance);
      if (String(q.expected).trim() === "" || !Number.isFinite(exp)) issues.push(`Question ${id}: the correct answer must be a number.`);
      if (!Number.isFinite(tol) || tol < 0) issues.push(`Question ${id}: the allowed difference must be zero or a positive number.`);
      keyItems.push({ id, type: "numeric", expected: Number.isFinite(exp) ? exp : 0, tolerance: { kind: "absolute", value: Number.isFinite(tol) && tol >= 0 ? tol : 0.01 }, rationale });
    } else {
      const options = (q.options ?? []).map((o) => ({ id: String(o.id).trim(), label: String(o.label).trim() }));
      if (options.some((o) => !o.id || !o.label)) issues.push(`Question ${id}: every choice needs text.`);
      if (new Set(options.map((o) => o.id)).size !== options.length) issues.push(`Question ${id}: choice ids must be different.`);
      if (!options.some((o) => o.id === q.correctOptionId)) issues.push(`Question ${id}: pick which choice is correct.`);
      items.push({ id, type: "single-choice", prompt, options });
      keyItems.push({ id, type: "single-choice", correctOptionId: String(q.correctOptionId ?? ""), rationale });
    }
  }

  // ---- mission ------------------------------------------------------------------------------------------------
  const steps = STEP_ORDER.map((sid) => {
    const s = (doc.steps ?? []).find((x) => x.id === sid);
    return { id: sid, title: String(s?.title ?? "").trim() || STEP_TITLES[sid], blocks: (s?.blocks ?? []).map(cleanBlock) };
  });
  for (const s of steps) {
    for (const b of s.blocks) {
      if (b.type === "paragraph" && !b.text) issues.push(`${STEP_TITLES[s.id]}: a paragraph is empty.`);
      if (b.type === "list" && b.items.length === 0) issues.push(`${STEP_TITLES[s.id]}: a bullet list is empty.`);
      if (b.type === "formula" && (!b.formula || !b.text)) issues.push(`${STEP_TITLES[s.id]}: a formula example needs the formula and an explanation.`);
      if (b.type === "table" && (b.columns.length === 0 || b.columns.some((c) => !c))) issues.push(`${STEP_TITLES[s.id]}: a table needs named columns.`);
    }
  }
  const level = LEVELS.includes(doc.level) ? doc.level : "beginner";
  const pass = Number(doc.passMarkPct) / 100;
  const mission: ExcelMission = {
    schemaVersion: 1,
    slug: String(doc.slug ?? "").trim(),
    trackId: "excel",
    code: String(doc.code ?? "").trim().toUpperCase(),
    title: String(doc.title ?? "").trim(),
    summary: String(doc.summary ?? "").trim(),
    estimatedMinutes: Math.trunc(Number(doc.estimatedMinutes) || 0),
    level,
    passMark: Number.isFinite(pass) ? pass : 0,
    exerciseId: exercise.id,
    steps,
    assessment: { items },
  };
  const keys: ExcelMissionKeys = { schemaVersion: 1, missionSlug: mission.slug, items: keyItems };
  if (!mission.title || !mission.summary) issues.push("The mission needs a title and a one-sentence summary.");
  if (!(mission.estimatedMinutes >= 1 && mission.estimatedMinutes <= 240)) issues.push("Estimated minutes must be between 1 and 240.");
  if (!LEVELS.includes(doc.level)) issues.push("Pick a level.");
  for (const p of validateExcelMission(mission, exercise, keys)) issues.push(p.charAt(0).toUpperCase() + p.slice(1) + ".");

  // ---- size + placeholders ------------------------------------------------------------------------------------
  const all = texts({ mission, exercise });
  if (all.some((t) => t.length > MAX_TEXT)) issues.push("One of the texts is too long (limit 6,000 characters).");
  if (all.some((t) => t.includes(PLACEHOLDER))) issues.push(`Some text still says ${PLACEHOLDER}: replace every ${PLACEHOLDER} line with your own words.`);

  // ---- gates the built-in content passes (grader accepts the solution, rejects empty and typed answers) ----------
  if (issues.length === 0) {
    const sub = (cells: Record<string, string>) => ({ exerciseId: exercise.id, exerciseVersion: exercise.version, cells });
    const solved = validateSubmission(exercise, sub(solution), exerciseKey);
    if (!solved.passed) issues.push(`Your own solution does not pass the checks: ${solved.checks.filter((c) => !c.passed).map((c) => c.message).join(" | ") || solved.rejected?.message || "unknown reason"}.`);
    if (validateSubmission(exercise, sub({}), exerciseKey).passed) issues.push("An empty sheet would pass. Add checks so the learner has to do the work.");
    const typed: Record<string, string> = {};
    for (const e of expected) typed[e.cell] = String(e.value);
    if (validateSubmission(exercise, sub(typed), exerciseKey).passed) issues.push("Typing the answers (instead of building formulas) would pass. Add a what-if or require formulas.");
  }

  // ---- leak scan (SEED-T06 / SEED-T07 rules) ------------------------------------------------------------------
  const prose = JSON.stringify([exercise.title, exercise.objective, exercise.instructions, exercise.hints]);
  const starterValues = new Set(Object.values(starter).map(String));
  for (const e of expected) {
    if (typeof e.value !== "number" || starterValues.has(String(e.value))) continue;
    if (new RegExp(`(?<![\\w.$])${String(e.value).replace(".", "\\.")}(?![\\d.])`).test(prose)) issues.push(`The instructions or hints spell out an answer (${e.value} for ${e.cell}). Take it out.`);
    if (starter[e.cell] !== undefined) issues.push(`Cell ${e.cell} is pre-filled in the starter sheet but is meant to be the learner's answer.`);
  }
  const own = JSON.stringify([mission.assessment.items, mission.steps]);
  for (const k of keyItems) {
    if (k.type === "numeric" && Number.isFinite(k.expected) && !Number.isInteger(k.expected) && own.includes(String(k.expected))) issues.push(`Question ${k.id}: the answer ${k.expected} appears in the learner-facing text.`);
  }
  const publicJson = JSON.stringify({ mission, exercise });
  for (const marker of ['"correctOptionId"', '"rationale"', '"expected"', '"hiddenTests"', '"requireFormula"', '"requireFunctions"', '"passThreshold"']) {
    if (publicJson.includes(marker)) issues.push("Internal answer fields leaked into the learner-facing content.");
  }

  return { mission, exercise, keys, exerciseKey, issues: [...new Set(issues)] };
}

/** Rebuilds the editor form from stored documents. Content that was authored here round-trips exactly. */
export function contentToDoc(item: {
  slug: string;
  level: string;
  mission: ExcelMission;
  exercise: ExerciseDefinition | null;
  keys: ExcelMissionKeys;
  exerciseKey: StoredExerciseKey | null;
}): EditorDoc {
  const stored = item.exerciseKey?.authoring?.doc;
  if (stored && stored.slug === item.slug) return { ...stored, slug: item.slug, level: (LEVELS.includes(item.level as AuthorLevel) ? item.level : stored.level) as AuthorLevel };

  const m = item.mission;
  const ex = item.exercise;
  const key = item.exerciseKey;
  const keyById = new Map(item.keys.items.map((k) => [k.id, k]));
  const questions: EditorQuestion[] = m.assessment.items.map((it) => {
    const k = keyById.get(it.id);
    if (it.type === "numeric") {
      return { id: it.id, type: "numeric", prompt: it.prompt, answerHint: it.answerHint ?? "", options: [], expected: k?.type === "numeric" ? String(k.expected) : "", tolerance: k?.type === "numeric" ? String(k.tolerance.value) : "0.01", correctOptionId: "", rationale: k?.rationale ?? "" };
    }
    return { id: it.id, type: "single-choice", prompt: it.prompt, answerHint: "", options: it.options.map((o) => ({ ...o })), expected: "", tolerance: "", correctOptionId: k?.type === "single-choice" ? k.correctOptionId : "", rationale: k?.rationale ?? "" };
  });
  const solution = key?.authoring?.solution ?? {};
  const used = new Set<string>();
  for (const f of Object.values(solution)) {
    try {
      for (const n of collectFunctions(parseFormula(f))) used.add(n);
    } catch {
      /* an unparsable reference solution simply contributes no functions */
    }
  }
  return {
    slug: item.slug,
    code: m.code,
    title: m.title,
    summary: m.summary,
    level: (LEVELS.includes(m.level) ? m.level : "beginner") as AuthorLevel,
    estimatedMinutes: m.estimatedMinutes,
    passMarkPct: Math.round(m.passMark * 100),
    steps: STEP_ORDER.map((sid) => {
      const s = m.steps.find((x) => x.id === sid);
      return { id: sid, title: s?.title ?? STEP_TITLES[sid], blocks: s?.blocks ?? [] };
    }),
    questions,
    sheet: {
      id: ex?.id ?? m.exerciseId,
      version: ex?.version ?? 1,
      title: ex?.title ?? "",
      objective: ex?.objective ?? "",
      instructions: ex?.instructions ?? "",
      rows: ex?.grid.rows ?? 6,
      cols: ex?.grid.cols ?? 4,
      starter: { ...(ex?.starter ?? {}) },
      editable: (ex?.editableCells ?? []).join(", "),
      extraFunctions: (ex?.allowedFunctions ?? []).filter((f) => !used.has(f) && (SUPPORTED_FUNCTIONS as readonly string[]).includes(f)),
      hints: [...(ex?.hints ?? [])],
      solution: { ...solution },
      labels: Object.fromEntries((key?.expected ?? []).map((e) => [e.cell, e.label])),
      requireFunctions: Object.fromEntries(Object.entries(key?.requireFunctions ?? {}).map(([c, f]) => [c, f.join(", ")])),
      scenarios: (key?.hiddenTests ?? []).map((t) => ({ id: t.id, label: t.label, overrides: Object.entries(t.overrides).map(([c, v]) => `${c}=${v}`).join("\n") })),
    },
  };
}
