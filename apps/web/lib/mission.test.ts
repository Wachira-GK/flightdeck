import { describe, expect, it } from "vitest";
import {
  adjacentSteps,
  isMissionStep,
  missionProgress,
  MISSION_STEPS,
  parseStep,
  stepStatus,
} from "./mission";

describe("parseStep", () => {
  it("accepts known steps case-insensitively", () => {
    expect(parseStep("Simulation")).toBe("simulation");
    expect(parseStep(" debrief ")).toBe("debrief");
  });
  it("falls back to briefing for missing or unknown input", () => {
    expect(parseStep(undefined)).toBe("briefing");
    expect(parseStep("certificate")).toBe("briefing");
    expect(parseStep("<script>")).toBe("briefing");
  });
  it("uses the first value of a repeated param", () => {
    expect(parseStep(["assessment", "training"])).toBe("assessment");
    expect(parseStep([])).toBe("briefing");
  });
});

describe("step navigation", () => {
  it("keeps the approved order", () => {
    expect(MISSION_STEPS).toEqual(["briefing", "training", "simulation", "assessment", "debrief"]);
  });
  it("returns prev/next with null at the ends", () => {
    expect(adjacentSteps("briefing")).toEqual({ prev: null, next: "training" });
    expect(adjacentSteps("simulation")).toEqual({ prev: "training", next: "assessment" });
    expect(adjacentSteps("debrief")).toEqual({ prev: "assessment", next: null });
  });
  it("derives step status", () => {
    expect(stepStatus("training", "training", ["briefing"])).toBe("current");
    expect(stepStatus("briefing", "training", ["briefing"])).toBe("complete");
    expect(stepStatus("debrief", "training", ["briefing"])).toBe("upcoming");
  });
  it("type-guards steps", () => {
    expect(isMissionStep("training")).toBe(true);
    expect(isMissionStep(3)).toBe(false);
  });
});

describe("missionProgress", () => {
  it("computes whole-number percentages", () => {
    expect(missionProgress([])).toBe(0);
    expect(missionProgress(["briefing"])).toBe(20);
    expect(missionProgress([...MISSION_STEPS])).toBe(100);
  });
  it("ignores duplicates", () => {
    expect(missionProgress(["briefing", "briefing", "training"])).toBe(40);
  });
});
