import { describe, expect, it } from "vitest";
import {
  axisLabels,
  clampToStep,
  describeChart,
  describeStats,
  linearScale,
  MathInputError,
  niceTicks,
  replaceAt,
  statFormulas,
  summarize,
  validateExplorerDataset,
  type StatsExplorerDataset,
} from "../src";

const SALES = [132, 148, 141, 155, 139, 150, 146, 158, 144, 312];
const DS: StatsExplorerDataset = {
  id: "store-weekly-pairs",
  title: "Weekly pairs sold",
  unit: "pairs",
  labels: SALES.map((_, i) => `Wk ${i + 1}`),
  values: SALES,
  adjustable: { index: 9, min: 100, max: 400, step: 1 },
};

describe("summarize", () => {
  it("sample by default", () => {
    const s = summarize(SALES);
    expect(s).toMatchObject({ n: 10, total: 1625, mean: 162.5, median: 147, min: 132, max: 312, range: 180, spread: "sample" });
    expect(s.stdDev).toBeCloseTo(53.0749, 4);
  });
  it("population on request", () => {
    expect(summarize(SALES, "population").stdDev).toBeCloseTo(50.3513, 4);
    expect(summarize([4], "population").stdDev).toBe(0);
    expect(() => summarize([4], "sample")).toThrowError(MathInputError);
  });
  it("mean moves but median resists when the outlier moves", () => {
    const before = summarize(SALES);
    const after = summarize(replaceAt(SALES, 9, 150));
    expect(after.mean).toBeCloseTo(146.3, 10);
    expect(after.median).toBe(before.median);
  });
});

describe("statFormulas", () => {
  it("fills formulas with live numbers", () => {
    const f = statFormulas(SALES);
    expect(f.mean).toContain("\\frac{1625}{10} = 162.5");
    expect(f.median).toContain("\\frac{146 + 148}{2} = 147");
    expect(f.range).toContain("312 - 132 = 180");
    expect(f.stdDev).toContain("{25352.5}{9}} = 53.1");
  });
  it("odd n median and population sd", () => {
    const f = statFormulas([1, 2, 9], "population", 2);
    expect(f.median).toBe("\\tilde{x} = x_{(2)} = 2");
    expect(f.stdDev.startsWith("\\sigma")).toBe(true);
  });
});

describe("replaceAt / clampToStep", () => {
  it("replaces without mutating", () => {
    const next = replaceAt(SALES, 0, 1);
    expect(next[0]).toBe(1);
    expect(SALES[0]).toBe(132);
    expect(() => replaceAt(SALES, 10, 1)).toThrowError(/Index/);
    expect(() => replaceAt(SALES, 0, NaN)).toThrowError(MathInputError);
  });
  it("clamps and snaps", () => {
    expect(clampToStep(1000, 100, 400, 1)).toBe(400);
    expect(clampToStep(-5, 100, 400, 1)).toBe(100);
    expect(clampToStep(152, 100, 400, 5)).toBe(150);
    expect(clampToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
  });
});

describe("scales and ticks", () => {
  it("linearScale maps and inverts for SVG y axes", () => {
    const y = linearScale([0, 400], [300, 20]);
    expect(y(0)).toBe(300);
    expect(y(400)).toBe(20);
    expect(y(200)).toBe(160);
    expect(linearScale([5, 5], [0, 10])(123)).toBe(5);
  });
  it("niceTicks", () => {
    expect(niceTicks(0, 400, 4)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0, 7, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 10, 4)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(10, 0, 2)).toEqual([0, 5, 10]);
    expect(niceTicks(3, 3)).toEqual([3]);
    expect(() => niceTicks(NaN, 1)).toThrowError(MathInputError);
  });
});

describe("axisLabels", () => {
  it("moves a shared word prefix into the axis title", () => {
    expect(axisLabels(["Wk 1", "Wk 2", "Wk 10"])).toEqual({ title: "Wk", ticks: ["1", "2", "10"] });
    expect(axisLabels(["Week of 3 Mar", "Week of 10 Mar"])).toEqual({ title: null, ticks: ["Week of 3 Mar", "Week of 10 Mar"] });
  });
  it("leaves labels alone when there is no common prefix", () => {
    expect(axisLabels(["Jan", "Feb"])).toEqual({ title: null, ticks: ["Jan", "Feb"] });
    expect(axisLabels(["Wk 1", "Month 2"])).toEqual({ title: null, ticks: ["Wk 1", "Month 2"] });
    expect(axisLabels(["Wk 1"])).toEqual({ title: null, ticks: ["Wk 1"] });
    expect(axisLabels([])).toEqual({ title: null, ticks: [] });
  });
});

describe("descriptions for assistive tech", () => {
  it("describeStats reports where the mean sits relative to the median", () => {
    expect(describeStats(SALES, "pairs")).toBe(
      "Mean 162.5 pairs, median 147 pairs, range 180 pairs, sample standard deviation 53.1 pairs. The mean is 15.5 pairs above the median.",
    );
    expect(describeStats([1, 2, 3], "pairs", "population")).toContain("The mean equals the median.");
    expect(describeStats([0, 8, 9, 10, 1], "pairs")).toContain("below the median");
  });
  it("describeChart", () => {
    expect(describeChart(DS, SALES)).toMatch(/^Bar chart: Weekly pairs sold\. 10 values from 132 to 312 pairs\. Mean 162\.5/);
  });
});

describe("validateExplorerDataset", () => {
  it("accepts a valid dataset", () => {
    expect(validateExplorerDataset(DS)).toBe(DS);
  });
  it.each([
    ["label count", { ...DS, labels: ["a"] }, /same length/],
    ["index", { ...DS, adjustable: { ...DS.adjustable, index: 10 } }, /index/],
    ["min >= max", { ...DS, adjustable: { ...DS.adjustable, min: 500 } }, /min < max/],
    ["step", { ...DS, adjustable: { ...DS.adjustable, step: 0 } }, /step > 0/],
    ["value out of range", { ...DS, adjustable: { ...DS.adjustable, max: 200 } }, /within min..max/],
    ["non-finite", { ...DS, adjustable: { ...DS.adjustable, max: Infinity } }, /finite/],
    ["empty", { ...DS, values: [], labels: [] }, /empty/],
  ])("rejects bad %s", (_name, ds, msg) => {
    expect(() => validateExplorerDataset(ds as StatsExplorerDataset)).toThrowError(msg);
  });
});
