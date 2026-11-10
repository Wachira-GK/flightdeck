import { tokenize } from "./lexer";
import { collectFunctions, isSupportedFunction, parseFormula, SUPPORTED_FUNCTIONS, type FunctionName } from "./parser";
import { columnToLetters, compareKeys, parseKey, toKey } from "./refs";
import { evaluateSheet } from "./workbook";
import {
  DEFAULT_LIMITS,
  ENGINE_VERSION,
  isCellError,
  resolveLimits,
  type CellValue,
  type ErrorCode,
  type Limits,
} from "./types";

export const VALIDATOR_VERSION = `excel-validator@0.1.0+engine@${ENGINE_VERSION}`;

/** Hard cap on a submission payload (threat model CT5 / DB-I03). */
export const MAX_SUBMISSION_BYTES = 256 * 1024;

/**
 * Learner-safe exercise definition. Safe to ship to the browser: it contains no expected values.
 * Contract: content/excel/EXERCISE-SPEC.md.
 */
export interface ExerciseDefinition {
  schemaVersion: 1;
  id: string;
  /** Immutable version; any change to the starter grid or rules needs a new version. */
  version: number;
  title: string;
  objective: string;
  instructions: string;
  /** Visible grid size; must fit the engine limits (100 x 30). */
  grid: { rows: number; cols: number };
  /** Starter inputs ("=..." for formulas). This is also the reset state. */
  starter: Record<string, string>;
  /** Cells the learner may change. Everything else is locked. */
  editableCells: string[];
  /** Functions this exercise allows (a subset of the engine allow-list). */
  allowedFunctions: FunctionName[];
  hints: string[];
  /** Named ranges are not supported in v0; must be empty. Kept for contract compatibility. */
  namedRanges: Record<string, string>;
  /** Calculation budget. Grid rows/cols come from `grid`. */
  limits?: Partial<Omit<Limits, "maxRows" | "maxCols">>;
  /** Hard recalculation timeout for the browser Worker, in ms (default 500). */
  timeoutMs?: number;
}

/** A value an answer key expects. Errors are written as { "error": "#DIV/0!" }. */
export type ExpectedValue = number | string | boolean | { error: ErrorCode };

export interface ExpectedCheck {
  id: string;
  cell: string;
  value: ExpectedValue;
  /** Absolute tolerance for numbers (default 1e-9, scaled for large values). */
  tolerance?: number;
  /** Text comparison is case- and outer-space-insensitive unless true. */
  caseSensitive?: boolean;
  /** Learner-facing label; must not reveal the expected value. */
  label: string;
  weight?: number;
}

export interface HiddenTest {
  id: string;
  /** Inputs to change (non-editable cells only), proving the learner used formulas. */
  overrides: Record<string, string>;
  expect: Record<string, ExpectedValue>;
  /** Learner-facing description; must not reveal inputs or expected values. */
  label: string;
  tolerance?: number;
  caseSensitive?: boolean;
  weight?: number;
}

/** SERVER-ONLY answer key (later stored in app_private.exercise_keys). Never ship to the browser. */
export interface ExerciseKey {
  schemaVersion: 1;
  exerciseId: string;
  exerciseVersion: number;
  expected: ExpectedCheck[];
  /** Cells that must contain a formula (not a typed constant). */
  requireFormula: string[];
  /** Functions a cell's formula must use, e.g. { "B5": ["SUM"] }. */
  requireFunctions?: Record<string, FunctionName[]>;
  hiddenTests: HiddenTest[];
  /** Minimum score to pass (default 100). */
  passThreshold?: number;
}

export interface Submission {
  exerciseId: string;
  exerciseVersion: number;
  /** Learner inputs for editable cells. Other fields are ignored (never trusted). */
  cells: Record<string, string>;
}

export type RejectCode =
  | "too_large"
  | "malformed"
  | "wrong_exercise"
  | "invalid_ref"
  | "outside_grid"
  | "locked_cell"
  | "disallowed_function"
  | "unsupported_formula"
  | "invalid_exercise";

export type CheckKind = "structure" | "formula" | "function" | "value" | "hidden" | "filled";

export interface ValidationCheck {
  id: string;
  kind: CheckKind;
  passed: boolean;
  message: string;
  cell?: string;
}

export interface ValidationResult {
  passed: boolean;
  score: number;
  checks: ValidationCheck[];
  validatorVersion: string;
  /** Present when the submission was rejected before grading. */
  rejected?: { code: RejectCode; message: string };
  /** "graded" with an answer key; "structure-only" without one (practice in the browser). */
  mode: "graded" | "structure-only";
  /** Server-recomputed values of the editable cells (evidence). */
  computed: Record<string, CellValue>;
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function reject(code: RejectCode, message: string): ValidationResult {
  return {
    passed: false,
    score: 0,
    checks: [{ id: `reject:${code}`, kind: "structure", passed: false, message }],
    validatorVersion: VALIDATOR_VERSION,
    rejected: { code, message },
    mode: "graded",
    computed: {},
  };
}

function canonicalKey(ref: string): string | null {
  const a = parseKey(ref);
  return a ? toKey(a) : null;
}

function inExerciseGrid(key: string, ex: ExerciseDefinition): boolean {
  const a = parseKey(key);
  return a !== null && a.row < ex.grid.rows && a.col < ex.grid.cols;
}

/** Engine limits for an exercise: its calculation budget plus its grid size. */
export function exerciseLimits(ex: ExerciseDefinition): Limits {
  return resolveLimits({ ...ex.limits, maxRows: ex.grid.rows, maxCols: ex.grid.cols });
}

/** Static checks on an exercise definition (and key, when given). Returns problems; empty = valid. */
export function checkExercise(ex: ExerciseDefinition, key?: ExerciseKey): string[] {
  const problems: string[] = [];
  if (ex.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.id)) problems.push("id must be kebab-case");
  if (!Number.isInteger(ex.version) || ex.version < 1) problems.push("version must be a positive integer");
  const g = ex.grid;
  if (!Number.isInteger(g.rows) || g.rows < 1 || g.rows > DEFAULT_LIMITS.maxRows) problems.push("grid.rows out of range");
  if (!Number.isInteger(g.cols) || g.cols < 1 || g.cols > DEFAULT_LIMITS.maxCols) problems.push("grid.cols out of range");
  for (const k of Object.keys(ex.starter)) {
    if (canonicalKey(k) !== k) problems.push(`starter key ${k} is not a canonical cell key`);
    else if (!inExerciseGrid(k, ex)) problems.push(`starter cell ${k} is outside the grid`);
  }
  for (const k of ex.editableCells) {
    if (canonicalKey(k) !== k) problems.push(`editable cell ${k} is not a canonical cell key`);
    else if (!inExerciseGrid(k, ex)) problems.push(`editable cell ${k} is outside the grid`);
  }
  for (const f of ex.allowedFunctions) if (!isSupportedFunction(f)) problems.push(`allowedFunctions has unsupported ${f}`);
  if (Object.keys(ex.namedRanges ?? {}).length > 0) problems.push("namedRanges are not supported in v0");
  if (key) {
    if (key.exerciseId !== ex.id || key.exerciseVersion !== ex.version) problems.push("key does not match exercise id/version");
    const editable = new Set(ex.editableCells);
    for (const c of key.expected) if (!inExerciseGrid(c.cell, ex)) problems.push(`expected cell ${c.cell} is outside the grid`);
    for (const c of key.requireFormula) if (!editable.has(c)) problems.push(`requireFormula cell ${c} is not editable`);
    for (const [c, fns] of Object.entries(key.requireFunctions ?? {})) {
      if (!editable.has(c)) problems.push(`requireFunctions cell ${c} is not editable`);
      for (const f of fns) if (!ex.allowedFunctions.includes(f)) problems.push(`requireFunctions ${f} is not allowed`);
    }
    for (const t of key.hiddenTests) {
      for (const c of Object.keys(t.overrides)) {
        if (!inExerciseGrid(c, ex)) problems.push(`hidden test ${t.id} overrides ${c} outside the grid`);
        if (editable.has(c)) problems.push(`hidden test ${t.id} overrides editable cell ${c}`);
      }
      for (const c of Object.keys(t.expect)) if (!inExerciseGrid(c, ex)) problems.push(`hidden test ${t.id} expects ${c} outside the grid`);
    }
  }
  return problems;
}

/** Compares a recomputed value to an expected one. */
export function matchesExpected(
  actual: CellValue,
  expected: ExpectedValue,
  opts: { tolerance?: number; caseSensitive?: boolean } = {},
): boolean {
  if (typeof expected === "number") {
    if (typeof actual !== "number") return false;
    const tol = opts.tolerance ?? 1e-9;
    return Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
  }
  if (typeof expected === "string") {
    if (typeof actual !== "string") return false;
    return opts.caseSensitive ? actual === expected : actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  if (typeof expected === "boolean") return actual === expected;
  return isCellError(actual) && actual.error === expected.error;
}

/**
 * Parses and structurally validates an untrusted submission. Returns the learner's inputs keyed
 * canonically, or a rejection.
 */
function readSubmission(
  ex: ExerciseDefinition,
  raw: unknown,
): { ok: true; cells: Record<string, string> } | { ok: false; result: ValidationResult } {
  let size: number;
  let data: unknown;
  if (typeof raw === "string") {
    size = utf8Length(raw);
    if (size > MAX_SUBMISSION_BYTES) {
      return { ok: false, result: reject("too_large", `Submission is ${size} bytes; the limit is ${MAX_SUBMISSION_BYTES}`) };
    }
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, result: reject("malformed", "Submission is not valid JSON") };
    }
  } else {
    let json: string | undefined;
    try {
      json = JSON.stringify(raw);
    } catch {
      return { ok: false, result: reject("malformed", "Submission cannot be serialised") };
    }
    if (json === undefined) return { ok: false, result: reject("malformed", "Submission is empty") };
    size = utf8Length(json);
    if (size > MAX_SUBMISSION_BYTES) {
      return { ok: false, result: reject("too_large", `Submission is ${size} bytes; the limit is ${MAX_SUBMISSION_BYTES}`) };
    }
    data = raw;
  }
  if (!isPlainObject(data)) return { ok: false, result: reject("malformed", "Submission must be an object") };
  if (data.exerciseId !== ex.id || data.exerciseVersion !== ex.version) {
    return { ok: false, result: reject("wrong_exercise", "Submission is for a different exercise or version") };
  }
  const cells = data.cells;
  if (!isPlainObject(cells)) return { ok: false, result: reject("malformed", "Submission cells must be an object") };
  const editable = new Set(ex.editableCells);
  const out: Record<string, string> = {};
  for (const [ref, input] of Object.entries(cells)) {
    if (typeof input !== "string") {
      return { ok: false, result: reject("malformed", `Cell ${ref.slice(0, 12)} must be text`) };
    }
    const key = canonicalKey(ref);
    if (key === null) return { ok: false, result: reject("invalid_ref", `"${ref.slice(0, 12)}" is not a cell reference`) };
    if (key in out) return { ok: false, result: reject("malformed", `Cell ${key} appears more than once`) };
    if (!inExerciseGrid(key, ex)) {
      return {
        ok: false,
        result: reject("outside_grid", `${key} is outside the exercise grid A1:${columnToLetters(ex.grid.cols - 1)}${ex.grid.rows}`),
      };
    }
    if (!editable.has(key) && input !== (ex.starter[key] ?? "")) {
      return { ok: false, result: reject("locked_cell", `${key} is locked and cannot be changed`) };
    }
    if (input.startsWith("=")) {
      let funcs: string[];
      try {
        funcs = tokenize(input.slice(1))
          .filter((t) => t.type === "func")
          .map((t) => t.text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unsupported syntax";
        return { ok: false, result: reject("unsupported_formula", `${key}: ${msg}`) };
      }
      for (const f of funcs) {
        if (!(ex.allowedFunctions as string[]).includes(f)) {
          const allowed = ex.allowedFunctions.length ? ex.allowedFunctions.join(", ") : "none";
          return {
            ok: false,
            result: reject("disallowed_function", `${key} uses ${f.slice(0, 20)}, which this exercise does not allow (allowed: ${allowed})`),
          };
        }
      }
    }
    out[key] = input;
  }
  return { ok: true, cells: out };
}

function mergeSheet(ex: ExerciseDefinition, learner: Record<string, string>): Record<string, string> {
  const sheet: Record<string, string> = { ...ex.starter };
  for (const [k, v] of Object.entries(learner)) {
    if (v === "") delete sheet[k];
    else sheet[k] = v;
  }
  return sheet;
}

/**
 * Deterministic validator. On the server it is the source of truth: it recomputes the learner's
 * sheet from scratch, never trusts client-computed values, and runs hidden tests that change input
 * cells to prove formulas (not typed constants) produce the answer.
 *
 * Without a key (browser practice check) it only checks structure and that editable cells compute.
 */
export function validateSubmission(
  exercise: ExerciseDefinition,
  submission: unknown,
  key?: ExerciseKey,
): ValidationResult {
  const problems = checkExercise(exercise, key);
  if (problems.length > 0) return reject("invalid_exercise", `Exercise definition is invalid: ${problems[0]}`);

  const read = readSubmission(exercise, submission);
  if (!read.ok) return read.result;
  const learner = read.cells;
  const limits = exerciseLimits(exercise);
  const sheet = mergeSheet(exercise, learner);
  const values = evaluateSheet(sheet, limits);
  const valueOf = (k: string): CellValue => values[k] ?? null;
  const inputOf = (k: string): string => sheet[k] ?? "";

  const editable = [...exercise.editableCells].sort(compareKeys);
  const computed: Record<string, CellValue> = {};
  for (const k of editable) computed[k] = valueOf(k);

  const checks: ValidationCheck[] = [
    { id: "structure", kind: "structure", passed: true, message: "Submission is well-formed and only changes editable cells" },
  ];
  const weighted: { passed: boolean; weight: number }[] = [];
  const add = (c: ValidationCheck, weight = 1) => {
    checks.push(c);
    weighted.push({ passed: c.passed, weight });
  };

  if (!key) {
    for (const k of editable) {
      const v = valueOf(k);
      const filled = inputOf(k) !== "";
      const ok = filled && !isCellError(v);
      add({
        id: `filled:${k}`,
        kind: "filled",
        cell: k,
        passed: ok,
        message: !filled ? `${k} is still empty` : isCellError(v) ? `${k} shows ${v.error}: ${v.message}` : `${k} calculates without errors`,
      });
    }
  } else {
    for (const k of key.requireFormula) {
      const ok = inputOf(k).startsWith("=");
      add({
        id: `formula:${k}`,
        kind: "formula",
        cell: k,
        passed: ok,
        message: ok ? `${k} contains a formula` : `${k} should contain a formula (starting with =), not a typed value`,
      });
    }
    for (const [k, fns] of Object.entries(key.requireFunctions ?? {})) {
      let used: FunctionName[] = [];
      try {
        if (inputOf(k).startsWith("=")) used = collectFunctions(parseFormula(inputOf(k), { limits }));
      } catch {
        used = [];
      }
      for (const f of fns) {
        const ok = used.includes(f);
        add({
          id: `function:${k}:${f}`,
          kind: "function",
          cell: k,
          passed: ok,
          message: ok ? `${k} uses ${f}` : `${k} should use the ${f} function`,
        });
      }
    }
    for (const c of key.expected) {
      const v = valueOf(c.cell);
      const ok = matchesExpected(v, c.value, c);
      add(
        {
          id: `value:${c.id}`,
          kind: "value",
          cell: c.cell,
          passed: ok,
          message: ok
            ? `${c.label}: correct`
            : isCellError(v)
              ? `${c.label}: ${c.cell} shows ${v.error} (${v.message})`
              : `${c.label}: ${c.cell} does not show the expected result yet`,
        },
        c.weight ?? 1,
      );
    }
    key.hiddenTests.forEach((t, i) => {
      const variant = { ...sheet };
      for (const [k, v] of Object.entries(t.overrides)) {
        if (v === "") delete variant[k];
        else variant[k] = v;
      }
      const vv = evaluateSheet(variant, limits);
      const ok = Object.entries(t.expect).every(([k, exp]) => matchesExpected(vv[k] ?? null, exp, t));
      add(
        {
          id: `hidden:${t.id}`,
          kind: "hidden",
          passed: ok,
          message: `Hidden test ${i + 1} of ${key.hiddenTests.length} (${t.label}): ${ok ? "passed" : "failed"}`,
        },
        t.weight ?? 1,
      );
    });
  }

  const total = weighted.reduce((s, w) => s + w.weight, 0);
  const got = weighted.reduce((s, w) => s + (w.passed ? w.weight : 0), 0);
  const score = total === 0 ? 0 : Math.round((100 * got) / total);
  const threshold = key?.passThreshold ?? 100;
  return {
    passed: total > 0 && score >= threshold,
    score,
    checks,
    validatorVersion: VALIDATOR_VERSION,
    mode: key ? "graded" : "structure-only",
    computed,
  };
}

/** Builds a submission payload from the learner's current inputs (editable cells only). */
export function buildSubmission(exercise: ExerciseDefinition, inputs: Record<string, string>): Submission {
  const cells: Record<string, string> = {};
  for (const k of [...exercise.editableCells].sort(compareKeys)) cells[k] = inputs[k] ?? "";
  return { exerciseId: exercise.id, exerciseVersion: exercise.version, cells };
}

export { SUPPORTED_FUNCTIONS };
