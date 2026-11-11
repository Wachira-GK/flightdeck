import { describe, expect, it } from "vitest";
import ifKeysJson from "../../../content/excel/missions/excel-if-102.keys.json";
import lookupKeysJson from "../../../content/excel/missions/excel-lookup-103.keys.json";
import sumKeysJson from "../../../content/excel/missions/excel-sum-101.keys.json";
import { getExcelMission } from "../components/excel/content";
import type { ExcelMissionKeys } from "../components/excel/missions";
import { gradeExcelAssessment } from "./excel-assessment-grader";

const KEYS: Record<string, ExcelMissionKeys> = {
  "excel-sum-101": sumKeysJson as unknown as ExcelMissionKeys,
  "excel-if-102": ifKeysJson as unknown as ExcelMissionKeys,
  "excel-lookup-103": lookupKeysJson as unknown as ExcelMissionKeys,
};
const SLUGS = Object.keys(KEYS);

/** Every item answered correctly, built from the key (a test may read keys; UI code may not). */
function allCorrect(slug: string): Record<string, string> {
  return Object.fromEntries(KEYS[slug]!.items.map((k) => [k.id, k.type === "numeric" ? String(k.expected) : k.correctOptionId]));
}
/** A wrong answer for one item, whatever its type. */
function wrongFor(slug: string, id: string): string {
  const k = KEYS[slug]!.items.find((i) => i.id === id)!;
  if (k.type === "numeric") return String(k.expected + 1);
  const item = getExcelMission(slug)!.mission.assessment.items.find((i) => i.id === id)!;
  if (item.type !== "single-choice") throw new Error("type mismatch");
  return item.options.find((o) => o.id !== k.correctOptionId)!.id;
}
const grade = (slug: string, answers: Record<string, unknown>) => gradeExcelAssessment(getExcelMission(slug)!.mission, KEYS[slug]!, answers);

describe.each(SLUGS)("gradeExcelAssessment %s", (slug) => {
  const { mission } = getExcelMission(slug)!;
  const ids = mission.assessment.items.map((i) => i.id);

  it("passes with every answer correct and reveals the explanations", () => {
    const r = grade(slug, allCorrect(slug));
    expect(r).toMatchObject({ missionSlug: slug, score: 100, passed: true, passMark: mission.passMark });
    expect(r.items.every((i) => i.status === "correct")).toBe(true);
    for (const k of KEYS[slug]!.items) {
      expect(r.items.find((i) => i.id === k.id)?.feedback).toContain(k.rationale);
    }
  });

  it("takes the pass mark from the mission JSON (3 of 4 correct)", () => {
    const answers = { ...allCorrect(slug), [ids[0]!]: wrongFor(slug, ids[0]!) };
    const r = grade(slug, answers);
    expect(r.score).toBe(75);
    expect(r.passed).toBe(mission.passMark <= 0.75);
  });

  it("fails below the pass mark and reveals no solutions", () => {
    const answers = { [ids[0]!]: wrongFor(slug, ids[0]!), [ids[1]!]: wrongFor(slug, ids[1]!) };
    const r = grade(slug, answers);
    expect(r.passed).toBe(false);
    const text = JSON.stringify(r);
    for (const k of KEYS[slug]!.items) {
      expect(text).not.toContain(k.rationale);
      if (k.type === "single-choice") expect(text).not.toContain(`"${k.correctOptionId}"`);
      else expect(text).not.toContain(`"feedback":"${k.expected}`);
    }
    expect(r.items.filter((i) => i.status === "unanswered")).toHaveLength(ids.length - 2);
  });

  it("scores an empty submission as 0 and not passed", () => {
    expect(grade(slug, {})).toMatchObject({ score: 0, passed: false });
  });
});

describe("gradeExcelAssessment details", () => {
  it("EX-101 needs 80%: three of four is not enough", () => {
    const answers = { ...allCorrect("excel-sum-101"), "s2-kisumu-total": "1" };
    expect(grade("excel-sum-101", answers)).toMatchObject({ score: 75, passed: false, passMark: 0.8 });
  });

  it("trims whitespace and accepts only exact numeric tolerance (0)", () => {
    const a = allCorrect("excel-sum-101");
    expect(grade("excel-sum-101", { ...a, "s2-kisumu-total": " 145 " }).items[1]?.status).toBe("correct");
    expect(grade("excel-sum-101", { ...a, "s2-kisumu-total": "146" }).items[1]?.status).toBe("incorrect");
  });

  it("flags unparseable numbers as invalid without revealing the answer", () => {
    const r = grade("excel-sum-101", { "s2-kisumu-total": "1,45" });
    const item = r.items.find((i) => i.id === "s2-kisumu-total")!;
    expect(item.status).toBe("invalid");
    expect(item.feedback).not.toMatch(/145/);
  });

  it("ignores non-string answers, over-long answers and prototype keys", () => {
    const a = allCorrect("excel-lookup-103");
    const r = grade("excel-lookup-103", { ...a, "l1-boot-price": 4599, "l4-line-total": "9".repeat(500) });
    expect(r.items.find((i) => i.id === "l1-boot-price")?.status).toBe("unanswered");
    expect(r.items.find((i) => i.id === "l4-line-total")?.status).not.toBe("correct");
    const proto = JSON.parse('{"__proto__": "x", "constructor": "y"}') as Record<string, unknown>;
    expect(grade("excel-sum-101", proto).score).toBe(0);
  });

  it("throws when keys belong to another mission or an item has no key", () => {
    const { mission } = getExcelMission("excel-sum-101")!;
    expect(() => gradeExcelAssessment(mission, KEYS["excel-if-102"]!, {})).toThrow(/belong to/);
    const trimmed = { ...KEYS["excel-sum-101"]!, items: KEYS["excel-sum-101"]!.items.slice(1) };
    expect(() => gradeExcelAssessment(mission, trimmed, {})).toThrow(/missing or mismatched key/);
  });

  it("is deterministic", () => {
    const a = allCorrect("excel-if-102");
    expect(grade("excel-if-102", a)).toEqual(grade("excel-if-102", a));
  });
});
