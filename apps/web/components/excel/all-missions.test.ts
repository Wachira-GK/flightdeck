// Quality gate for ALL Excel content, however many missions there are. For every mission and exercise it checks
// structure, key consistency, that a reference solution (content/excel/solutions/<exercise>.solution.json,
// test-only, never bundled) PASSES the server grader, and that an unsolved sheet does NOT pass.
import fs from "node:fs";
import path from "node:path";
import { validateSubmission, type ExerciseDefinition, type ExerciseKey } from "@flightdeck/excel-engine";
import { describe, expect, it } from "vitest";
import { EXERCISE_KEYS, MISSION_KEYS } from "../../server/excel-registry.generated";
import { getExcelMission, EXCEL_MISSION_SLUGS } from "./content";
import { EXCEL_EXERCISE_IDS, getExcelExercise } from "./exercises";
import { validateExcelMission, type ExcelMission } from "./missions";
import { EXERCISE_DEFINITIONS, MISSION_DEFINITIONS } from "./registry.generated";

const solutionsDir = path.resolve(__dirname, "..", "..", "..", "..", "content", "excel", "solutions");
const solutionOf = (id: string): Record<string, string> | undefined => {
  const f = path.join(solutionsDir, `${id}.solution.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as { cells: Record<string, string> }).cells : undefined;
};

describe("Excel content, every mission", () => {
  it("has a key for every exercise and mission, and no orphan keys", () => {
    expect(Object.keys(EXERCISE_KEYS).sort()).toEqual([...EXCEL_EXERCISE_IDS].sort());
    expect(Object.keys(MISSION_KEYS).sort()).toEqual([...EXCEL_MISSION_SLUGS].sort());
  });

  it("has unique, well-formed mission codes in one sequence and every exercise is used", () => {
    const missions = Object.values(MISSION_DEFINITIONS) as ExcelMission[];
    const codes = missions.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^EX-\d{3}$/);
    const used = new Set(missions.map((m) => m.exerciseId));
    for (const id of EXCEL_EXERCISE_IDS) expect(used.has(id), `exercise ${id} is not used by any mission`).toBe(true);
    expect(new Set(missions.map((m) => m.exerciseId)).size, "each mission needs its own exercise").toBe(missions.length);
  });

  it.each(EXCEL_MISSION_SLUGS)("%s is valid, consistent with its keys, ships no answers", (slug) => {
    const { mission, exercise } = getExcelMission(slug)!;
    expect(validateExcelMission(mission, exercise, MISSION_KEYS[slug])).toEqual([]);
    expect(JSON.stringify({ mission, exercise })).not.toMatch(/correctOptionId|"expected"|rationale|hiddenTests|requireFormula/);
    expect(mission.assessment.items.length).toBeGreaterThanOrEqual(3);
    for (const k of MISSION_KEYS[slug]!.items) expect(k.rationale.length, `${slug}/${k.id} needs a rationale`).toBeGreaterThan(15);
  });

  it.each(EXCEL_EXERCISE_IDS)("exercise %s: reference solution passes, unsolved sheet does not", (id) => {
    const exercise = getExcelExercise(id) as ExerciseDefinition;
    const key = EXERCISE_KEYS[id] as ExerciseKey;
    expect(EXERCISE_DEFINITIONS[id]).toBeDefined();
    expect(key.exerciseId).toBe(id);
    expect(key.exerciseVersion).toBe(exercise.version);

    const solution = solutionOf(id);
    expect(solution, `missing content/excel/solutions/${id}.solution.json`).toBeDefined();
    const solved = validateSubmission(exercise, { exerciseId: id, exerciseVersion: exercise.version, cells: solution! }, key);
    const failing = solved.checks.filter((c) => !c.passed).map((c) => `${c.kind}:${c.id}:${c.message}`);
    expect(failing, `solution for ${id} fails: ${failing.join(" | ")}`).toEqual([]);
    expect(solved.passed).toBe(true);

    const blank = validateSubmission(exercise, { exerciseId: id, exerciseVersion: exercise.version, cells: {} }, key);
    expect(blank.passed, `an empty submission must not pass ${id}`).toBe(false);

    // The learner's starter must not already satisfy the key by accident: typed constants for every
    // required-formula cell (the expected values) must not pass either.
    const typed: Record<string, string> = {};
    for (const e of key.expected) typed[e.cell] = String(e.value);
    const cheat = validateSubmission(exercise, { exerciseId: id, exerciseVersion: exercise.version, cells: typed }, key);
    expect(cheat.passed, `typing the answers must not pass ${id}`).toBe(false);
  });
});
