import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan, gradePlan, gradeSheetAnswer, publicView, type SheetPoolItem } from "./exams";
import { getGradableExercise } from "./excel-keys";

const ID = "averageif-region-average";
const g = getGradableExercise(ID)!;
const solution = JSON.parse(readFileSync(resolve(__dirname, `../../../content/excel/solutions/${ID}.solution.json`), "utf8")) as { cells: Record<string, string> };
const item: SheetPoolItem = { slug: "excel-averageif-1xx", code: "EX-1xx", title: "AVERAGEIF mission", exercise: g.exercise, key: g.key };
const plan = buildPlan([], 0, "sheet-seed", [item], 1);

describe("sheet tasks in exams (EXW-S)", () => {
  it("EXW-S01 the plan holds the key, the browser view holds the exercise only (no expected values, no hints)", () => {
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.type).toBe("sheet");
    const view = JSON.stringify(publicView(plan, []));
    expect(view).toContain(ID);
    for (const bad of ["expected", "hiddenTests", "requireFormula", "chk-f2", "AVERAGEIF mission", "EX-1xx"]) expect(view).not.toContain(bad);
    expect(publicView(plan, [])[0]!.exercise!.hints).toEqual([]);
    expect(publicView(plan, [])[0]!.hintAvailable).toBe(false);
  });

  it("EXW-S02 the reference solution passes; blank, wrong, malformed and oversized answers fail", () => {
    expect(gradeSheetAnswer(g.exercise, g.key, JSON.stringify(solution.cells))).toBe(true);
    expect(gradeSheetAnswer(g.exercise, g.key, "{}")).toBe(false);
    expect(gradeSheetAnswer(g.exercise, g.key, JSON.stringify({ ...solution.cells, F6: "=1" }))).toBe(false);
    expect(gradeSheetAnswer(g.exercise, g.key, JSON.stringify({ F2: "125.75", F3: "95.67", F4: "64.33", F5: "98.3", F6: "27.45" }))).toBe(false); // typed numbers, no formulas
    expect(gradeSheetAnswer(g.exercise, g.key, "not json")).toBe(false);
    expect(gradeSheetAnswer(g.exercise, g.key, "[]")).toBe(false);
    expect(gradeSheetAnswer(g.exercise, g.key, "x".repeat(5000))).toBe(false);
    expect(gradeSheetAnswer(g.exercise, g.key, undefined)).toBe(false);
  });

  it("EXW-S03 locked cells cannot be changed by the answer", () => {
    const tamper = { ...solution.cells, C2: "9999", A1: "Hacked" };
    expect(gradeSheetAnswer(g.exercise, g.key, JSON.stringify(tamper))).toBe(true); // locked cells are ignored, the sheet still grades on the real data
  });

  it("EXW-S04 gradePlan counts a sheet task like any question and lists its mission as a topic when missed", () => {
    const ok = gradePlan(plan, { "0": JSON.stringify(solution.cells) }, 70);
    expect(ok.passed).toBe(true);
    expect(ok.correct).toBe(1);
    const bad = gradePlan(plan, { "0": "{}" }, 70);
    expect(bad.passed).toBe(false);
    expect(bad.topics).toEqual([{ code: "EX-1xx", title: "AVERAGEIF mission" }]);
  });

  it("EXW-S05 never two sheet tasks from the same exercise; count is capped by the pool", () => {
    const p = buildPlan([], 0, "dup", [item, item], 5);
    expect(p.tasks).toHaveLength(1);
  });
});
