import { describe, expect, it } from "vitest";
import {
  allowedDifference,
  describeTolerance,
  explainStatistic,
  gradeNumericAnswer,
  isWithinTolerance,
  MathInputError,
  STATISTIC_KINDS,
  validateTolerance,
  type Tolerance,
} from "../src";

const SALES = [132, 148, 141, 155, 139, 150, 146, 158, 144, 312];
const ABS: Tolerance = { kind: "absolute", value: 0.05 };

describe("tolerance", () => {
  it("absolute and relative bands", () => {
    expect(allowedDifference(100, { kind: "absolute", value: 0.5 })).toBe(0.5);
    expect(allowedDifference(-200, { kind: "relative", value: 0.01 })).toBe(2);
    expect(isWithinTolerance(100.5, 100, { kind: "absolute", value: 0.5 })).toBe(true);
    expect(isWithinTolerance(100.51, 100, { kind: "absolute", value: 0.5 })).toBe(false);
    expect(isWithinTolerance(198, 200, { kind: "relative", value: 0.01 })).toBe(true);
    expect(isWithinTolerance(197.9, 200, { kind: "relative", value: 0.01 })).toBe(false);
  });
  it("floating-point guard: 0.1 + 0.2 is 0.3 under zero tolerance", () => {
    expect(isWithinTolerance(0.1 + 0.2, 0.3, { kind: "absolute", value: 0 })).toBe(true);
  });
  it("relative tolerance with expected 0 accepts only 0", () => {
    expect(isWithinTolerance(0, 0, { kind: "relative", value: 0.05 })).toBe(true);
    expect(isWithinTolerance(0.001, 0, { kind: "relative", value: 0.05 })).toBe(false);
  });
  it("rejects invalid tolerances", () => {
    expect(() => validateTolerance({ kind: "absolute", value: -1 })).toThrowError(MathInputError);
    expect(() => validateTolerance({ kind: "relative", value: 2 })).toThrowError(/at most 1/);
    expect(() => validateTolerance({ kind: "absolute", value: NaN })).toThrowError(MathInputError);
    expect(() => validateTolerance({ kind: "fuzzy", value: 1 } as unknown as Tolerance)).toThrowError(/kind/);
  });
  it("describes tolerance", () => {
    expect(describeTolerance(ABS)).toBe("within ±0.05");
    expect(describeTolerance({ kind: "relative", value: 0.01 })).toBe("within ±1%");
  });
});

describe("gradeNumericAnswer", () => {
  const meanQ = { expected: 162.5, tolerance: ABS, explain: { statistic: "mean" as const, dataset: SALES, unit: "pairs" } };

  it("accepts a correct answer and returns worked steps from the real dataset", () => {
    const r = gradeNumericAnswer({ ...meanQ, answer: "162.5" });
    expect(r).toMatchObject({ correct: true, status: "correct", parsed: 162.5 });
    expect(r.feedback).toMatch(/^Correct\./);
    expect(r.workedSteps.length).toBe(3);
    expect(r.workedSteps[1]?.text).toContain("1625");
    expect(r.workedSteps[2]?.tex).toContain("\\frac{1625}{10} = 162.5");
  });
  it("accepts values inside tolerance and the Unicode minus", () => {
    expect(gradeNumericAnswer({ ...meanQ, answer: "162.54" }).correct).toBe(true);
    expect(
      gradeNumericAnswer({ expected: -2.5, tolerance: ABS, answer: "−2.5" }).correct,
    ).toBe(true);
  });
  it("marks a wrong answer incorrect, says lower/higher, still shows steps", () => {
    const r = gradeNumericAnswer({ ...meanQ, answer: "160" });
    expect(r.status).toBe("incorrect");
    expect(r.feedback).toMatch(/lower than expected/);
    expect(r.workedSteps.length).toBeGreaterThan(0);
    expect(gradeNumericAnswer({ ...meanQ, answer: "170" }).feedback).toMatch(/higher/);
  });
  it("names a mean/median mix-up", () => {
    const r = gradeNumericAnswer({ ...meanQ, answer: "147" });
    expect(r.feedback).toContain("looks like the median");
  });
  it("names a population/sample standard deviation mix-up", () => {
    const r = gradeNumericAnswer({
      expected: 53.07,
      tolerance: { kind: "absolute", value: 0.01 },
      answer: "50.35",
      explain: { statistic: "sampleStdDev", dataset: SALES },
    });
    expect(r.correct).toBe(false);
    expect(r.feedback).toContain("population standard deviation");
  });
  it("skips confusion candidates that cannot be computed", () => {
    const r = gradeNumericAnswer({
      expected: 0,
      tolerance: ABS,
      answer: "5",
      explain: { statistic: "populationStdDev", dataset: [5] },
    });
    expect(r.status).toBe("incorrect");
  });
  it("treats unparseable input as invalid, not wrong, and reveals no steps", () => {
    const r = gradeNumericAnswer({ ...meanQ, answer: "162,5" });
    expect(r).toMatchObject({ correct: false, status: "invalid", workedSteps: [] });
    expect(r.feedback).toMatch(/dot for decimals/);
    expect(r.parsed).toBeUndefined();
  });
  it("uses supplied worked steps when no explain spec is given", () => {
    const steps = [{ text: "Divide 10 by 4." }];
    const r = gradeNumericAnswer({ expected: 2.5, tolerance: ABS, answer: "1", workedSteps: steps });
    expect(r.workedSteps).toEqual(steps);
    expect(r.feedback).toMatch(/worked steps/);
    expect(gradeNumericAnswer({ expected: 2.5, tolerance: ABS, answer: "1" }).feedback).not.toMatch(/worked steps/);
  });
  it("is deterministic", () => {
    const a = gradeNumericAnswer({ ...meanQ, answer: "161" });
    const b = gradeNumericAnswer({ ...meanQ, answer: "161" });
    expect(a).toEqual(b);
  });
  it("rejects a bad expected value or tolerance", () => {
    expect(() => gradeNumericAnswer({ expected: NaN, tolerance: ABS, answer: "1" })).toThrowError(MathInputError);
    expect(() => gradeNumericAnswer({ expected: 1, tolerance: { kind: "absolute", value: -1 }, answer: "1" })).toThrowError();
  });
});

describe("explainStatistic", () => {
  it("covers every statistic kind with non-empty plain text", () => {
    for (const kind of STATISTIC_KINDS) {
      const steps = explainStatistic(kind, SALES, { unit: "pairs" });
      expect(steps.length, kind).toBeGreaterThan(0);
      for (const s of steps) expect(s.text.length).toBeGreaterThan(0);
    }
  });
  it("median: even and odd n", () => {
    const even = explainStatistic("median", SALES);
    expect(even[0]?.text).toContain("132, 139, 141, 144, 146, 148, 150, 155, 158, 312");
    expect(even.at(-1)?.tex).toContain("\\frac{146 + 148}{2} = 147");
    const odd = explainStatistic("median", [5, 1, 3]);
    expect(odd.at(-1)?.text).toContain("position (n + 1) / 2 = 2");
    expect(odd.at(-1)?.tex).toBe("\\tilde{x} = x_{(2)} = 3");
  });
  it("range, min, max", () => {
    expect(explainStatistic("range", SALES).at(-1)?.tex).toContain("312 - 132 = 180");
    expect(explainStatistic("min", SALES).at(-1)?.text).toContain("132");
    expect(explainStatistic("max", SALES, { unit: "pairs" }).at(-1)?.text).toContain("312 pairs");
  });
  it("sample vs population standard deviation divide by n - 1 vs n", () => {
    const s = explainStatistic("sampleStdDev", SALES);
    expect(s.some((x) => x.text.includes("n - 1 = 9"))).toBe(true);
    expect(s.at(-1)?.tex).toContain("= 53.07");
    const p = explainStatistic("populationStdDev", SALES);
    expect(p.some((x) => x.text.includes("divide by n = 10"))).toBe(true);
    expect(p.at(-1)?.tex).toContain("= 50.35");
    expect(explainStatistic("sampleVariance", SALES).length).toBe(4);
    expect(explainStatistic("populationVariance", SALES).at(-1)?.tex).toContain("= 2535.25");
  });
  it("quartiles: interpolated and whole positions", () => {
    const q1 = explainStatistic("q1", SALES);
    expect(q1[1]?.text).toContain("= 3.25");
    expect(q1[2]?.tex).toContain("141 + 0.25\\times(144 - 141) = 141.75");
    const whole = explainStatistic("q1", [1, 2, 3, 4, 5]);
    expect(whole.at(-1)?.text).toContain("value at position 2: 2");
    expect(explainStatistic("q3", SALES).at(-1)?.text).toContain("153.75");
    const iqr = explainStatistic("iqr", SALES);
    expect(iqr[1]?.text.startsWith("Q1:")).toBe(true);
    expect(iqr.at(-1)?.tex).toContain("153.75 - 141.75 = 12");
  });
  it("abbreviates long sums in TeX", () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(explainStatistic("mean", many)[1]?.tex).toContain("\\cdots");
  });
  it("respects decimals", () => {
    expect(explainStatistic("sampleStdDev", SALES, { decimals: 1 }).at(-1)?.tex).toContain("= 53.1");
  });
  it("validates the dataset", () => {
    expect(() => explainStatistic("mean", [])).toThrowError(MathInputError);
    expect(() => explainStatistic("sampleStdDev", [1])).toThrowError(MathInputError);
  });
});
