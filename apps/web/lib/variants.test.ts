import { describe, expect, it } from "vitest";
import { checkVariant, parseVariantParams, renderVariant, type NumericVariant } from "./variants";

const good: NumericVariant = {
  template: "A shop sells {a} pairs at {b} each and gives {c} percent off the total. What is the final amount?",
  params: { a: { min: 10, max: 60, step: 5 }, b: { min: 100, max: 500, step: 25 }, c: { min: 5, max: 20, step: 5 } },
  formula: "={a}*{b}*(1-{c}/100)",
};

describe("VAR numeric exam variants (stage 3g)", () => {
  it("VAR-01 the same seed gives the same numbers; another seed gives different ones; the answer comes from the formula", () => {
    const a = renderVariant(good, "s1");
    expect(renderVariant(good, "s1")).toEqual(a);
    const seen = new Set(Array.from({ length: 12 }, (_, i) => renderVariant(good, `x${i}`).prompt));
    expect(seen.size).toBeGreaterThan(6);
    const { a: pa, b: pb, c: pc } = a.values;
    expect(a.expected).toBeCloseTo(pa! * pb! * (1 - pc! / 100), 9);
    expect(a.prompt).toContain(String(pa));
    expect(a.prompt).not.toContain("{");
  });

  it("VAR-02 values stay inside their range and on their step", () => {
    for (let i = 0; i < 100; i++) {
      const { values } = renderVariant(good, `r${i}`);
      for (const [n, p] of Object.entries(good.params)) {
        expect(values[n]).toBeGreaterThanOrEqual(p.min);
        expect(values[n]).toBeLessThanOrEqual(p.max);
        expect((values[n]! - p.min) % p.step).toBe(0);
      }
    }
  });

  it("VAR-03 decimals step cleanly and negatives are bracketed in the formula", () => {
    const v: NumericVariant = { template: "x is {x}, y is {y}", params: { x: { min: 0.5, max: 2.5, step: 0.5 }, y: { min: -5, max: -1, step: 1 } }, formula: "={x}-{y}" };
    for (let i = 0; i < 30; i++) {
      const r = renderVariant(v, `d${i}`);
      expect(r.expected).toBeCloseTo(r.values.x! - r.values.y!, 9);
      expect(Number.isInteger(r.values.x! * 2)).toBe(true);
    }
  });

  it("VAR-04 the 20-variant author check passes a good variant", () => {
    expect(checkVariant(good, "q1")).toEqual([]);
  });

  it("VAR-05 the author check catches the usual mistakes in plain words", () => {
    expect(checkVariant({ ...good, params: {} }, "q1")[0]).toContain("at least one number");
    expect(checkVariant({ ...good, template: "" }, "q1")[0]).toContain("exam wording");
    expect(checkVariant({ ...good, template: "Pairs {a} at {b}. Total?" }, "q1").join(" ")).toContain("{c} is not in the question wording");
    expect(checkVariant({ ...good, formula: "={a}*{b}" }, "q1").join(" ")).toContain("{c} is not in the answer formula");
    expect(checkVariant({ ...good, template: good.template + " {z}" }, "q1").join(" ")).toContain("{z} is used but has no range");
    expect(checkVariant({ template: "n {n}", params: { n: { min: 0, max: 3, step: 1 } }, formula: "={n}+1" }, "q1").join(" ")).toContain("only 4 different versions");
    expect(checkVariant({ template: "{n} and {m}", params: { n: { min: 1, max: 2, step: 1 }, m: { min: 1, max: 1.5, step: 0.5 } }, formula: "={n}*{m}" }, "q1").join(" ")).toContain("different versions");
    expect(checkVariant({ template: "a {n}", params: { n: { min: 1, max: 100, step: 1 } }, formula: "=1/({n}-{n})" }, "q1").join(" ")).toContain("cannot be worked out");
    expect(checkVariant({ template: "a {n}", params: { n: { min: 1, max: 100, step: 1 } }, formula: "=ROUND({n}/1000,0)" }, "q1").join(" ")).toContain("hardly changes");
    expect(checkVariant({ template: "a {n}", params: { n: { min: 1, max: 100, step: 1 } }, formula: "=NOSUCHFUNCTION({n})" }, "q1").join(" ")).toContain("cannot be worked out");
  });

  it("VAR-06 parameter lines are parsed strictly", () => {
    const ok = parseVariantParams("a: 100-500 step 10\nb = 1.5 to 4.5 step 0.5\n\nc: -5..5");
    expect(ok.errors).toEqual([]);
    expect(ok.params).toEqual({ a: { min: 100, max: 500, step: 10 }, b: { min: 1.5, max: 4.5, step: 0.5 }, c: { min: -5, max: 5, step: 1 } });
    for (const bad of ["a 100-500", "a: 500-100", "a: 1-5 step 0", "a: 1-5\na: 2-6", "9a: 1-5", "a: 0-100000000000 step 0.0001"]) expect(parseVariantParams(bad).errors.length).toBeGreaterThan(0);
  });

  it("VAR-07 a non-numeric or error answer is refused, never graded", () => {
    expect(() => renderVariant({ template: "{n}", params: { n: { min: 1, max: 2, step: 1 } }, formula: "=\"text\"&{n}" }, "t")).toThrow();
    expect(() => renderVariant({ template: "{n}", params: { n: { min: 1, max: 2, step: 1 } }, formula: "{n}+1" }, "t")).toThrow("must start with =");
  });
});
