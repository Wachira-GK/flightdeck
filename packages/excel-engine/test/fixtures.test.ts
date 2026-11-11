import { describe, expect, it } from "vitest";
import {
  checkExercise,
  evaluateSheet,
  exerciseLimits,
  validateSubmission,
  type ExerciseDefinition,
  type ExerciseKey,
} from "../src";
import sumEx from "../../../content/excel/exercises/sum-relative-refs.json";
import sumKey from "../../../content/excel/exercises/sum-relative-refs.key.json";
import ifEx from "../../../content/excel/exercises/if-business-thresholds.json";
import ifKey from "../../../content/excel/exercises/if-business-thresholds.key.json";
import tierEx from "../../../content/excel/exercises/commission-tier-if-chain.json";
import tierKey from "../../../content/excel/exercises/commission-tier-if-chain.key.json";
import xlpEx from "../../../content/excel/exercises/xlookup-price-list.json";
import xlpKey from "../../../content/excel/exercises/xlookup-price-list.key.json";

interface Fixture {
  exercise: ExerciseDefinition;
  key: ExerciseKey;
  solution: Record<string, string>;
  /** Wrong attempts that must not pass. */
  wrong: Record<string, Record<string, string>>;
}

const rows = (cells: string[], f: (r: number) => string) => Object.fromEntries(cells.map((c) => [c, f(Number(c.slice(1)))]));

const FIXTURES: Fixture[] = [
  {
    exercise: sumEx as unknown as ExerciseDefinition,
    key: sumKey as unknown as ExerciseKey,
    solution: { B5: "=SUM(B2:B4)", C5: "=SUM(C2:C4)" },
    wrong: {
      empty: {},
      "typed constants": { B5: "358", C5: "287" },
      "range too short": { B5: "=SUM(B2:B3)", C5: "=SUM(C2:C3)" },
      "pattern not shifted": { B5: "=SUM(B2:B4)", C5: "=SUM(B2:B4)" },
      "hard-coded numbers": { B5: "=SUM(120,95,143)", C5: "=SUM(80,110,97)" },
    },
  },
  {
    exercise: ifEx as unknown as ExerciseDefinition,
    key: ifKey as unknown as ExerciseKey,
    solution: rows(["D2", "D3", "D4", "D5"], (r) => `=IF(B${r}<=C${r},"Reorder","OK")`),
    wrong: {
      empty: {},
      "typed constants": { D2: "OK", D3: "Reorder", D4: "Reorder", D5: "Reorder" },
      "< instead of <= (boundary)": rows(["D2", "D3", "D4", "D5"], (r) => `=IF(B${r}<C${r},"Reorder","OK")`),
      "fixed threshold instead of the reorder point": rows(["D2", "D3", "D4", "D5"], (r) => `=IF(B${r}<=30,"Reorder","OK")`),
      "missing quotes": rows(["D2", "D3", "D4", "D5"], (r) => `=IF(B${r}<=C${r},Reorder,OK)`),
    },
  },
  {
    exercise: tierEx as unknown as ExerciseDefinition,
    key: tierKey as unknown as ExerciseKey,
    solution: rows(["C2", "C3", "C4", "C5"], (r) => `=IF(B${r}>=$F$4,$G$4,IF(B${r}>=$F$3,$G$3,$G$2))`),
    wrong: {
      empty: {},
      "typed constants": { C2: "2%", C3: "4%", C4: "4%", C5: "6%" },
      "typed rates instead of table refs": rows(
        ["C2", "C3", "C4", "C5"],
        (r) => `=IF(B${r}>=100000,6%,IF(B${r}>=50000,4%,2%))`,
      ),
      "wrong tier order": rows(["C2", "C3", "C4", "C5"], (r) => `=IF(B${r}>=$F$3,$G$3,IF(B${r}>=$F$4,$G$4,$G$2))`),
      "relative refs drift": rows(["C2", "C3", "C4", "C5"], (r) => `=IF(B${r}>=F${r + 2},G${r + 2},IF(B${r}>=F${r + 1},G${r + 1},G${r}))`),
    },
  },
  {
    exercise: xlpEx as unknown as ExerciseDefinition,
    key: xlpKey as unknown as ExerciseKey,
    solution: rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},$E$2:$E$6,$G$2:$G$6,"Not listed")`),
    wrong: {
      empty: {},
      "typed constants": { C2: "2499", C3: "1999", C4: "899", C5: "Not listed" },
      "positional refs instead of a lookup": { C2: "=XLOOKUP(B2,B2,$G$2)", C3: "=XLOOKUP(B3,B3,$G$3)", C4: "=XLOOKUP(B4,B4,$G$4)", C5: '=XLOOKUP(B5,$E$2:$E$6,$G$2:$G$6,"Not listed")' },
      "no if_not_found (#N/A)": rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},$E$2:$E$6,$G$2:$G$6)`),
      "price list missing its last row": rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},$E$2:$E$5,$G$2:$G$5,"Not listed")`),
      "relative refs drift": rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},E${r}:E${r + 4},G${r}:G${r + 4},"Not listed")`),
      "returns the product name": rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},$E$2:$E$6,$F$2:$F$6,"Not listed")`),
      "hard-coded lookup values": {
        C2: '=XLOOKUP("SS-210",$E$2:$E$6,$G$2:$G$6,"Not listed")',
        C3: '=XLOOKUP("SN-450",$E$2:$E$6,$G$2:$G$6,"Not listed")',
        C4: '=XLOOKUP("SD-120",$E$2:$E$6,$G$2:$G$6,"Not listed")',
        C5: '=XLOOKUP("GB-610",$E$2:$E$6,$G$2:$G$6,"Not listed")',
      },
    },
  },
];

describe.each(FIXTURES)("exercise $exercise.id", ({ exercise, key, solution, wrong }) => {
  const sub = (cells: Record<string, string>) => ({ exerciseId: exercise.id, exerciseVersion: exercise.version, cells });

  it("definition and key are valid", () => {
    expect(checkExercise(exercise, key)).toEqual([]);
  });

  it("learner-safe JSON contains no answers", () => {
    const text = JSON.stringify(exercise);
    expect(text).not.toMatch(/"expected"|"hiddenTests"|"requireFormula"/);
    for (const v of Object.values(solution)) expect(text).not.toContain(v);
  });

  it("starter sheet evaluates without errors", () => {
    const values = evaluateSheet(exercise.starter, exerciseLimits(exercise));
    for (const v of Object.values(values)) expect(typeof v === "object" && v !== null).toBe(false);
  });

  it("solved: passes with 100", () => {
    const r = validateSubmission(exercise, sub(solution), key);
    expect(r.rejected).toBeUndefined();
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.score).toBe(100);
  });

  it.each(Object.entries(wrong))("unsolved (%s): does not pass", (_name, cells) => {
    const r = validateSubmission(exercise, sub(cells), key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(100);
  });

  it("tampering with a locked input is rejected", () => {
    const locked = Object.keys(exercise.starter).find((k) => !exercise.editableCells.includes(k))!;
    const r = validateSubmission(exercise, sub({ ...solution, [locked]: "12345" }), key);
    expect(r.rejected?.code).toBe("locked_cell");
  });
});

describe("xlookup-price-list", () => {
  const ex = xlpEx as unknown as ExerciseDefinition;
  const key = xlpKey as unknown as ExerciseKey;
  it("rejects approximate-match arguments as a learner mistake, not a crash", () => {
    const cells = rows(["C2", "C3", "C4", "C5"], (r) => `=XLOOKUP(B${r},$E$2:$E$6,$G$2:$G$6,"Not listed",-1)`);
    const r = validateSubmission(ex, { exerciseId: ex.id, exerciseVersion: ex.version, cells }, key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "value:line-1")?.message).toMatch(/#VALUE!.*exact match only/);
  });
  it("rejects IF (not in this exercise's allow-list)", () => {
    const r = validateSubmission(ex, { exerciseId: ex.id, exerciseVersion: ex.version, cells: { C2: '=IF(B2="SS-210",$G$2,0)' } }, key);
    expect(r.rejected?.code).toBe("disallowed_function");
  });
  it("check messages never reveal expected prices or hidden inputs", () => {
    const r = validateSubmission(ex, { exerciseId: ex.id, exerciseVersion: ex.version, cells: { C2: "1" } }, key);
    const text = JSON.stringify(r.checks);
    for (const secret of ["2699", "2149", "949", "1299", "4599", "GB-610", "XX-000", "Gumboot"]) expect(text).not.toContain(secret);
  });
});

describe("lookup substitute", () => {
  it("XLOOKUP is rejected for the tier exercise (not in its allow-list)", () => {
    const ex = tierEx as unknown as ExerciseDefinition;
    const r = validateSubmission(
      ex,
      { exerciseId: ex.id, exerciseVersion: ex.version, cells: { C2: "=XLOOKUP(B2,$F$2:$F$4,$G$2:$G$4,,-1)" } },
      tierKey as unknown as ExerciseKey,
    );
    expect(r.rejected?.code).toBe("disallowed_function");
  });
});
