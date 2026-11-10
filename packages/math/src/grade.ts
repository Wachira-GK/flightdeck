import { explainStatistic, STATISTIC_LABELS, type WorkedStep } from "./explain";
import { formatNumber } from "./format";
import { parseNumericAnswer } from "./parse";
import { computeStatistic, type StatisticKind } from "./stats";
import { assertFinite, MathInputError } from "./validate";

/**
 * Deterministic numeric grader. Same inputs always give the same result, on server or client.
 *
 * Tolerance rules (also in docs/architecture/MATH-RENDERER.md):
 * - absolute: correct when |answer - expected| <= value.
 * - relative: correct when |answer - expected| <= value * |expected| (value 0.01 = 1%).
 *   If expected is 0, a relative tolerance can only accept 0 exactly; use absolute for such items.
 * - A tiny floating-point guard (1e-9 scaled by |expected|) is added so that, e.g., 0.1 + 0.2 grades
 *   the same as 0.3. It never widens tolerance in a way a learner could notice.
 */

export type Tolerance = { kind: "absolute"; value: number } | { kind: "relative"; value: number };

export type ExplainSpec = {
  statistic: StatisticKind;
  dataset: readonly number[];
  /** Display decimals in worked steps. Default 2. */
  decimals?: number;
  unit?: string;
};

export type NumericGradeInput = {
  expected: number;
  tolerance: Tolerance;
  /** Raw string the learner typed. */
  answer: string;
  /** Generate worked steps from the real dataset. */
  explain?: ExplainSpec;
  /** Or supply worked steps directly (used when `explain` is absent). */
  workedSteps?: readonly WorkedStep[];
};

export type GradeStatus = "correct" | "incorrect" | "invalid";

export type NumericGradeResult = {
  correct: boolean;
  status: GradeStatus;
  feedback: string;
  workedSteps: WorkedStep[];
  /** Parsed learner value when the input was a valid number. */
  parsed?: number;
};

const FLOAT_GUARD = 1e-9;

export function validateTolerance(tolerance: Tolerance): Tolerance {
  if (!tolerance || (tolerance.kind !== "absolute" && tolerance.kind !== "relative")) {
    throw new MathInputError("INVALID_ARGUMENT", 'Tolerance kind must be "absolute" or "relative".');
  }
  assertFinite(tolerance.value, "Tolerance");
  if (tolerance.value < 0) throw new MathInputError("INVALID_ARGUMENT", "Tolerance must be 0 or more.");
  if (tolerance.kind === "relative" && tolerance.value > 1) {
    throw new MathInputError("INVALID_ARGUMENT", "Relative tolerance is a fraction (0.01 = 1%) and must be at most 1.");
  }
  return tolerance;
}

/** Maximum accepted |answer - expected| for this tolerance. */
export function allowedDifference(expected: number, tolerance: Tolerance): number {
  validateTolerance(tolerance);
  assertFinite(expected, "Expected value");
  return tolerance.kind === "absolute" ? tolerance.value : tolerance.value * Math.abs(expected);
}

export function isWithinTolerance(value: number, expected: number, tolerance: Tolerance): boolean {
  assertFinite(value, "Answer");
  const allowed = allowedDifference(expected, tolerance);
  return Math.abs(value - expected) <= allowed + FLOAT_GUARD * Math.max(1, Math.abs(expected));
}

export function describeTolerance(tolerance: Tolerance): string {
  return tolerance.kind === "absolute"
    ? `within ±${formatNumber(tolerance.value, 6)}`
    : `within ±${formatNumber(tolerance.value * 100, 4)}%`;
}

/** Common mix-ups we can name deterministically when the learner's value matches a sibling statistic. */
const CONFUSIONS: Partial<Record<StatisticKind, readonly StatisticKind[]>> = {
  mean: ["median"],
  median: ["mean"],
  sampleStdDev: ["populationStdDev", "sampleVariance"],
  populationStdDev: ["sampleStdDev", "populationVariance"],
  sampleVariance: ["populationVariance", "sampleStdDev"],
  populationVariance: ["sampleVariance", "populationStdDev"],
  range: ["max"],
  iqr: ["range"],
};

function confusionHint(value: number, spec: ExplainSpec, tolerance: Tolerance): string | null {
  for (const other of CONFUSIONS[spec.statistic] ?? []) {
    let otherValue: number;
    try {
      otherValue = computeStatistic(other, spec.dataset);
    } catch {
      continue;
    }
    if (isWithinTolerance(value, otherValue, tolerance)) {
      return `That looks like the ${STATISTIC_LABELS[other]}. This question asks for the ${STATISTIC_LABELS[spec.statistic]}.`;
    }
  }
  return null;
}

export function gradeNumericAnswer(input: NumericGradeInput): NumericGradeResult {
  const { expected, tolerance, answer } = input;
  assertFinite(expected, "Expected value");
  validateTolerance(tolerance);

  const parsed = parseNumericAnswer(answer);
  if (!parsed.ok) {
    // A typing problem is not a wrong answer: no steps are revealed, so the learner can retry.
    return { correct: false, status: "invalid", feedback: parsed.message, workedSteps: [] };
  }

  const value = parsed.value;
  const workedSteps = input.explain
    ? explainStatistic(input.explain.statistic, input.explain.dataset, {
        decimals: input.explain.decimals,
        unit: input.explain.unit,
      })
    : [...(input.workedSteps ?? [])];
  const band = describeTolerance(tolerance);

  if (isWithinTolerance(value, expected, tolerance)) {
    return {
      correct: true,
      status: "correct",
      feedback: `Correct. ${formatNumber(value, 6)} is ${band} of the expected value.`,
      workedSteps,
      parsed: value,
    };
  }

  const direction = value < expected ? "lower" : "higher";
  const hint = input.explain ? confusionHint(value, input.explain, tolerance) : null;
  const parts = [
    `Not quite. Your answer ${formatNumber(value, 6)} is ${direction} than expected; answers ${band} are accepted.`,
  ];
  if (hint) parts.push(hint);
  if (workedSteps.length > 0) parts.push("Follow the worked steps to see where the calculation differs.");
  return { correct: false, status: "incorrect", feedback: parts.join(" "), workedSteps, parsed: value };
}
