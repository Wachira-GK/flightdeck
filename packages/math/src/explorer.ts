import { formatNumber } from "./format";
import { max, mean, median, min, populationStdDev, range, sampleStdDev, sortedAscending, sum, sumOfSquaredDeviations, type SpreadKind } from "./stats";
import { assertDataset, assertFinite, MathInputError } from "./validate";

/**
 * Pure helpers behind the <StatsExplorer> visual (apps/web/components/math/stats-explorer.tsx).
 * Kept here so they are unit-tested with the rest of the maths and contain no React.
 */

export type StatsExplorerDataset = {
  id: string;
  title: string;
  /** Plural unit shown next to values, e.g. "pairs". */
  unit: string;
  /** Category label per value, e.g. "Wk 1". Same length as values. */
  labels: string[];
  values: number[];
  /** The one data point the learner can move. */
  adjustable: { index: number; min: number; max: number; step: number; label?: string };
  /** Which standard deviation to display. Default "sample" (Excel STDEV.S). */
  spread?: SpreadKind;
  /** Display decimals. Default 1. */
  decimals?: number;
};

export function validateExplorerDataset(ds: StatsExplorerDataset): StatsExplorerDataset {
  assertDataset(ds.values, ds.spread === "population" ? 1 : 2);
  if (ds.labels.length !== ds.values.length) {
    throw new MathInputError("INVALID_ARGUMENT", "labels and values must have the same length.");
  }
  const { index, min: lo, max: hi, step } = ds.adjustable;
  if (!Number.isInteger(index) || index < 0 || index >= ds.values.length) {
    throw new MathInputError("INVALID_ARGUMENT", "adjustable.index must point at a value in the dataset.");
  }
  assertFinite(lo, "adjustable.min");
  assertFinite(hi, "adjustable.max");
  assertFinite(step, "adjustable.step");
  if (!(lo < hi) || step <= 0) {
    throw new MathInputError("INVALID_ARGUMENT", "adjustable needs min < max and step > 0.");
  }
  const v = ds.values[index] as number;
  if (v < lo || v > hi) throw new MathInputError("INVALID_ARGUMENT", "The adjustable value must lie within min..max.");
  return ds;
}

/** New array with values[index] replaced. Never mutates. */
export function replaceAt(values: readonly number[], index: number, value: number): number[] {
  assertFinite(value, "Value");
  if (!Number.isInteger(index) || index < 0 || index >= values.length) {
    throw new MathInputError("INVALID_ARGUMENT", "Index out of range.");
  }
  const next = [...values];
  next[index] = value;
  return next;
}

/** Clamp to [lo, hi] and snap to the step grid anchored at lo. */
export function clampToStep(value: number, lo: number, hi: number, step: number): number {
  const clamped = Math.min(hi, Math.max(lo, value));
  const snapped = lo + Math.round((clamped - lo) / step) * step;
  return Math.min(hi, Math.max(lo, Number(snapped.toFixed(10))));
}

export type StatsSummary = {
  n: number;
  total: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  range: number;
  stdDev: number;
  spread: SpreadKind;
};

export function summarize(values: readonly number[], spread: SpreadKind = "sample"): StatsSummary {
  const data = assertDataset(values, spread === "sample" ? 2 : 1);
  return {
    n: data.length,
    total: sum(data),
    mean: mean(data),
    median: median(data),
    min: min(data),
    max: max(data),
    range: range(data),
    stdDev: spread === "sample" ? sampleStdDev(data) : populationStdDev(data),
    spread,
  };
}

/** Live TeX for each displayed statistic, filled in with this dataset's numbers. */
export function statFormulas(values: readonly number[], spread: SpreadKind = "sample", decimals = 1) {
  const s = summarize(values, spread);
  const f = (v: number) => formatNumber(v, decimals);
  const sorted = sortedAscending(values);
  const n = s.n;
  let medianTex: string;
  if (n % 2 === 1) {
    medianTex = `\\tilde{x} = x_{(${(n + 1) / 2})} = ${f(s.median)}`;
  } else {
    const p = n / 2;
    medianTex = `\\tilde{x} = \\frac{x_{(${p})} + x_{(${p + 1})}}{2} = \\frac{${f(sorted[p - 1] as number)} + ${f(sorted[p] as number)}}{2} = ${f(s.median)}`;
  }
  const ss = sumOfSquaredDeviations(values);
  const stdDevTex =
    spread === "sample"
      ? `s = \\sqrt{\\frac{\\sum (x_i - \\bar{x})^2}{n - 1}} = \\sqrt{\\frac{${f(ss)}}{${n - 1}}} = ${f(s.stdDev)}`
      : `\\sigma = \\sqrt{\\frac{\\sum (x_i - \\mu)^2}{n}} = \\sqrt{\\frac{${f(ss)}}{${n}}} = ${f(s.stdDev)}`;
  return {
    mean: `\\bar{x} = \\frac{\\sum x_i}{n} = \\frac{${f(s.total)}}{${n}} = ${f(s.mean)}`,
    median: medianTex,
    range: `\\text{range} = \\max - \\min = ${f(s.max)} - ${f(s.min)} = ${f(s.range)}`,
    stdDev: stdDevTex,
  };
}

/** Linear map from a data domain to a pixel range. A zero-width domain maps to the range midpoint. */
export function linearScale(domain: readonly [number, number], rangePx: readonly [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = rangePx;
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** "Nice" axis ticks (1, 2, 2.5, 5 x 10^k) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, targetCount = 5): number[] {
  assertFinite(lo, "lo");
  assertFinite(hi, "hi");
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) return [lo];
  const rough = (hi - lo) / Math.max(1, targetCount);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((u) => u >= rough) ?? 10 * pow;
  const start = Math.floor(lo / unit) * unit;
  const end = Math.ceil(hi / unit) * unit;
  const ticks: number[] = [];
  for (let t = start; t <= end + unit / 2; t += unit) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/**
 * Compact x-axis labels for narrow charts. If every label shares a word prefix ("Wk 1", "Wk 2", ...)
 * the prefix becomes the axis title and the ticks keep only the rest ("1", "2", ...).
 */
export function axisLabels(labels: readonly string[]): { title: string | null; ticks: string[] } {
  const first = labels[0];
  const space = first?.lastIndexOf(" ") ?? -1;
  if (!first || space <= 0) return { title: null, ticks: [...labels] };
  const prefix = first.slice(0, space + 1);
  if (labels.length < 2 || !labels.every((l) => l.startsWith(prefix) && l.length > prefix.length)) {
    return { title: null, ticks: [...labels] };
  }
  return { title: prefix.trim(), ticks: labels.map((l) => l.slice(prefix.length)) };
}

/** Plain-language summary used as the chart's aria-label and the live-region text. */
export function describeStats(values: readonly number[], unit: string, spread: SpreadKind = "sample", decimals = 1): string {
  const s = summarize(values, spread);
  const f = (v: number) => formatNumber(v, decimals);
  const gap = s.mean - s.median;
  const relation =
    Math.abs(gap) < 10 ** -decimals / 2
      ? "The mean equals the median."
      : `The mean is ${f(Math.abs(gap))} ${unit} ${gap > 0 ? "above" : "below"} the median.`;
  return `Mean ${f(s.mean)} ${unit}, median ${f(s.median)} ${unit}, range ${f(s.range)} ${unit}, ${
    spread === "sample" ? "sample" : "population"
  } standard deviation ${f(s.stdDev)} ${unit}. ${relation}`;
}

export function describeChart(ds: StatsExplorerDataset, values: readonly number[]): string {
  const decimals = ds.decimals ?? 1;
  const spread = ds.spread ?? "sample";
  return `Bar chart: ${ds.title}. ${values.length} values from ${formatNumber(min(values), decimals)} to ${formatNumber(
    max(values),
    decimals,
  )} ${ds.unit}. ${describeStats(values, ds.unit, spread, decimals)}`;
}
