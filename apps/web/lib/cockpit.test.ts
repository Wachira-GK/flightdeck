import { describe, expect, it } from "vitest";
import { parseProgress } from "../server/cockpit-data";
import type { CatalogueTrack } from "./catalogue";
import { buildCockpit, completedStepsFor, EMPTY_PROGRESS, type SavedProgress } from "./cockpit";

const m = (slug: string, code: string, position: number) => ({
  slug, level: "beginner" as const, code, title: `Title ${code}`, summary: null, estimatedMinutes: 10, position, courseSlug: "c", href: `/missions/${slug}` as const,
});
const CATALOGUE: CatalogueTrack[] = [
  { slug: "excel", title: "Excel", subject: "Excel", description: "d", status: "available", courses: [], missions: [m("a", "EX-101", 1), m("b", "EX-102", 2)] },
  { slug: "math", title: "Math", subject: "Stats", description: "d", status: "available", courses: [], missions: [m("c", "MA-101", 1)] },
  { slug: "sql", title: "SQL", subject: "SQL", description: "d", status: "locked", lockedReason: "Coming later", courses: [], missions: [] },
];
const passA: SavedProgress = {
  steps: [{ missionSlug: "a", kind: "simulation", at: "2026-11-15T10:00:00Z" }, { missionSlug: "a", kind: "assessment", at: "2026-11-15T10:05:00Z" }],
  attempts: [{ missionSlug: "a", passed: true, score: 100, at: "2026-11-15T10:05:00Z" }],
};

describe("Cockpit view", () => {
  it("a new learner starts the first mission with nothing completed", () => {
    const v = buildCockpit(CATALOGUE, EMPTY_PROGRESS);
    expect(v.active).toMatchObject({ currentStep: "briefing", progress: 0, mission: { slug: "a" } });
    expect(v.tracks.map((t) => [t.slug, t.done, t.total])).toEqual([["excel", 0, 2], ["math", 0, 1], ["sql", 0, 0]]);
    expect(v.activity).toEqual([]);
    expect(v.startedAny).toBe(false);
  });

  it("infers earlier steps from a saved simulation pass", () => {
    const p: SavedProgress = { steps: [{ missionSlug: "a", kind: "simulation", at: "2026-11-15T10:00:00Z" }], attempts: [] };
    expect(completedStepsFor("a", p)).toEqual(["briefing", "training", "simulation"]);
    expect(buildCockpit(CATALOGUE, p).active).toMatchObject({ currentStep: "assessment", progress: 60 });
  });

  it("a passed assessment finishes the mission and moves on to the next one", () => {
    const v = buildCockpit(CATALOGUE, passA);
    expect(completedStepsFor("a", passA)).toHaveLength(5);
    expect(v.active?.mission.slug).toBe("b");
    expect(v.tracks[0]).toMatchObject({ done: 1, total: 2 });
    expect(v.activity[0]?.label).toBe("Passed Assessment: Title EX-101 (100%)");
    expect(v.activity[1]?.label).toBe("Completed Simulation: Title EX-101");
  });

  it("a failed attempt is shown but does not complete the mission", () => {
    const p: SavedProgress = { steps: [], attempts: [{ missionSlug: "a", passed: false, score: 49.6, at: "2026-11-15T10:00:00Z" }] };
    const v = buildCockpit(CATALOGUE, p);
    expect(v.active?.mission.slug).toBe("a");
    expect(v.activity[0]?.label).toContain("50%, not yet a pass");
    expect(v.startedAny).toBe(true);
  });

  it("has no active mission once everything open is complete, and ignores locked tracks", () => {
    const all: SavedProgress = {
      steps: [],
      attempts: ["a", "b", "c"].map((s) => ({ missionSlug: s, passed: true, score: 90, at: "2026-11-15T10:00:00Z" })),
    };
    expect(buildCockpit(CATALOGUE, all).active).toBeNull();
  });

  it("limits recent activity to the newest items", () => {
    const attempts = Array.from({ length: 8 }, (_, i) => ({ missionSlug: "a", passed: false, score: i, at: `2026-11-15T10:0${i}:00Z` }));
    const v = buildCockpit(CATALOGUE, { steps: [], attempts });
    expect(v.activity).toHaveLength(5);
    expect(v.activity[0]?.at).toBe("2026-11-15T10:07:00Z");
  });
});

describe("parseProgress", () => {
  it("maps PostgREST rows to saved progress and drops incomplete rows", () => {
    const p = parseProgress(
      [{ completed_at: "t1", mission_steps: { kind: "simulation", missions: { slug: "a" } } }, { completed_at: "t2", mission_steps: null }],
      [{ score: "100.00", passed: true, graded_at: "t3", assessments: { slug: "a-assessment" } }, { score: "x", passed: false, graded_at: "t4", assessments: { slug: "b-assessment" } }],
    );
    expect(p).toEqual({
      steps: [{ missionSlug: "a", kind: "simulation", at: "t1" }],
      attempts: [{ missionSlug: "a", passed: true, score: 100, at: "t3" }],
    });
  });
});
