import { describe, expect, it } from "vitest";
import {
  assertDataset,
  assertFinite,
  computeStatistic,
  isStatisticKind,
  MathInputError,
  max,
  mean,
  median,
  min,
  modes,
  percentileInc,
  populationStdDev,
  populationVariance,
  quartileInc,
  quartiles,
  range,
  sampleStdDev,
  sampleVariance,
  sortedAscending,
  STATISTIC_KINDS,
  sum,
  sumOfSquaredDeviations,
  zScore,
  zScores,
  type QuartileNumber,
} from "../src";

/** Weekly pairs sold, store dataset used by descriptive-stats-101 (week 10 = school-reopening outlier). */
const SALES = [132, 148, 141, 155, 139, 150, 146, 158, 144, 312];
/** Classic textbook set: population sd = 2 exactly. */
const CLASSIC = [2, 4, 4, 4, 5, 5, 7, 9];

describe("validation", () => {
  const fns: [string, (v: number[]) => unknown][] = [
    ["sum", sum],
    ["mean", mean],
    ["median", median],
    ["modes", modes],
    ["min", min],
    ["max", max],
    ["range", range],
    ["populationVariance", populationVariance],
    ["populationStdDev", populationStdDev],
    ["sampleVariance", sampleVariance],
    ["sampleStdDev", sampleStdDev],
    ["sortedAscending", sortedAscending],
    ["quartiles", quartiles],
  ];
  it.each(fns)("%s rejects an empty dataset with EMPTY_DATASET", (_name, f) => {
    let caught: unknown;
    try {
      f([]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MathInputError);
    expect((caught as MathInputError).code).toBe("EMPTY_DATASET");
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite value %s", (bad) => {
    expect(() => mean([1, bad, 3])).toThrowError(/position 2/);
    expect(() => median([1, bad])).toThrowError(MathInputError);
  });
  it("rejects non-number entries and non-arrays", () => {
    expect(() => mean([1, "2" as unknown as number])).toThrowError(MathInputError);
    expect(() => mean(null as unknown as number[])).toThrowError(/array/);
    expect(() => assertDataset("abc")).toThrowError(/array/);
  });
  it("sample statistics need at least 2 values", () => {
    expect(() => sampleVariance([5])).toThrowError(/At least 2/);
    expect(() => sampleStdDev([5])).toThrowError(MathInputError);
  });
  it("assertFinite names the argument", () => {
    expect(() => assertFinite(NaN, "Tolerance")).toThrowError(/Tolerance/);
    expect(assertFinite(2, "x")).toBe(2);
  });
});

describe("central tendency and extremes", () => {
  it("sum / mean", () => {
    expect(sum(SALES)).toBe(1625);
    expect(mean(SALES)).toBe(162.5);
    expect(mean([-1, 1])).toBe(0);
    expect(mean([7])).toBe(7);
  });
  it("median for odd and even n, unsorted input", () => {
    expect(median(SALES)).toBe(147);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4])).toBe(4);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("never mutates input", () => {
    const copy = [...SALES];
    median(SALES);
    sortedAscending(SALES);
    quartiles(SALES);
    expect(SALES).toEqual(copy);
  });
  it("min / max / range", () => {
    expect(min(SALES)).toBe(132);
    expect(max(SALES)).toBe(312);
    expect(range(SALES)).toBe(180);
    expect(range([5])).toBe(0);
    expect(min([-3, -10, 2])).toBe(-10);
  });
  it("modes match Excel MODE.MULT", () => {
    expect(modes(CLASSIC)).toEqual([4]);
    expect(modes([1, 1, 2, 2, 3])).toEqual([1, 2]);
    expect(modes([3, 1, 2])).toEqual([]); // no repeats: no mode (#N/A in Excel)
    expect(modes([2, 2, 2])).toEqual([2]);
  });
});

describe("spread", () => {
  it("population vs sample variance and standard deviation", () => {
    expect(sumOfSquaredDeviations(CLASSIC)).toBe(32);
    expect(populationVariance(CLASSIC)).toBe(4);
    expect(populationStdDev(CLASSIC)).toBe(2);
    expect(sampleVariance(CLASSIC)).toBeCloseTo(32 / 7, 12);
    expect(sampleStdDev(CLASSIC)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });
  it("matches Excel STDEV.S / STDEV.P on the store dataset", () => {
    expect(sumOfSquaredDeviations(SALES)).toBeCloseTo(25352.5, 9);
    expect(sampleStdDev(SALES)).toBeCloseTo(53.0748946720052, 10);
    expect(populationStdDev(SALES)).toBeCloseTo(50.3512661211215, 10);
  });
  it("constant data has zero spread", () => {
    expect(populationStdDev([5, 5, 5])).toBe(0);
    expect(sampleStdDev([5, 5, 5])).toBe(0);
  });
});

describe("quartiles (Excel QUARTILE.INC)", () => {
  // Microsoft's documentation example for QUARTILE.INC.
  const DOC = [1, 2, 4, 7, 8, 9, 10, 12];
  it("matches the Excel documentation example", () => {
    expect(quartileInc(DOC, 0)).toBe(1);
    expect(quartileInc(DOC, 1)).toBe(3.5);
    expect(quartileInc(DOC, 2)).toBe(7.5);
    expect(quartileInc(DOC, 3)).toBe(9.25);
    expect(quartileInc(DOC, 4)).toBe(12);
  });
  it("store dataset", () => {
    expect(quartiles(SALES)).toEqual({ q1: 141.75, q2: 147, q3: 153.75, iqr: 12 });
  });
  it("Q2 equals the median and n = 1 works", () => {
    expect(quartileInc(SALES, 2)).toBe(median(SALES));
    expect(quartiles([9])).toEqual({ q1: 9, q2: 9, q3: 9, iqr: 0 });
  });
  it("percentileInc bounds and interpolation", () => {
    expect(percentileInc([10, 20], 0.5)).toBe(15);
    expect(percentileInc([10, 20, 30], 0.9)).toBeCloseTo(28, 12);
    expect(() => percentileInc([1, 2], 1.5)).toThrowError(/between 0 and 1/);
    expect(() => percentileInc([1, 2], NaN)).toThrowError(MathInputError);
    expect(() => quartileInc([1, 2], 5 as QuartileNumber)).toThrowError(/0, 1, 2, 3 or 4/);
  });
});

describe("z-score", () => {
  it("standardises like Excel STANDARDIZE", () => {
    expect(zScore(9, 5, 2)).toBe(2);
    expect(zScore(1, 5, 2)).toBe(-2);
  });
  it("rejects zero or negative spread and non-finite input", () => {
    expect(() => zScore(1, 1, 0)).toThrowError(/greater than 0/);
    expect(() => zScore(1, 1, -1)).toThrowError(MathInputError);
    expect(() => zScore(NaN, 1, 1)).toThrowError(MathInputError);
  });
  it("zScores against the dataset itself", () => {
    expect(zScores(CLASSIC, "population")).toEqual([-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2]);
    const zs = zScores(SALES, "sample");
    expect(zs[9]).toBeCloseTo((312 - 162.5) / 53.0748946720052, 10);
    expect(() => zScores([1], "sample")).toThrowError(MathInputError);
    expect(() => zScores([3, 3], "population")).toThrowError(/greater than 0/);
  });
});

describe("computeStatistic", () => {
  it("dispatches every kind", () => {
    const expected: Record<string, number> = {
      mean: 162.5,
      median: 147,
      min: 132,
      max: 312,
      range: 180,
      populationVariance: 2535.25,
      sampleVariance: 25352.5 / 9,
      populationStdDev: 50.3512661211215,
      sampleStdDev: 53.0748946720052,
      q1: 141.75,
      q3: 153.75,
      iqr: 12,
    };
    for (const kind of STATISTIC_KINDS) {
      expect(computeStatistic(kind, SALES)).toBeCloseTo(expected[kind] as number, 9);
    }
  });
  it("isStatisticKind", () => {
    expect(isStatisticKind("mean")).toBe(true);
    expect(isStatisticKind("average")).toBe(false);
    expect(isStatisticKind(3)).toBe(false);
  });
});
