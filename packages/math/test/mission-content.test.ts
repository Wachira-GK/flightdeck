import { describe, expect, it, vi } from "vitest";
import missionJson from "../../../content/math/missions/descriptive-stats-101.json";
import keysJson from "../../../content/math/missions/descriptive-stats-101.keys.json";
import {
  computeStatistic,
  getMissionDataset,
  gradeNumericAnswer,
  renderMath,
  resolvePracticeQuestion,
  summarize,
  validateMathMission,
  type MathMission,
  type MathMissionKeys,
} from "../src";

const mission = missionJson as unknown as MathMission;
const keys = keysJson as unknown as MathMissionKeys;

describe("content/math/missions/descriptive-stats-101", () => {
  it("is valid and consistent with its answer keys", () => {
    expect(validateMathMission(mission, keys)).toEqual([]);
  });

  it("contains no answers in the client-visible mission file", () => {
    const text = JSON.stringify(mission);
    expect(text).not.toMatch(/"(expected|correctOptionId|answer|answers|solution|rationale)"/);
  });

  it("uses a realistic retail dataset: 8-12 weekly values with one outlier pulling the mean above the median", () => {
    for (const ds of mission.datasets) {
      expect(ds.values.length).toBeGreaterThanOrEqual(8);
      expect(ds.values.length).toBeLessThanOrEqual(12);
      const s = summarize(ds.values);
      expect(s.mean).toBeGreaterThan(s.median);
    }
    const a = getMissionDataset(mission, "store-a-weekly-pairs");
    expect(a && summarize(a.values)).toMatchObject({ mean: 162.5, median: 147, range: 180 });
  });

  it("renders every TeX string without a KaTeX error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const texs = mission.steps.flatMap((s) =>
      s.blocks.flatMap((b) => (b.type === "math" || b.type === "definition" ? [b.tex] : [])),
    );
    expect(texs.length).toBeGreaterThanOrEqual(5);
    for (const tex of texs) expect(renderMath(tex, { displayMode: true }), tex).not.toContain("katex-error");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("server grading with the keys file accepts the right answers and explains with Store B's data", () => {
    for (const key of keys.items) {
      if (key.type !== "numeric") continue;
      const ds = getMissionDataset(mission, key.explain.datasetId);
      if (!ds) throw new Error("dataset missing");
      const answer = String(key.expected);
      const r = gradeNumericAnswer({
        expected: key.expected,
        tolerance: key.tolerance,
        answer,
        explain: { statistic: key.explain.statistic, dataset: ds.values, decimals: key.explain.decimals, unit: ds.unit },
      });
      expect(r.correct, key.id).toBe(true);
      expect(r.workedSteps.length).toBeGreaterThan(0);
    }
    const mean = keys.items.find((k) => k.id === "a1-mean-store-b");
    expect(mean?.type === "numeric" && mean.expected).toBe(105.2);
  });

  it("resolves practice questions with expected values derived from the public dataset", () => {
    const p = resolvePracticeQuestion(mission, "practice-mean-store-a");
    expect(p?.question.dataset).toHaveLength(10);
    expect(p && computeStatistic(p.question.statistic, p.question.dataset)).toBe(162.5);
    expect(resolvePracticeQuestion(mission, "nope")).toBeUndefined();
  });

  it("validateMathMission reports broken references, leaks and wrong keys", () => {
    const broken: MathMission = {
      ...mission,
      passMark: 2,
      steps: [
        ...mission.steps.slice(0, 2),
        { id: "simulation", title: "x", blocks: [{ type: "stats-explorer", datasetId: "missing" }] },
        ...mission.steps.slice(3),
      ],
      assessment: {
        items: [
          ...mission.assessment.items,
          { id: "extra", type: "single-choice", prompt: "?", options: [{ id: "x", label: "x" }] },
        ],
      },
    };
    (broken as unknown as { expected: number }).expected = 1;
    const badKeys: MathMissionKeys = {
      ...keys,
      items: keys.items.map((k) => (k.type === "numeric" && k.id === "a2-median-store-b" ? { ...k, expected: 91 } : k)),
    };
    const issues = validateMathMission(broken, badKeys);
    expect(issues.join("\n")).toMatch(/passMark/);
    expect(issues.join("\n")).toMatch(/unknown dataset missing/);
    expect(issues.join("\n")).toMatch(/answer field in client-visible mission file: mission\.expected/);
    expect(issues.join("\n")).toMatch(/item extra: needs 2\+ options/);
    expect(issues.join("\n")).toMatch(/item extra: no answer key/);
    expect(issues.join("\n")).toMatch(/key a2-median-store-b: expected 91/);
    expect(validateMathMission({ ...mission, steps: mission.steps.slice(1) })).toContain(
      "steps must be briefing > training > simulation > assessment > debrief",
    );
  });
});
