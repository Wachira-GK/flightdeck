import { describe, expect, it } from "vitest";
import {
  buildSubmission,
  checkExercise,
  validateSubmission,
  type ExerciseDefinition,
  type ExerciseKey,
  type FunctionName,
  type ExpectedValue,
} from "../src";

const STARTER = {
  A1: "10",
  A2: "20",
  A3: "30",
  A4: "40",
  B1: "Ab",
  B2: "b",
  B3: "ab",
  B4: " Hi  there ",
};

interface Case {
  fn: FunctionName;
  formula: string;
  expected: ExpectedValue;
  caseSensitive?: boolean;
  /** Locked-cell overrides for the hidden test and the value they must produce. */
  override: Record<string, string>;
  hidden: ExpectedValue;
  /** A wrong formula that must fail. */
  wrong: string;
}

const CASES: Case[] = [
  { fn: "ROUND", formula: "=ROUND(A1/3,1)", expected: 3.3, override: { A1: "20" }, hidden: 6.7, wrong: "=ROUND(A1/3,0)" },
  { fn: "ABS", formula: "=ABS(A1-A4)", expected: 30, override: { A1: "100" }, hidden: 60, wrong: "=A4-A1" },
  { fn: "AND", formula: "=AND(A1>5,A4<50)", expected: true, override: { A1: "1" }, hidden: false, wrong: "=OR(A1>5,A4<50)" },
  { fn: "OR", formula: "=OR(A1>50,A4>50)", expected: false, override: { A4: "60" }, hidden: true, wrong: "=AND(A1>50,A4>50)" },
  { fn: "NOT", formula: "=NOT(A1>50)", expected: true, override: { A1: "60" }, hidden: false, wrong: "=A1>50" },
  {
    fn: "IFERROR",
    formula: '=IFERROR(A1/(A2-20),"none")',
    expected: "none",
    override: { A2: "30" },
    hidden: -1 + 2, // 10 / 10
    wrong: "=A1/(A2-20)",
  },
  { fn: "MEDIAN", formula: "=MEDIAN(A1:A4)", expected: 25, override: { A1: "100" }, hidden: 35, wrong: "=AVERAGE(A1:A4)" },
  { fn: "SUMIF", formula: '=SUMIF(B1:B4,"ab",A1:A4)', expected: 40, override: { A1: "15" }, hidden: 45, wrong: "=A1+A3" },
  { fn: "COUNTIF", formula: '=COUNTIF(A1:A4,">=20")', expected: 3, override: { A1: "25" }, hidden: 4, wrong: "=3" },
  { fn: "AVERAGEIF", formula: '=AVERAGEIF(A1:A4,">15")', expected: 30, override: { A1: "50" }, hidden: 35, wrong: "=30" },
  {
    fn: "SUMIFS",
    formula: '=SUMIFS(A1:A4,A1:A4,">=20",B1:B4,"<>b")',
    expected: 70,
    override: { A4: "1" },
    hidden: 30,
    wrong: '=SUMIF(A1:A4,">=20",A1:A4)',
  },
  {
    fn: "COUNTIFS",
    formula: '=COUNTIFS(A1:A4,">=20",B1:B4,"<>b")',
    expected: 2,
    override: { A4: "1" },
    hidden: 1,
    wrong: '=COUNTIF(A1:A4,">=20")',
  },
  { fn: "LEN", formula: "=LEN(B4)", expected: 11, override: { B4: "abc" }, hidden: 3, wrong: "=11" },
  { fn: "LEFT", formula: "=LEFT(B1,A1/10)", expected: "A", caseSensitive: true, override: { A1: "20" }, hidden: "Ab", wrong: '="A"' },
  { fn: "RIGHT", formula: "=RIGHT(B3,1)", expected: "b", caseSensitive: true, override: { B3: "xyz" }, hidden: "z", wrong: '="b"' },
  { fn: "UPPER", formula: "=UPPER(B3)", expected: "AB", caseSensitive: true, override: { B3: "q" }, hidden: "Q", wrong: "=B3" },
  { fn: "LOWER", formula: "=LOWER(B1)", expected: "ab", caseSensitive: true, override: { B1: "XY" }, hidden: "xy", wrong: "=B1" },
  { fn: "TRIM", formula: "=TRIM(B4)", expected: "Hi there", caseSensitive: true, override: { B4: "  a   b " }, hidden: "a b", wrong: "=B4" },
];

function exerciseFor(c: Case, allowed: FunctionName[] = [c.fn]): { ex: ExerciseDefinition; key: ExerciseKey } {
  const id = `new-fn-${c.fn.toLowerCase()}`;
  const ex: ExerciseDefinition = {
    schemaVersion: 1,
    id,
    version: 1,
    title: `${c.fn} practice`,
    objective: `Use ${c.fn}`,
    instructions: `Type a ${c.fn} formula in C1.`,
    grid: { rows: 10, cols: 5 },
    starter: STARTER,
    editableCells: ["C1"],
    allowedFunctions: allowed,
    hints: [],
    namedRanges: {},
  };
  const key: ExerciseKey = {
    schemaVersion: 1,
    exerciseId: id,
    exerciseVersion: 1,
    expected: [{ id: "c1", cell: "C1", value: c.expected, label: "C1 result", caseSensitive: c.caseSensitive }],
    requireFormula: ["C1"],
    requireFunctions: { C1: [c.fn] },
    hiddenTests: [
      { id: "h1", overrides: c.override, expect: { C1: c.hidden }, label: "changed inputs", caseSensitive: c.caseSensitive },
    ],
  };
  return { ex, key };
}

describe("validateSubmission with each new function", () => {
  for (const c of CASES) {
    describe(c.fn, () => {
      const { ex, key } = exerciseFor(c);
      it("is a valid exercise definition and key", () => {
        expect(checkExercise(ex, key)).toEqual([]);
      });
      it("passes the correct formula (value, formula, function and hidden test)", () => {
        const r = validateSubmission(ex, buildSubmission(ex, { C1: c.formula }), key);
        expect(r.rejected).toBeUndefined();
        expect(r.checks.filter((x) => !x.passed)).toEqual([]);
        expect(r.passed).toBe(true);
        expect(r.score).toBe(100);
        expect(r.mode).toBe("graded");
      });
      it("fails a typed constant and a wrong formula", () => {
        const typed = validateSubmission(ex, buildSubmission(ex, { C1: String(c.expected) }), key);
        expect(typed.passed).toBe(false);
        const wrong = validateSubmission(ex, buildSubmission(ex, { C1: c.wrong }), key);
        expect(wrong.passed).toBe(false);
      });
      it("is rejected as disallowed_function when the exercise does not allow it", () => {
        const other = exerciseFor(c, ["SUM"]);
        const r = validateSubmission(other.ex, buildSubmission(other.ex, { C1: c.formula }), undefined);
        expect(r.rejected?.code).toBe("disallowed_function");
      });
      it("practice mode (no key) checks that the cell calculates without errors", () => {
        const r = validateSubmission(ex, buildSubmission(ex, { C1: c.formula }));
        expect(r.mode).toBe("structure-only");
        expect(r.passed).toBe(true);
        expect(r.computed.C1).toEqual(c.expected);
      });
    });
  }

  it("rejects requireFunctions that are not in allowedFunctions", () => {
    const { ex, key } = exerciseFor(CASES[0]!);
    const bad: ExerciseKey = { ...key, requireFunctions: { C1: ["MEDIAN"] } };
    expect(checkExercise(ex, bad)).toContain("requireFunctions MEDIAN is not allowed");
  });

  it("rejects unknown function names in allowedFunctions", () => {
    const { ex } = exerciseFor(CASES[0]!);
    const bad = { ...ex, allowedFunctions: ["ROUND", "VLOOKUP"] as unknown as FunctionName[] };
    expect(checkExercise(bad).join(" ")).toContain("unsupported VLOOKUP");
  });

  it("lets one exercise combine several new functions", () => {
    const ex: ExerciseDefinition = {
      ...exerciseFor(CASES[0]!).ex,
      id: "combo",
      allowedFunctions: ["IFERROR", "ROUND", "AVERAGEIF"],
    };
    const key: ExerciseKey = {
      schemaVersion: 1,
      exerciseId: "combo",
      exerciseVersion: 1,
      expected: [{ id: "c1", cell: "C1", value: "n/a", label: "C1" }],
      requireFormula: ["C1"],
      requireFunctions: { C1: ["IFERROR", "ROUND", "AVERAGEIF"] },
      hiddenTests: [{ id: "h", overrides: { A1: "0", A2: "0" }, expect: { C1: "n/a" }, label: "nothing matches" }],
    };
    const f = '=IFERROR(ROUND(AVERAGEIF(A1:A4,">100"),1),"n/a")';
    const r = validateSubmission(ex, buildSubmission(ex, { C1: f }), key);
    expect(r.rejected).toBeUndefined();
    expect(r.passed).toBe(true);
  });
});
