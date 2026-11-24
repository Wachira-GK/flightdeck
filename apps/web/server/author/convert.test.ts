import fs from "node:fs";
import path from "node:path";
import type { ExerciseDefinition } from "@flightdeck/excel-engine";
import { describe, expect, it } from "vitest";
import { EXCEL_EXERCISE_IDS, getExcelExercise } from "../../components/excel/exercises";
import { EXERCISE_DEFINITIONS, MISSION_DEFINITIONS } from "../../components/excel/registry.generated";
import type { ExcelMission } from "../../components/excel/missions";
import { blankDoc, expandCells, parseOverrides, PLACEHOLDER, type EditorDoc } from "../../lib/author/doc";
import { EXERCISE_KEYS, MISSION_KEYS } from "../excel-registry.generated";
import { buildContent, contentToDoc, type StoredExerciseKey } from "./convert";

const solutionsDir = path.resolve(__dirname, "..", "..", "..", "..", "content", "excel", "solutions");
const solutionOf = (id: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(solutionsDir, `${id}.solution.json`), "utf8")).cells;

/** The starter mission with every [edit] marker filled in, so only real problems remain. */
const filled = (): EditorDoc => JSON.parse(JSON.stringify(blankDoc("excel-demo-901", "EX-901", "Demo total", "beginner")).split(`${PLACEHOLDER} `).join(""));

describe("AUT author content conversion (ADR-015 stages 2c/2e)", () => {
  it("AUT-01 a brand-new starter mission is complete but cannot be sent for review until every [edit] is replaced", () => {
    const r = buildContent(blankDoc("excel-demo-901", "EX-901", "Demo total", "beginner"));
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]).toContain(PLACEHOLDER);
  });

  it("AUT-02 a filled-in mission has no issues, and expected values come from the solution, not from the author", () => {
    const r = buildContent(filled());
    expect(r.issues).toEqual([]);
    expect(r.exerciseKey.expected).toMatchObject([{ cell: "B5", value: 60 }]);
    expect(r.exerciseKey.requireFormula).toEqual(["B5"]);
    expect(r.exerciseKey.hiddenTests[0]).toMatchObject({ overrides: { B2: "15", B4: "45" }, expect: { B5: 80 } });
    expect(r.exercise.allowedFunctions).toEqual(["SUM"]);
    expect(r.mission.level).toBe("beginner");
    expect(r.mission.passMark).toBe(0.8);
  });

  it("AUT-03 the learner-facing documents carry no answers", () => {
    const r = buildContent(filled());
    const pub = JSON.stringify({ mission: r.mission, exercise: r.exercise });
    for (const k of ["correctOptionId", "rationale", "expected", "hiddenTests", "requireFormula", "authoring"]) expect(pub).not.toContain(k);
  });

  it("AUT-04 problems are explained in plain words", () => {
    const d = filled();
    d.sheet.solution = {};
    d.sheet.scenarios = [];
    d.questions[0]!.expected = "abc";
    d.questions[1]!.correctOptionId = "z";
    d.sheet.editable = "B5, nonsense";
    const issues = buildContent(d).issues.join("\n");
    expect(issues).toContain("not cell references");
    expect(issues).toContain("needs your solution");
    expect(issues).toContain("at least one what-if");
    expect(issues).toContain("must be a number");
    expect(issues).toContain("pick which choice is correct");
  });

  it("AUT-05 a solution that is only a typed number is refused, because typing the answer would pass", () => {
    const d = filled();
    d.sheet.solution = { B5: "60" };
    d.sheet.requireFunctions = {};
    expect(buildContent(d).issues.join("\n")).toContain("Typing the answers");
  });

  it("AUT-06 spelling out an answer in the instructions or hints is refused", () => {
    const d = filled();
    d.sheet.hints = ["The total is 60 so check your sum."];
    expect(buildContent(d).issues.join("\n")).toContain("spell out an answer (60 for B5)");
    const d2 = filled();
    d2.questions[0]!.expected = "60.5";
    d2.steps[0]!.blocks = [{ type: "paragraph", text: "Last year it was 60.5 in total." }];
    expect(buildContent(d2).issues.join("\n")).toContain("appears in the learner-facing text");
  });

  it("AUT-07 changing the sheet after publishing bumps its version; leaving it alone keeps the version", () => {
    const first = buildContent(filled());
    expect(first.exercise.version).toBe(1);
    expect(buildContent(filled(), first.exercise).exercise.version).toBe(1);
    const d = filled();
    d.sheet.starter.B2 = "12";
    expect(buildContent(d, first.exercise).exercise.version).toBe(2);
    expect(buildContent(d, first.exercise).exerciseKey.exerciseVersion).toBe(2);
  });

  it("AUT-08 what the author typed round-trips exactly through save and reload", () => {
    const d = filled();
    const built = buildContent(d);
    const back = contentToDoc({ slug: d.slug, level: d.level, mission: built.mission, exercise: built.exercise, keys: built.keys, exerciseKey: built.exerciseKey });
    expect(back).toEqual(d);
  });

  it("AUT-09 helpers: cell ranges and what-if inputs", () => {
    expect(expandCells("F2:F4, G2")).toEqual({ cells: ["F2", "F3", "F4", "G2"], bad: [] });
    expect(expandCells("B5:A1, zz").bad).toEqual(["B5:A1", "zz"]);
    expect(parseOverrides("c2=160\nC5 =  Nairobi, CBD ")).toEqual({ overrides: { C2: "160", C5: "  Nairobi, CBD " }, bad: [] });
    expect(parseOverrides("160").bad).toEqual(["160"]);
  });

  const slugs = Object.keys(MISSION_DEFINITIONS);
  it.each(slugs)("AUT-10 built-in mission %s can be reopened, rebuilt and regenerates its own answer key", (slug) => {
    const mission = MISSION_DEFINITIONS[slug] as ExcelMission;
    const exercise = getExcelExercise(mission.exerciseId) as ExerciseDefinition;
    const original = EXERCISE_KEYS[mission.exerciseId] as StoredExerciseKey;
    const stored: StoredExerciseKey = { ...original, authoring: { solution: solutionOf(mission.exerciseId) } };
    const doc = contentToDoc({ slug, level: mission.level, mission, exercise, keys: MISSION_KEYS[slug]!, exerciseKey: stored });
    const rebuilt = buildContent(doc, exercise);
    expect(rebuilt.issues, `${slug}: ${rebuilt.issues.join(" | ")}`).toEqual([]);
    // The regenerated key grades exactly like the original: same expected cells and values, same what-if answers.
    const sorted = (o: Record<string, unknown>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
    const norm = (k: StoredExerciseKey) => ({
      expected: k.expected.map((e) => [e.cell, e.value] as const).sort(([a], [b]) => a.localeCompare(b)),
      tests: k.hiddenTests.map((t) => [sorted(t.overrides), sorted(t.expect)]),
    });
    expect(norm(rebuilt.exerciseKey)).toEqual(norm(original));
    expect(rebuilt.mission.assessment.items).toEqual(mission.assessment.items);
    expect(rebuilt.exercise.version).toBe(exercise.version);
  });

  it("AUT-11 every built-in exercise is covered", () => {
    expect(Object.keys(EXERCISE_DEFINITIONS).sort()).toEqual([...EXCEL_EXERCISE_IDS].sort());
  });
});
