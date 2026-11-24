import { describe, expect, it } from "vitest";
import type { ExcelAnswerKeyItem, ExcelAssessmentItem } from "../components/excel/missions";
import { buildPlan, cleanHolder, examCall, gradePlan, integrityFlags, publicView, shuffled, validHolder, type PoolItem } from "./exams";

const mk = (slug: string, n: number): PoolItem[] =>
  Array.from({ length: n }, (_, i) => {
    const choice = i % 2 === 0;
    const item: ExcelAssessmentItem = choice
      ? { id: `${slug}-q${i}`, type: "single-choice", prompt: `Pick in ${slug} #${i}`, options: ["a", "b", "c", "d"].map((o) => ({ id: o, label: `Option ${o}` })) }
      : { id: `${slug}-q${i}`, type: "numeric", prompt: `Compute ${slug} #${i}`, answerHint: "Use SUM" };
    const key: ExcelAnswerKeyItem = choice
      ? { id: item.id, type: "single-choice", correctOptionId: "b", rationale: "SECRET-RATIONALE" }
      : { id: item.id, type: "numeric", expected: 42, tolerance: { kind: "absolute", value: 0.5 }, rationale: "SECRET-RATIONALE" };
    return { slug, code: `EX-${slug}`, title: `Mission ${slug}`, item, key };
  });
const pool = [...mk("101", 4), ...mk("102", 4), ...mk("103", 4)];

describe("exam plans and grading", () => {
  it("EXW-01 same seed gives the same plan; a new seed gives a different one", () => {
    const a = buildPlan(pool, 6, "s1");
    expect(buildPlan(pool, 6, "s1")).toEqual(a);
    const ids = (p: typeof a) => p.tasks.map((t) => t.itemId).join(",");
    expect(ids(buildPlan(pool, 6, "s2"))).not.toBe(ids(a));
  });

  it("EXW-02 questions are spread over missions and never repeated", () => {
    const p = buildPlan(pool, 6, "spread");
    expect(new Set(p.tasks.map((t) => t.itemId)).size).toBe(6);
    expect(new Set(p.tasks.map((t) => t.slug)).size).toBe(3);
    expect(buildPlan(pool, 99, "all").tasks).toHaveLength(pool.length);
  });

  it("EXW-03 the browser view has no key, rationale, code or title, and hints only once paid for", () => {
    const p = buildPlan(pool, 6, "view");
    const none = JSON.stringify(publicView(p, []));
    for (const bad of ["SECRET-RATIONALE", "correctOptionId", "expected", "EX-10", "Mission 10", "Use SUM", "dropOptions"]) expect(none).not.toContain(bad);
    const withHint = publicView(p, [{ task: 0, hint: 0 }]);
    expect(withHint[0]!.hint).toBeDefined();
    expect(withHint[1]!.hint).toBeUndefined();
  });

  it("EXW-04 grading: correct, wrong, blank and numeric tolerance; failed attempts list topics only", () => {
    const p = buildPlan(pool, 4, "grade");
    const right: Record<string, string> = {};
    p.tasks.forEach((t, i) => { right[String(i)] = "correctOptionId" in t.key ? t.key.correctOptionId : "42.2"; });
    expect(gradePlan(p, right, 70)).toMatchObject({ passed: true, score: 100, correct: 4, total: 4, topics: [] });
    const half = { ...right, "0": "zzz", "1": "" };
    const r = gradePlan(p, half, 70);
    expect(r).toMatchObject({ passed: false, correct: 2 });
    expect(r.topics.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain("SECRET-RATIONALE");
    expect(gradePlan(p, { __proto__: "b", constructor: "b" } as never, 70).correct).toBe(0);
  });

  it("EXW-05 a single-choice hint removes two wrong options and never the right one", () => {
    const p = buildPlan(mk("101", 6), 6, "hint");
    for (const t of p.tasks.filter((x) => x.type === "single-choice")) {
      expect(t.dropOptions).toHaveLength(2);
      expect(t.dropOptions).not.toContain((t.key as { correctOptionId: string }).correctOptionId);
    }
  });

  it("EXW-06 holder name is cleaned; flags are soft and clamped", () => {
    expect(cleanHolder("  Ada   <b>Lovelace</b>  ")).toBe("Ada bLovelaceb");
    expect(validHolder("A")).toBe(false);
    expect(validHolder("Wanjiru Kamau")).toBe(true);
    expect(integrityFlags({ seconds: 10, limitSeconds: 1800, blurs: 50, pastes: 9, total: 10 })).toMatchObject({ veryFast: true, manyTabSwitches: true, manyPastes: true });
    expect(integrityFlags({ seconds: 900, limitSeconds: 1800, blurs: "x", pastes: -4, total: 10 })).toEqual({ seconds: 900, blurs: 0, pastes: 0 });
  });

  it("EXW-07 shuffled keeps every item; database failure never leaks the host", async () => {
    expect([...shuffled([1, 2, 3, 4], "x")].sort()).toEqual([1, 2, 3, 4]);
    const cfg = { url: "https://secret-host.example", serviceKey: "k", fetch: (async () => { throw new Error("boom secret-host.example"); }) as unknown as typeof fetch };
    const r = await examCall(cfg, "fd_exam_state", {});
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(await examCall(null, "x", {})).toEqual({ ok: false, reason: "not_configured" });
  });
});
