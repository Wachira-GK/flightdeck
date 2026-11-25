import { describe, expect, it } from "vitest";
import { missionProgress, stepsDoneAt } from "./mission";

describe("MPG mission bar moves as the learner clicks through the steps", () => {
  it("MPG-01 nothing is done on the first step; each step forward adds one fifth", () => {
    expect(missionProgress(stepsDoneAt("briefing", []))).toBe(0);
    expect(missionProgress(stepsDoneAt("training", []))).toBe(20);
    expect(missionProgress(stepsDoneAt("simulation", []))).toBe(40);
    expect(missionProgress(stepsDoneAt("assessment", []))).toBe(60);
    expect(missionProgress(stepsDoneAt("debrief", []))).toBe(80);
  });

  it("MPG-02 saved completions are added, never double counted", () => {
    expect(stepsDoneAt("training", ["briefing", "training", "simulation"])).toEqual(["briefing", "training", "simulation"]);
    expect(missionProgress(stepsDoneAt("briefing", ["briefing", "training", "simulation", "assessment", "debrief"]))).toBe(100);
  });
});
