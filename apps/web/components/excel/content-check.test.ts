// Author-side check that reads mission files straight from disk (no generated registry), so several people can
// write content at the same time. Runs ONLY when FD_ONLY is set to a comma-separated list of mission slugs:
//   $env:FD_ONLY="excel-avg-105,excel-count-106"; pnpm --filter @flightdeck/web exec vitest run components/excel/content-check.test.ts
// With FD_ONLY unset it is skipped (components/excel/all-missions.test.ts covers everything through the registry).
import fs from "node:fs";
import path from "node:path";
import { validateSubmission, type ExerciseDefinition, type ExerciseKey } from "@flightdeck/excel-engine";
import { describe, expect, it } from "vitest";
import { validateExcelMission, type ExcelMission, type ExcelMissionKeys } from "./missions";

const root = path.resolve(__dirname, "..", "..", "..", "..", "content", "excel");
const only = (process.env.FD_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const read = <T>(...p: string[]): T => JSON.parse(fs.readFileSync(path.join(root, ...p), "utf8")) as T;

describe.skipIf(only.length === 0)("authoring check (FD_ONLY)", () => {
  it.each(only)("%s", (slug) => {
    const mission = read<ExcelMission>("missions", `${slug}.json`);
    const keys = read<ExcelMissionKeys>("missions", `${slug}.keys.json`);
    const exercise = read<ExerciseDefinition>("exercises", `${mission.exerciseId}.json`);
    const key = read<ExerciseKey>("exercises", `${mission.exerciseId}.key.json`);
    const solution = read<{ cells: Record<string, string> }>("solutions", `${mission.exerciseId}.solution.json`).cells;

    expect(mission.slug).toBe(slug);
    expect(validateExcelMission(mission, exercise, keys)).toEqual([]);
    expect(key.exerciseId).toBe(exercise.id);
    expect(key.exerciseVersion).toBe(exercise.version);
    for (const k of keys.items) expect(k.rationale.length, `${k.id} rationale`).toBeGreaterThan(15);

    const sub = (cells: Record<string, string>) => ({ exerciseId: exercise.id, exerciseVersion: exercise.version, cells });
    const solved = validateSubmission(exercise, sub(solution), key);
    expect(solved.checks.filter((c) => !c.passed).map((c) => `${c.kind}:${c.id}:${c.message}`), "reference solution must pass").toEqual([]);
    expect(solved.passed).toBe(true);
    expect(validateSubmission(exercise, sub({}), key).passed, "empty submission must fail").toBe(false);
    const typed: Record<string, string> = {};
    for (const e of key.expected) typed[e.cell] = String(e.value);
    expect(validateSubmission(exercise, sub(typed), key).passed, "typing the answers must fail").toBe(false);

    // Typed text must not give the answers away in the learner-safe files.
    const learnerText = JSON.stringify({ mission, exercise });
    expect(learnerText).not.toMatch(/correctOptionId|"expected"|rationale|hiddenTests|requireFormula/);
  });
});
