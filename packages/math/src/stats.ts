import { assertDataset, assertFinite, MathInputError } from "./validate";

/**
 * Descriptive statistics. Conventions (see docs/architecture/MATH-RENDERER.md):
 * - "population" functions divide by n (Excel VAR.P / STDEV.P).
 * - "sample" functions divide by n - 1 (Excel VAR.S / STDEV.S) and need n >= 2.
 * - Quartiles use the inclusive method of Excel QUARTILE.INC / PERCENTILE.INC.
 */

/** Ascending copy; never mutates the input. */
export function sortedAscending(values: readonly number[]): number[] {
  return [...assertDataset(values)].sort((a, b) => a - b);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of assertDataset(values)) total += v;
  return total;
}

export function mean(values: readonly number[]): number {
  const data = assertDataset(values);
  return sum(data) / data.length;
}

export function min(values: readonly number[]): number {
  const data = assertDataset(values);
  let m = data[0] as number;
  for (const v of data) if (v < m) m = v;
  return m;
}

export function max(values: readonly number[]): number {
  const data = assertDataset(values);
  let m = data[0] as number;
  for (const v of data) if (v > m) m = v;
  return m;
}

/** max - min */
export function range(values: readonly number[]): number {
  return max(values) - min(values);
}

export function median(values: readonly number[]): number {
  const s = sortedAscending(values);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * All most-frequent values, ascending. Matches Excel MODE.MULT: if no value repeats
 * (every value occurs once) there is no mode and the result is an empty array.
 */
export function modes(values: readonly number[]): number[] {
  const counts = new Map<number, number>();
  for (const v of assertDataset(values)) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top = 0;
  for (const c of counts.values()) if (c > top) top = c;
  if (top < 2) return [];
  return [...counts.entries()]
    .filter(([, c]) => c === top)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

/** Sum of squared deviations from the mean (two-pass, numerically stable for small data). */
export function sumOfSquaredDeviations(values: readonly number[]): number {
  const data = assertDataset(values);
  const m = mean(data);
  let ss = 0;
  for (const v of data) ss += (v - m) ** 2;
  return ss;
}

/** Population variance, divides by n (Excel VAR.P). */
export function populationVariance(values: readonly number[]): number {
  const data = assertDataset(values);
  return sumOfSquaredDeviations(data) / data.length;
}

/** Sample variance, divides by n - 1 (Excel VAR.S). Requires at least 2 values. */
export function sampleVariance(values: readonly number[]): number {
  const data = assertDataset(values, 2);
  return sumOfSquaredDeviations(data) / (data.length - 1);
}

/** Population standard deviation, sigma (Excel STDEV.P). */
export function populationStdDev(values: readonly number[]): number {
  return Math.sqrt(populationVariance(values));
}

/** Sample standard deviation, s (Excel STDEV.S). Requires at least 2 values. */
export function sampleStdDev(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/**
 * Inclusive percentile, identical to Excel PERCENTILE.INC.
 * Position h = (n - 1) * p on the 0-indexed sorted data; linear interpolation between
 * the neighbouring order statistics. p must be in [0, 1].
 */
export function percentileInc(values: readonly number[], p: number): number {
  assertFinite(p, "Percentile p");
  if (p < 0 || p > 1) throw new MathInputError("INVALID_ARGUMENT", "Percentile p must be between 0 and 1.");
  const s = sortedAscending(values);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const a = s[lo] as number;
  const b = s[hi] as number;
  return a + (h - lo) * (b - a);
}

export type QuartileNumber = 0 | 1 | 2 | 3 | 4;

/** Excel QUARTILE.INC(values, quart): 0 = min, 1 = Q1, 2 = median, 3 = Q3, 4 = max. */
export function quartileInc(values: readonly number[], quart: QuartileNumber): number {
  if (![0, 1, 2, 3, 4].includes(quart)) {
    throw new MathInputError("INVALID_ARGUMENT", "Quartile must be 0, 1, 2, 3 or 4.");
  }
  return percentileInc(values, quart / 4);
}

export type Quartiles = { q1: number; q2: number; q3: number; iqr: number };

/** Q1, Q2 (median), Q3 and interquartile range, all with the QUARTILE.INC method. */
export function quartiles(values: readonly number[]): Quartiles {
  const q1 = quartileInc(values, 1);
  const q2 = quartileInc(values, 2);
  const q3 = quartileInc(values, 3);
  return { q1, q2, q3, iqr: q3 - q1 };
}

/** z = (x - mean) / sd (Excel STANDARDIZE). sd must be > 0. */
export function zScore(x: number, mean: number, standardDeviation: number): number {
  assertFinite(x, "x");
  assertFinite(mean, "Mean");
  assertFinite(standardDeviation, "Standard deviation");
  if (standardDeviation <= 0) {
    throw new MathInputError("ZERO_SPREAD", "Standard deviation must be greater than 0 to compute a z-score.");
  }
  return (x - mean) / standardDeviation;
}

export type SpreadKind = "population" | "sample";

/** z-score of every value against its own dataset. */
export function zScores(values: readonly number[], kind: SpreadKind): number[] {
  const data = assertDataset(values, kind === "sample" ? 2 : 1);
  const m = mean(data);
  const sd = kind === "sample" ? sampleStdDev(data) : populationStdDev(data);
  return data.map((x) => zScore(x, m, sd));
}

export type StatisticKind =
  | "mean"
  | "median"
  | "min"
  | "max"
  | "range"
  | "populationVariance"
  | "sampleVariance"
  | "populationStdDev"
  | "sampleStdDev"
  | "q1"
  | "q3"
  | "iqr";

export const STATISTIC_KINDS: readonly StatisticKind[] = [
  "mean",
  "median",
  "min",
  "max",
  "range",
  "populationVariance",
  "sampleVariance",
  "populationStdDev",
  "sampleStdDev",
  "q1",
  "q3",
  "iqr",
];

export function isStatisticKind(value: unknown): value is StatisticKind {
  return typeof value === "string" && (STATISTIC_KINDS as readonly string[]).includes(value);
}

export function computeStatistic(kind: StatisticKind, values: readonly number[]): number {
  switch (kind) {
    case "mean":
      return mean(values);
    case "median":
      return median(values);
    case "min":
      return min(values);
    case "max":
      return max(values);
    case "range":
      return range(values);
    case "populationVariance":
      return populationVariance(values);
    case "sampleVariance":
      return sampleVariance(values);
    case "populationStdDev":
      return populationStdDev(values);
    case "sampleStdDev":
      return sampleStdDev(values);
    case "q1":
      return quartileInc(values, 1);
    case "q3":
      return quartileInc(values, 3);
    case "iqr":
      return quartiles(values).iqr;
  }
}
