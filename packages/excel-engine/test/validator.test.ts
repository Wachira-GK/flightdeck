import { describe, expect, it } from "vitest";
import {
  buildSubmission,
  checkExercise,
  matchesExpected,
  MAX_SUBMISSION_BYTES,
  validateSubmission,
  VALIDATOR_VERSION,
  type ExerciseDefinition,
  type ExerciseKey,
} from "../src";
import exerciseJson from "../../../content/excel/exercises/sum-relative-refs.json";
import keyJson from "../../../content/excel/exercises/sum-relative-refs.key.json";

const exercise = exerciseJson as unknown as ExerciseDefinition;
const key = keyJson as unknown as ExerciseKey;

const SOLVED = { B5: "=SUM(B2:B4)", C5: "=SUM(C2:C4)" };

function sub(cells: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { exerciseId: exercise.id, exerciseVersion: exercise.version, cells, ...extra };
}

describe("validateSubmission: acceptance", () => {
  it("passes a correct submission with score 100", () => {
    const r = validateSubmission(exercise, sub(SOLVED), key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(true);
    expect(r.score).toBe(100);
    expect(r.mode).toBe("graded");
    expect(r.validatorVersion).toBe(VALIDATOR_VERSION);
    expect(r.computed).toEqual({ B5: 358, C5: 287 });
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.checks.map((c) => c.kind)).toEqual(
      expect.arrayContaining(["structure", "formula", "function", "value", "hidden"]),
    );
  });
  it("accepts a raw JSON string body", () => {
    expect(validateSubmission(exercise, JSON.stringify(sub(SOLVED)), key).passed).toBe(true);
  });
  it("accepts lower-case keys and unchanged locked cells", () => {
    const r = validateSubmission(exercise, sub({ b5: "=sum(b2:b4)", C5: "=SUM(C2:C4)", B2: "120", A1: "Month" }), key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(true);
  });
  it("accepts an equivalent formula (=B2+B3+B4) for value checks but requires SUM", () => {
    const r = validateSubmission(exercise, sub({ B5: "=B2+B3+B4", C5: "=SUM(C2:C4)" }), key);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "function:B5:SUM")!.passed).toBe(false);
    expect(r.checks.filter((c) => c.kind === "hidden").every((c) => c.passed)).toBe(true);
  });
  it("is deterministic", () => {
    const a = validateSubmission(exercise, sub({ B5: "=SUM(B2:B3)", C5: "287" }), key);
    const b = validateSubmission(exercise, sub({ B5: "=SUM(B2:B3)", C5: "287" }), key);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("validateSubmission: grading failures", () => {
  it("fails a typed constant instead of a formula (fabricated answer)", () => {
    const r = validateSubmission(exercise, sub({ B5: "358", C5: "287" }), key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(false);
    // The visible values match, but formula checks and every hidden test fail.
    expect(r.checks.filter((c) => c.kind === "value").every((c) => c.passed)).toBe(true);
    expect(r.checks.filter((c) => c.kind === "formula").every((c) => !c.passed)).toBe(true);
    expect(r.checks.filter((c) => c.kind === "hidden").every((c) => !c.passed)).toBe(true);
    expect(r.score).toBeLessThan(50);
  });
  it("fails a formula that hard-codes the numbers (=120+95+143)", () => {
    const r = validateSubmission(exercise, sub({ B5: "=SUM(120,95,143)", C5: "=SUM(80,110,97)" }), key);
    expect(r.passed).toBe(false);
    expect(r.checks.filter((c) => c.kind === "hidden").every((c) => !c.passed)).toBe(true);
  });
  it("never trusts client-computed values or verdicts", () => {
    const r = validateSubmission(
      exercise,
      sub({ B5: "=SUM(B2:B3)", C5: "" }, { passed: true, score: 100, values: { B5: 358, C5: 287 } }),
      key,
    );
    expect(r.passed).toBe(false);
    expect(r.computed).toEqual({ B5: 215, C5: null });
  });
  it("partial credit is a weighted score", () => {
    const r = validateSubmission(exercise, sub({ B5: "=SUM(B2:B4)", C5: "" }), key);
    expect(r.passed).toBe(false);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });
  it("formula errors fail with the error shown, not a crash", () => {
    const r = validateSubmission(exercise, sub({ B5: "=SUM(B2:B4", C5: "=B2/0" }), key);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "value:north-total")!.message).toMatch(/#ERROR!/);
    expect(r.checks.find((c) => c.id === "value:south-total")!.message).toMatch(/#DIV\/0!/);
  });
  it("learner-facing messages do not leak expected values or hidden inputs", () => {
    const r = validateSubmission(exercise, sub({ B5: "1", C5: "2" }), key);
    const text = r.checks.map((c) => c.message).join(" ");
    for (const secret of ["358", "287", "260", "215", "190", "200"]) expect(text).not.toContain(secret);
  });
  it("a circular formula fails cleanly", () => {
    const r = validateSubmission(exercise, sub({ B5: "=SUM(B2:B5)", C5: "=SUM(C2:C4)" }), key);
    expect(r.passed).toBe(false);
    expect(r.computed.B5).toMatchObject({ error: "#CIRC!" });
  });
});

describe("validateSubmission: rejection", () => {
  it("rejects a submission over 256 KB (object and raw string)", () => {
    const big = "x".repeat(MAX_SUBMISSION_BYTES);
    const r1 = validateSubmission(exercise, sub({ B5: big }), key);
    expect(r1.rejected?.code).toBe("too_large");
    expect(r1.passed).toBe(false);
    expect(r1.score).toBe(0);
    const r2 = validateSubmission(exercise, JSON.stringify(sub({ B5: big })), key);
    expect(r2.rejected?.code).toBe("too_large");
    // Multi-byte characters are counted as UTF-8 bytes.
    const r3 = validateSubmission(exercise, sub({ B5: "€".repeat(90_000) }), key);
    expect(r3.rejected?.code).toBe("too_large");
  });
  it("rejects malformed payloads", () => {
    expect(validateSubmission(exercise, "{not json", key).rejected?.code).toBe("malformed");
    expect(validateSubmission(exercise, null, key).rejected?.code).toBe("malformed");
    expect(validateSubmission(exercise, [1, 2], key).rejected?.code).toBe("malformed");
    expect(validateSubmission(exercise, undefined, key).rejected?.code).toBe("malformed");
    expect(validateSubmission(exercise, sub(["=1"] as unknown as Record<string, unknown>), key).rejected?.code).toBe("malformed");
    expect(validateSubmission(exercise, sub({ B5: 358 }), key).rejected?.code).toBe("malformed");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(validateSubmission(exercise, circular, key).rejected?.code).toBe("malformed");
  });
  it("rejects a different exercise or version", () => {
    expect(validateSubmission(exercise, { ...sub(SOLVED), exerciseId: "other" }, key).rejected?.code).toBe("wrong_exercise");
    expect(validateSubmission(exercise, { ...sub(SOLVED), exerciseVersion: 2 }, key).rejected?.code).toBe("wrong_exercise");
  });
  it("rejects cells outside the grid", () => {
    expect(validateSubmission(exercise, sub({ ...SOLVED, D1: "1" }), key).rejected?.code).toBe("outside_grid");
    expect(validateSubmission(exercise, sub({ ...SOLVED, A6: "1" }), key).rejected?.code).toBe("outside_grid");
    expect(validateSubmission(exercise, sub({ ...SOLVED, ZZZ999: "1" }), key).rejected?.code).toBe("outside_grid");
  });
  it("rejects invalid or duplicate cell keys", () => {
    for (const bad of ["$B$5", "B0", "hello", "", "B5 ", "__proto__"]) {
      expect(validateSubmission(exercise, sub({ [bad]: "1" }), key).rejected?.code).toBe("invalid_ref");
    }
    expect(validateSubmission(exercise, sub({ b5: "1", B5: "2" }), key).rejected?.code).toBe("malformed");
  });
  it("rejects edits to non-editable cells (tampered starter data)", () => {
    const r = validateSubmission(exercise, sub({ ...SOLVED, B2: "1000" }), key);
    expect(r.rejected?.code).toBe("locked_cell");
    expect(r.rejected?.message).toMatch(/B2 is locked/);
    expect(validateSubmission(exercise, sub({ ...SOLVED, A1: "" }), key).rejected?.code).toBe("locked_cell");
    expect(validateSubmission(exercise, sub({ ...SOLVED, B1: "=1" }), key).rejected?.code).toBe("locked_cell");
  });
  it("rejects functions outside the exercise allow-list", () => {
    const r1 = validateSubmission(exercise, sub({ B5: "=XLOOKUP(1,A1:A4,B1:B4)", C5: "" }), key);
    expect(r1.rejected?.code).toBe("disallowed_function");
    const r2 = validateSubmission(exercise, sub({ B5: "=AVERAGE(B2:B4)*3", C5: "" }), key);
    expect(r2.rejected?.code).toBe("disallowed_function");
    expect(r2.rejected?.message).toMatch(/AVERAGE/);
    const r3 = validateSubmission(exercise, sub({ B5: "=sum(B2:B4)+if(1,0,0)", C5: "" }), key);
    expect(r3.rejected?.code).toBe("disallowed_function");
  });
  it("rejects syntax outside the supported subset", () => {
    expect(validateSubmission(exercise, sub({ B5: "=Sheet2!B2", C5: "" }), key).rejected?.code).toBe("unsupported_formula");
    expect(validateSubmission(exercise, sub({ B5: "={1,2}", C5: "" }), key).rejected?.code).toBe("unsupported_formula");
  });
  it("rejects an invalid exercise or mismatched key", () => {
    const badKey = { ...key, exerciseVersion: 99 };
    expect(validateSubmission(exercise, sub(SOLVED), badKey).rejected?.code).toBe("invalid_exercise");
  });
});

describe("structure-only practice mode (no answer key)", () => {
  it("checks that editable cells are filled and compute", () => {
    const ok = validateSubmission(exercise, sub(SOLVED));
    expect(ok.mode).toBe("structure-only");
    expect(ok.passed).toBe(true);
    const bad = validateSubmission(exercise, sub({ B5: "=1/0", C5: "" }));
    expect(bad.passed).toBe(false);
    expect(bad.checks.find((c) => c.id === "filled:B5")!.message).toMatch(/#DIV\/0!/);
    expect(bad.checks.find((c) => c.id === "filled:C5")!.message).toMatch(/empty/);
  });
  it("still rejects tampering", () => {
    expect(validateSubmission(exercise, sub({ B2: "0" })).rejected?.code).toBe("locked_cell");
  });
});

describe("helpers", () => {
  it("buildSubmission includes editable cells only", () => {
    const s = buildSubmission(exercise, { ...exercise.starter, B5: "=SUM(B2:B4)", B2: "999" });
    expect(s).toEqual({ exerciseId: "sum-relative-refs", exerciseVersion: 1, cells: { B5: "=SUM(B2:B4)", C5: "" } });
  });
  it("matchesExpected handles tolerance, case and errors", () => {
    expect(matchesExpected(0.1 + 0.2, 0.3)).toBe(true);
    expect(matchesExpected(0.31, 0.3)).toBe(false);
    expect(matchesExpected(1e12 + 0.0001, 1e12)).toBe(true);
    expect(matchesExpected("reorder ", "Reorder")).toBe(true);
    expect(matchesExpected("reorder", "Reorder", { caseSensitive: true })).toBe(false);
    expect(matchesExpected(true, true)).toBe(true);
    expect(matchesExpected(1, true)).toBe(false);
    expect(matchesExpected({ error: "#DIV/0!", message: "" }, { error: "#DIV/0!" })).toBe(true);
    expect(matchesExpected("358", 358)).toBe(false);
  });
  it("checkExercise reports problems", () => {
    const bad = {
      ...exercise,
      id: "Bad Id",
      grid: { rows: 200, cols: 3 },
      starter: { b1: "x", Z1: "y" },
      allowedFunctions: ["VLOOKUP"],
      namedRanges: { Sales: "B2:B4" },
    } as unknown as ExerciseDefinition;
    const problems = checkExercise(bad, { ...key, hiddenTests: [{ id: "t", label: "", overrides: { B5: "1" }, expect: {} }] });
    expect(problems.join("\n")).toMatch(/kebab-case/);
    expect(problems.join("\n")).toMatch(/rows out of range/);
    expect(problems.join("\n")).toMatch(/not a canonical/);
    expect(problems.join("\n")).toMatch(/VLOOKUP/);
    expect(problems.join("\n")).toMatch(/namedRanges/);
    expect(problems.join("\n")).toMatch(/overrides editable cell B5/);
  });
});
