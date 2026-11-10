import { formatNumber } from "./format";
import {
  computeStatistic,
  max,
  mean,
  min,
  percentileInc,
  sortedAscending,
  sum,
  sumOfSquaredDeviations,
  type StatisticKind,
} from "./stats";
import { assertDataset } from "./validate";

/**
 * Worked steps: a deterministic, step-by-step explanation of a statistic using the real dataset.
 * `text` is plain language (safe to render as text). `tex` is optional KaTeX notation.
 */
export type WorkedStep = { text: string; tex?: string };

export type ExplainOptions = {
  /** Decimal places shown for intermediate and final values (display only; maths uses full precision). */
  decimals?: number;
  /** Unit label appended in plain-text steps, e.g. "pairs". */
  unit?: string;
};

/** Above this many values the full sum is abbreviated in TeX to keep it readable. */
const MAX_TERMS_SHOWN = 15;

export const STATISTIC_LABELS: Record<StatisticKind, string> = {
  mean: "mean",
  median: "median",
  min: "minimum",
  max: "maximum",
  range: "range",
  populationVariance: "population variance",
  sampleVariance: "sample variance",
  populationStdDev: "population standard deviation",
  sampleStdDev: "sample standard deviation",
  q1: "first quartile (Q1)",
  q3: "third quartile (Q3)",
  iqr: "interquartile range (IQR)",
};

function list(values: readonly number[], d: number): string {
  return values.map((v) => formatNumber(v, d)).join(", ");
}

function texSum(terms: readonly string[]): string {
  if (terms.length <= MAX_TERMS_SHOWN) return terms.join(" + ");
  return `${terms.slice(0, 3).join(" + ")} + \\cdots + ${terms[terms.length - 1]}`;
}

function withUnit(text: string, unit?: string): string {
  return unit ? `${text} ${unit}` : text;
}

function meanSteps(data: readonly number[], d: number, unit?: string): WorkedStep[] {
  const n = data.length;
  const total = sum(data);
  return [
    { text: `Write down the ${n} values: ${list(data, d)}.` },
    {
      text: `Add them up. The total is ${withUnit(formatNumber(total, d), unit)}.`,
      tex: `\\sum x_i = ${texSum(data.map((v) => formatNumber(v, d)))} = ${formatNumber(total, d)}`,
    },
    {
      text: `Divide the total by the number of values, n = ${n}. The mean is ${withUnit(formatNumber(total / n, d), unit)}.`,
      tex: `\\bar{x} = \\frac{\\sum x_i}{n} = \\frac{${formatNumber(total, d)}}{${n}} = ${formatNumber(total / n, d)}`,
    },
  ];
}

function sortStep(data: readonly number[], d: number): WorkedStep {
  return { text: `Sort the values from smallest to largest: ${list(sortedAscending(data), d)}.` };
}

function medianSteps(data: readonly number[], d: number, unit?: string): WorkedStep[] {
  const s = sortedAscending(data);
  const n = s.length;
  if (n % 2 === 1) {
    const pos = (n + 1) / 2;
    const v = s[pos - 1] as number;
    return [
      sortStep(data, d),
      {
        text: `n = ${n} is odd, so the median is the middle value, at position (n + 1) / 2 = ${pos}. The median is ${withUnit(formatNumber(v, d), unit)}.`,
        tex: `\\tilde{x} = x_{(${pos})} = ${formatNumber(v, d)}`,
      },
    ];
  }
  const p = n / 2;
  const a = s[p - 1] as number;
  const b = s[p] as number;
  const m = (a + b) / 2;
  return [
    sortStep(data, d),
    {
      text: `n = ${n} is even, so the median is the average of the two middle values, at positions ${p} and ${p + 1}: ${formatNumber(a, d)} and ${formatNumber(b, d)}.`,
    },
    {
      text: `Add them and divide by 2. The median is ${withUnit(formatNumber(m, d), unit)}.`,
      tex: `\\tilde{x} = \\frac{x_{(${p})} + x_{(${p + 1})}}{2} = \\frac{${formatNumber(a, d)} + ${formatNumber(b, d)}}{2} = ${formatNumber(m, d)}`,
    },
  ];
}

function extremeSteps(data: readonly number[], d: number, which: "min" | "max", unit?: string): WorkedStep[] {
  const v = which === "min" ? min(data) : max(data);
  const word = which === "min" ? "smallest (first)" : "largest (last)";
  return [sortStep(data, d), { text: `The ${word} value is ${withUnit(formatNumber(v, d), unit)}.` }];
}

function rangeSteps(data: readonly number[], d: number, unit?: string): WorkedStep[] {
  const lo = min(data);
  const hi = max(data);
  return [
    sortStep(data, d),
    { text: `The largest value is ${formatNumber(hi, d)} and the smallest is ${formatNumber(lo, d)}.` },
    {
      text: `Subtract the smallest from the largest. The range is ${withUnit(formatNumber(hi - lo, d), unit)}.`,
      tex: `\\text{range} = \\max - \\min = ${formatNumber(hi, d)} - ${formatNumber(lo, d)} = ${formatNumber(hi - lo, d)}`,
    },
  ];
}

function spreadSteps(
  data: readonly number[],
  d: number,
  kind: "population" | "sample",
  root: boolean,
  unit?: string,
): WorkedStep[] {
  const n = data.length;
  const m = mean(data);
  const ss = sumOfSquaredDeviations(data);
  const divisor = kind === "sample" ? n - 1 : n;
  const variance = ss / divisor;
  const squares = data.map((v) => `(${formatNumber(v, d)} - ${formatNumber(m, d)})^2`);
  const steps: WorkedStep[] = [
    {
      text: `Find the mean: the total ${formatNumber(sum(data), d)} divided by n = ${n} is ${formatNumber(m, d)}.`,
      tex: `\\bar{x} = ${formatNumber(m, d)}`,
    },
    {
      text: `Subtract the mean from each value and square the result: ${data
        .map((v) => formatNumber((v - m) ** 2, d))
        .join(", ")}.`,
      tex: `(x_i - \\bar{x})^2:\\; ${texSum(squares)}`,
    },
    {
      text: `Add the squared deviations. The sum of squares is ${formatNumber(ss, d)}.`,
      tex: `\\sum (x_i - \\bar{x})^2 = ${formatNumber(ss, d)}`,
    },
    kind === "sample"
      ? {
          text: `This is a sample, so divide by n - 1 = ${divisor} (Excel VAR.S). The sample variance is ${formatNumber(variance, d)}.`,
          tex: `s^2 = \\frac{\\sum (x_i - \\bar{x})^2}{n - 1} = \\frac{${formatNumber(ss, d)}}{${divisor}} = ${formatNumber(variance, d)}`,
        }
      : {
          text: `This is the whole population, so divide by n = ${divisor} (Excel VAR.P). The population variance is ${formatNumber(variance, d)}.`,
          tex: `\\sigma^2 = \\frac{\\sum (x_i - \\mu)^2}{n} = \\frac{${formatNumber(ss, d)}}{${divisor}} = ${formatNumber(variance, d)}`,
        },
  ];
  if (root) {
    const sd = Math.sqrt(variance);
    const symbol = kind === "sample" ? "s" : "\\sigma";
    steps.push({
      text: `Take the square root of the variance. The ${kind} standard deviation is ${withUnit(formatNumber(sd, d), unit)} (Excel ${kind === "sample" ? "STDEV.S" : "STDEV.P"}).`,
      tex: `${symbol} = \\sqrt{${formatNumber(variance, d)}} = ${formatNumber(sd, d)}`,
    });
  }
  return steps;
}

function quartileSteps(data: readonly number[], d: number, p: 0.25 | 0.75, label: "Q_1" | "Q_3"): WorkedStep[] {
  const s = sortedAscending(data);
  const n = s.length;
  const h = (n - 1) * p; // 0-indexed position
  const lo = Math.floor(h);
  const frac = h - lo;
  const a = s[lo] as number;
  const b = s[Math.min(lo + 1, n - 1)] as number;
  const q = percentileInc(data, p);
  const pos = h + 1; // 1-indexed for learners
  const steps: WorkedStep[] = [
    sortStep(data, d),
    {
      text: `Excel QUARTILE.INC method: position = 1 + (n - 1) × ${p} = 1 + ${n - 1} × ${p} = ${formatNumber(pos, 4)}.`,
      tex: `\\text{position} = 1 + (n - 1)\\times ${p} = ${formatNumber(pos, 4)}`,
    },
  ];
  if (frac === 0) {
    steps.push({
      text: `The position is a whole number, so ${label.replace("_", "")} is the value at position ${lo + 1}: ${formatNumber(q, d)}.`,
      tex: `${label} = x_{(${lo + 1})} = ${formatNumber(q, d)}`,
    });
  } else {
    steps.push({
      text: `Go ${formatNumber(frac, 4)} of the way from the value at position ${lo + 1} (${formatNumber(a, d)}) to the value at position ${lo + 2} (${formatNumber(b, d)}). The result is ${formatNumber(q, d)}.`,
      tex: `${label} = x_{(${lo + 1})} + ${formatNumber(frac, 4)}\\,(x_{(${lo + 2})} - x_{(${lo + 1})}) = ${formatNumber(a, d)} + ${formatNumber(frac, 4)}\\times(${formatNumber(b, d)} - ${formatNumber(a, d)}) = ${formatNumber(q, d)}`,
    });
  }
  return steps;
}

/** Step-by-step explanation of `kind` for this dataset. Throws MathInputError for invalid data. */
export function explainStatistic(kind: StatisticKind, values: readonly number[], options: ExplainOptions = {}): WorkedStep[] {
  const data = assertDataset(values, kind === "sampleVariance" || kind === "sampleStdDev" ? 2 : 1);
  const d = options.decimals ?? 2;
  const unit = options.unit;
  switch (kind) {
    case "mean":
      return meanSteps(data, d, unit);
    case "median":
      return medianSteps(data, d, unit);
    case "min":
    case "max":
      return extremeSteps(data, d, kind, unit);
    case "range":
      return rangeSteps(data, d, unit);
    case "populationVariance":
      return spreadSteps(data, d, "population", false, unit);
    case "sampleVariance":
      return spreadSteps(data, d, "sample", false, unit);
    case "populationStdDev":
      return spreadSteps(data, d, "population", true, unit);
    case "sampleStdDev":
      return spreadSteps(data, d, "sample", true, unit);
    case "q1":
      return quartileSteps(data, d, 0.25, "Q_1");
    case "q3":
      return quartileSteps(data, d, 0.75, "Q_3");
    case "iqr": {
      const q1 = computeStatistic("q1", data);
      const q3 = computeStatistic("q3", data);
      const prefix = (label: string) => (s: WorkedStep): WorkedStep => ({ ...s, text: `${label}: ${s.text}` });
      return [
        sortStep(data, d),
        ...quartileSteps(data, d, 0.25, "Q_1").slice(1).map(prefix("Q1")),
        ...quartileSteps(data, d, 0.75, "Q_3").slice(1).map(prefix("Q3")),
        {
          text: `Subtract Q1 from Q3. The interquartile range is ${withUnit(formatNumber(q3 - q1, d), unit)}.`,
          tex: `\\text{IQR} = Q_3 - Q_1 = ${formatNumber(q3, d)} - ${formatNumber(q1, d)} = ${formatNumber(q3 - q1, d)}`,
        },
      ];
    }
  }
}
