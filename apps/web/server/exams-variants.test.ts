import { describe, expect, it } from "vitest";
import type { ExcelAnswerKeyItem, ExcelAssessmentItem } from "../components/excel/missions";
import { blankDoc, PLACEHOLDER, type EditorDoc } from "../lib/author/doc";
import { buildContent } from "./author/convert";
import { buildPlan, gradePlan, publicView, type PoolItem } from "./exams";

const item: ExcelAssessmentItem = { id: "q1", type: "numeric", prompt: "Static practice question" };
const key: ExcelAnswerKeyItem = {
  id: "q1",
  type: "numeric",
  expected: 1,
  tolerance: { kind: "absolute", value: 0.01 },
  rationale: "SECRET-RATIONALE",
  variant: { template: "Sell {a} pairs at {b} each. Total?", params: { a: { min: 10, max: 90, step: 10 }, b: { min: 100, max: 900, step: 50 } }, formula: "={a}*{b}" },
};
const pool: PoolItem[] = [{ slug: "m1", code: "EX-1", title: "M1", item, key }];

describe("exam variants in plans (EXW-V)", () => {
  it("EXW-V01 each attempt (seed) draws different numbers; the same seed repeats; practice text is never used in the exam", () => {
    const seeds = Array.from({ length: 8 }, (_, i) => buildPlan(pool, 1, `attempt-${i}`));
    expect(new Set(seeds.map((p) => p.tasks[0]!.prompt)).size).toBeGreaterThan(4);
    expect(buildPlan(pool, 1, "attempt-3")).toEqual(seeds[3]);
    expect(seeds.every((p) => !p.tasks[0]!.prompt.includes("Static practice") && !p.tasks[0]!.prompt.includes("{"))).toBe(true);
  });

  it("EXW-V02 the answer key follows the numbers the learner was shown", () => {
    const p = buildPlan(pool, 1, "grading");
    const nums = [...p.tasks[0]!.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
    const right = String(nums[0]! * nums[1]!);
    expect(gradePlan(p, { "0": right }, 70).passed).toBe(true);
    expect(gradePlan(p, { "0": "1" }, 70).passed).toBe(false); // the practice answer no longer works
  });

  it("EXW-V03 the browser sees the drawn question only, never the template, ranges or formula", () => {
    const view = JSON.stringify(publicView(buildPlan(pool, 1, "view"), []));
    for (const bad of ["template", "formula", "params", "SECRET-RATIONALE", "step", "={a}"]) expect(view).not.toContain(bad);
  });

  it("EXW-V04 a broken variant falls back to the fixed question instead of failing the exam", () => {
    const broken: PoolItem[] = [{ ...pool[0]!, key: { ...key, variant: { template: "{a}", params: { a: { min: 1, max: 2, step: 1 } }, formula: "=1/0" } } as ExcelAnswerKeyItem }];
    const p = buildPlan(broken, 1, "fallback");
    expect(p.tasks[0]!.prompt).toBe("Static practice question");
  });
});

const filled = (): EditorDoc => JSON.parse(JSON.stringify(blankDoc("excel-demo-902", "EX-902", "Demo variants", "beginner")).split(`${PLACEHOLDER} `).join(""));

describe("author check of exam variants (AUT-V)", () => {
  it("AUT-V01 a good variant is stored in the server key only; the learner document stays clean", () => {
    const d = filled();
    const q = d.questions.find((x) => x.type === "numeric")!;
    Object.assign(q, { variantTemplate: "Sell {a} pairs at {b} each. Total?", variantParams: "a: 10-90 step 10\nb: 100-900 step 50", variantFormula: "={a}*{b}" });
    const r = buildContent(d);
    expect(r.issues).toEqual([]);
    const k = r.keys.items.find((x) => x.id === q.id)!;
    expect(k.type === "numeric" && k.variant?.formula).toBe("={a}*{b}");
    const pub = JSON.stringify({ mission: r.mission, exercise: r.exercise });
    for (const bad of ["={a}*{b}", "Sell {a}", "step 10", "variantFormula"]) expect(pub).not.toContain(bad);
  });

  it("AUT-V02 a bad variant blocks sending for review, with a plain-language reason", () => {
    const d = filled();
    const q = d.questions.find((x) => x.type === "numeric")!;
    Object.assign(q, { variantTemplate: "Sell {a} pairs", variantParams: "a: 10-90 step 10", variantFormula: "=1/({a}-{a})" });
    const r = buildContent(d);
    expect(r.issues.join(" ")).toContain("cannot be worked out");
    Object.assign(q, { variantParams: "a ten to ninety" });
    expect(buildContent(d).issues.join(" ")).toContain("is not understood");
  });
});
