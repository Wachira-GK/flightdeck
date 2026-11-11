import { describe, expect, it } from "vitest";
import mission from "../../../content/math/missions/descriptive-stats-101.json";
import keys from "../../../content/math/missions/descriptive-stats-101.keys.json";
import { gradeMathAssessment, type MathMission, type MathMissionKeys } from "../src";

const m = mission as unknown as MathMission;
const k = keys as unknown as MathMissionKeys;
const allCorrect = { "a1-mean-store-b": "105.2", "a2-median-store-b": "90", "a3-sd-store-b": "50.86", "a4-typical-week": "median" };

describe("gradeMathAssessment", () => {
  it("passes with all correct answers and reveals worked steps and rationale", () => {
    const r = gradeMathAssessment(m, k, allCorrect);
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.items.every((i) => i.status === "correct")).toBe(true);
    expect(r.items.find((i) => i.id === "a1-mean-store-b")?.workedSteps?.length).toBeGreaterThan(0);
    expect(r.items.find((i) => i.id === "a4-typical-week")?.feedback).toMatch(/median/i);
  });

  it("passes at exactly the pass mark (3 of 4 = 75%)", () => {
    const r = gradeMathAssessment(m, k, { ...allCorrect, "a4-typical-week": "mean" });
    expect(r.score).toBe(75);
    expect(r.passed).toBe(true);
  });

  it("fails below the pass mark and reveals no solutions", () => {
    const r = gradeMathAssessment(m, k, { "a1-mean-store-b": "100", "a2-median-store-b": "90", "a4-typical-week": "mean" });
    expect(r.passed).toBe(false);
    expect(r.score).toBe(25);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/105\.2|50\.86/);
    expect(r.items.every((i) => i.workedSteps === undefined)).toBe(true);
    expect(r.items.find((i) => i.id === "a3-sd-store-b")?.status).toBe("unanswered");
  });

  it("respects tolerance (±0.01 on the 2-dp standard deviation)", () => {
    expect(gradeMathAssessment(m, k, { ...allCorrect, "a3-sd-store-b": "50.87" }).items[2]?.status).toBe("correct");
    expect(gradeMathAssessment(m, k, { ...allCorrect, "a3-sd-store-b": "50.9" }).items[2]?.status).toBe("incorrect");
  });

  it("treats a comma decimal as invalid with a helpful message, not a leak", () => {
    const r = gradeMathAssessment(m, k, { ...allCorrect, "a1-mean-store-b": "105,2" });
    const item = r.items[0];
    expect(item?.status).toBe("invalid");
    expect(r.passed).toBe(true);
    const failed = gradeMathAssessment(m, k, { "a1-mean-store-b": "105,2" });
    expect(failed.items[0]?.feedback).toMatch(/dot|decimal/i);
    expect(failed.items[0]?.feedback).not.toMatch(/105\.2/);
  });

  it("ignores unknown answer ids, non-string values and truncates long input", () => {
    const r = gradeMathAssessment(m, k, { evil: "x", "a2-median-store-b": 90, "a1-mean-store-b": "9".repeat(500) });
    expect(r.items.find((i) => i.id === "a2-median-store-b")?.status).toBe("unanswered");
    expect(r.items).toHaveLength(4);
  });

  it("rejects keys for a different mission", () => {
    expect(() => gradeMathAssessment(m, { ...k, missionSlug: "other" }, {})).toThrow(/keys belong/);
  });
});
