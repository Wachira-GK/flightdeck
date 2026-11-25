import { describe, expect, it } from "vitest";
import { EXCEL_ASSESSMENT_SLUGS } from "../server/excel-assessment";
import { SIM_LESSON_FOR_MISSION, SIM_LESSON_IDS, simBayHref } from "./simbay-lessons";

describe("SBL mission to Sim Bay lesson pairing", () => {
  it("SBL-01 every paired mission exists and every lesson id is a known Sim Bay lesson", () => {
    for (const [slug, lesson] of Object.entries(SIM_LESSON_FOR_MISSION)) {
      expect(EXCEL_ASSESSMENT_SLUGS, slug).toContain(slug);
      expect(SIM_LESSON_IDS as readonly string[], lesson).toContain(lesson);
    }
  });

  it("SBL-02 every Sim Bay lesson is used by at least one mission", () => {
    const used = new Set(Object.values(SIM_LESSON_FOR_MISSION));
    for (const id of SIM_LESSON_IDS) expect(used.has(id), id).toBe(true);
  });

  it("SBL-03 the link carries the lesson and the way back, safely encoded; unpaired missions just open Sim Bay", () => {
    const back = "/missions/excel-sum-101?step=simulation";
    const href = simBayHref("excel-sum-101", back);
    const q = new URL(href, "https://x.test").searchParams;
    expect(q.get("lesson")).toBe("L1-sum");
    expect(q.get("from")).toBe(back);
    expect(new URL(simBayHref("excel-nope", back), "https://x.test").searchParams.has("lesson")).toBe(false);
    expect(simBayHref("__proto__", back)).not.toContain("lesson");
  });
});
