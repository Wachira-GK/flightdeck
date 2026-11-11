import { evaluateSheet } from "@flightdeck/excel-engine";
import { describe, expect, it } from "vitest";
// Keys are imported here (a test) only to check consistency; UI code must never import them.
import sumKeys from "../../../../content/excel/missions/excel-sum-101.keys.json";
import ifKeys from "../../../../content/excel/missions/excel-if-102.keys.json";
import lookupKeys from "../../../../content/excel/missions/excel-lookup-103.keys.json";
import { EXCEL_MISSION_SLUGS, getExcelMission } from "./content";
import { validateExcelMission, type ExcelMissionKeys } from "./missions";

const KEYS: Record<string, ExcelMissionKeys> = {
  "excel-sum-101": sumKeys as unknown as ExcelMissionKeys,
  "excel-if-102": ifKeys as unknown as ExcelMissionKeys,
  "excel-lookup-103": lookupKeys as unknown as ExcelMissionKeys,
};

const EXPECTED_META = {
  "excel-sum-101": { code: "EX-101", exerciseId: "sum-relative-refs" },
  "excel-if-102": { code: "EX-102", exerciseId: "if-business-thresholds" },
  "excel-lookup-103": { code: "EX-103", exerciseId: "xlookup-price-list" },
} as const;

const numericKey = (slug: string, id: string): number => {
  const k = KEYS[slug]!.items.find((i) => i.id === id);
  if (!k || k.type !== "numeric") throw new Error(`no numeric key ${id}`);
  return k.expected;
};

describe("Excel missions", () => {
  it("lists the three missions", () => {
    expect(EXCEL_MISSION_SLUGS).toEqual(Object.keys(EXPECTED_META));
  });

  it.each(Object.entries(EXPECTED_META))("%s is valid and consistent with its keys", (slug, meta) => {
    const content = getExcelMission(slug);
    expect(content).toBeDefined();
    const { mission, exercise } = content!;
    expect(mission.slug).toBe(slug);
    expect(mission.code).toBe(meta.code);
    expect(exercise.id).toBe(meta.exerciseId);
    expect(validateExcelMission(mission, exercise, KEYS[slug])).toEqual([]);
  });

  it.each(EXCEL_MISSION_SLUGS)("%s ships no answers to the browser", (slug) => {
    const text = JSON.stringify(getExcelMission(slug));
    expect(text).not.toMatch(/correctOptionId|"expected"|rationale|hiddenTests|requireFormula/);
  });

  it("returns undefined for unknown or prototype slugs", () => {
    expect(getExcelMission("nope")).toBeUndefined();
    expect(getExcelMission("__proto__")).toBeUndefined();
    expect(getExcelMission("constructor")).toBeUndefined();
  });

  it("validateExcelMission reports problems", () => {
    const { mission, exercise } = getExcelMission("excel-sum-101")!;
    const broken = {
      ...mission,
      code: "XX-1",
      steps: mission.steps.slice(0, 4),
      assessment: { items: mission.assessment.items.slice(0, 2) },
    };
    const issues = validateExcelMission(broken, exercise, KEYS["excel-sum-101"]).join("\n");
    expect(issues).toMatch(/code must look like/);
    expect(issues).toMatch(/steps must be/);
    expect(issues).toMatch(/3 or 4 items/);
    expect(issues).toMatch(/key s3-copy-right has no item/);
  });

  it("numeric keys match the engine (EX-101)", () => {
    const v = evaluateSheet({ B2: "45", B3: "62", B4: "38", B5: "=SUM(B2:B4)", C2: "120", C3: "105", C4: "143", C5: "=SUM(C2:C4)" });
    expect(v.B5).toBe(numericKey("excel-sum-101", "s2-kisumu-total"));
    expect(v.C5).toBe(numericKey("excel-sum-101", "s4-corrected-month"));
  });

  it("numeric keys match the engine (EX-102)", () => {
    expect(evaluateSheet({ B2: "7200", C2: "=IF(B2>=5000,B2*5%,0)" }).C2).toBe(numericKey("excel-if-102", "i3-commission"));
  });

  it("numeric keys match the engine and the exercise price list (EX-103)", () => {
    const { exercise } = getExcelMission("excel-lookup-103")!;
    const v = evaluateSheet({
      ...exercise.starter,
      I1: '=XLOOKUP("bt-330",$E$2:$E$6,$G$2:$G$6)',
      I2: '=XLOOKUP("SL-075",$E$2:$E$6,$G$2:$G$6)*3',
      I3: '=XLOOKUP("GB-610",$E$2:$E$6,$G$2:$G$6)',
    });
    expect(v.I1).toBe(numericKey("excel-lookup-103", "l1-boot-price"));
    expect(v.I2).toBe(numericKey("excel-lookup-103", "l4-line-total"));
    expect(v.I3).toMatchObject({ error: "#N/A" });
  });
});
