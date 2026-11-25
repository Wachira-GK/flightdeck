// Per-attempt numeric variants for certificate exams (stage 3g). An author writes a question with placeholders, the ranges the
// numbers may take, and a formula for the answer. Each exam attempt draws different numbers from a seed, and the answer is
// worked out by the same spreadsheet engine as the missions, so nobody types a computed answer by hand.
// Pure (no server access); the exam plan and the author checks both use it. The template and formula live in the server-only key.
import { evaluateSheet, isCellError } from "@flightdeck/excel-engine";

export interface VariantParam {
  min: number;
  max: number;
  step: number;
}
export interface NumericVariant {
  /** Question wording with {name} placeholders. */
  template: string;
  params: Record<string, VariantParam>;
  /** Spreadsheet formula for the answer, with the same {name} placeholders, e.g. "=ROUND({a}*{b}/100,2)". */
  formula: string;
}
export interface RenderedVariant {
  prompt: string;
  expected: number;
  values: Record<string, number>;
}

const NAME = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]{0,11})\}/g;
const MAX_CHOICES = 1_000_000;
export const VARIANT_CHECK_COUNT = 20;

/** Parses the author's lines like "a: 100-500 step 10" (step defaults to 1; decimals allowed). */
export function parseVariantParams(text: string): { params: Record<string, VariantParam>; errors: string[] } {
  const params: Record<string, VariantParam> = {};
  const errors: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z0-9]*)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*(?:-|to|\.\.)\s*(-?\d+(?:\.\d+)?)(?:\s+step\s+(\d+(?:\.\d+)?))?$/i.exec(line);
    if (!m) {
      errors.push(`"${line}" is not understood. Write it like  a: 100-500 step 10.`);
      continue;
    }
    const [, name, lo, hi, st] = m;
    const p = { min: Number(lo), max: Number(hi), step: st === undefined ? 1 : Number(st) };
    if (!NAME.test(name!)) errors.push(`The name "${name}" must be letters and digits, at most 12 characters, starting with a letter.`);
    else if (Object.hasOwn(params, name!)) errors.push(`The name "${name}" is used twice.`);
    else if (!(p.step > 0)) errors.push(`${name}: the step must be more than zero.`);
    else if (!(p.max > p.min)) errors.push(`${name}: the largest value must be more than the smallest.`);
    else if ((p.max - p.min) / p.step + 1 > MAX_CHOICES) errors.push(`${name}: the step is too small for that range.`);
    else params[name!] = p;
  }
  return { params, errors };
}

const placeholdersOf = (s: string): string[] => [...new Set([...String(s ?? "").matchAll(PLACEHOLDER)].map((m) => m[1]!))];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function random(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const decimalsOf = (n: number): number => (String(n).split(".")[1] ?? "").length;
const literal = (n: number): string => (n < 0 ? `(${n})` : String(n));

/** Draws one set of numbers and works out the answer. Throws a plain-language Error if the formula cannot be calculated. */
export function renderVariant(v: NumericVariant, seed: string): RenderedVariant {
  const next = random(seed);
  const values: Record<string, number> = {};
  for (const name of Object.keys(v.params).sort()) {
    const p = v.params[name]!;
    const steps = Math.floor((p.max - p.min) / p.step + 1e-9);
    const dp = Math.max(decimalsOf(p.min), decimalsOf(p.step));
    values[name] = Number((p.min + p.step * Math.floor(next() * (steps + 1))).toFixed(dp));
  }
  const fill = (s: string, fmt: (n: number) => string) => s.replace(PLACEHOLDER, (whole, n: string) => (Object.hasOwn(values, n) ? fmt(values[n]!) : whole));
  const formula = fill(v.formula, literal);
  if (!formula.trim().startsWith("=")) throw new Error("The answer formula must start with =.");
  let out;
  try {
    out = evaluateSheet({ A1: formula }, { maxRows: 1, maxCols: 1 }).A1;
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "The answer formula could not be calculated.");
  }
  if (typeof out !== "number" || !Number.isFinite(out) || isCellError(out)) throw new Error("The answer formula did not give a number.");
  return { prompt: fill(v.template, String), expected: Number(out.toPrecision(12)), values };
}

/** The author check: draws 20 variants and reports anything a learner or the grader could trip over. Empty = fine. */
export function checkVariant(v: NumericVariant, id = "question"): string[] {
  const issues: string[] = [];
  const names = Object.keys(v.params);
  if (names.length === 0) return [`Question ${id}: add at least one number that changes (for example  a: 100-500 step 10).`];
  if (!String(v.template ?? "").trim()) return [`Question ${id}: write the exam wording of the question, using {name} where the numbers go.`];
  const inTemplate = placeholdersOf(v.template);
  const inFormula = placeholdersOf(v.formula);
  for (const n of [...inTemplate, ...inFormula]) if (!names.includes(n)) issues.push(`Question ${id}: {${n}} is used but has no range.`);
  for (const n of names) {
    if (!inTemplate.includes(n)) issues.push(`Question ${id}: {${n}} is not in the question wording, so the learner could never see it.`);
    if (!inFormula.includes(n)) issues.push(`Question ${id}: {${n}} is not in the answer formula, so it does not change the answer.`);
  }
  if (issues.length) return [...new Set(issues)];
  const expectedSeen = new Set<number>();
  const promptSeen = new Set<string>();
  for (let i = 0; i < VARIANT_CHECK_COUNT; i++) {
    try {
      const r = renderVariant(v, `check:${id}:${i}`);
      if (Math.abs(r.expected) > 1e9) issues.push(`Question ${id}: with ${JSON.stringify(r.values)} the answer is absurdly large (${r.expected}).`);
      expectedSeen.add(r.expected);
      promptSeen.add(r.prompt);
    } catch (e) {
      issues.push(`Question ${id}: with some numbers the answer cannot be worked out (${e instanceof Error ? e.message : "error"}).`);
      break;
    }
  }
  const space = names.reduce((acc, n) => acc * (Math.floor((v.params[n]!.max - v.params[n]!.min) / v.params[n]!.step + 1e-9) + 1), 1);
  if (!issues.length && Math.min(space, VARIANT_CHECK_COUNT) >= 5 && expectedSeen.size < 5) issues.push(`Question ${id}: the answer hardly changes between tries (only ${expectedSeen.size} different answers in ${VARIANT_CHECK_COUNT} tries).`);
  if (!issues.length && space < 5) issues.push(`Question ${id}: the ranges allow only ${space} different versions. Widen them so tries are really different.`);
  if (!issues.length && promptSeen.size < Math.min(space, 5)) issues.push(`Question ${id}: the question wording barely changes between tries.`);
  return [...new Set(issues)];
}
