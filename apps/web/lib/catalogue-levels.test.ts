import { describe, expect, it } from "vitest";
import { MISSION_DEFINITIONS } from "../components/excel/registry.generated";
import { getCatalogue, MISSION_LEVELS, parseLevel } from "./catalogue";

describe("mission levels", () => {
  it("LVL-01 every Excel mission file declares a valid level", () => {
    const ids = MISSION_LEVELS.map((l) => l.id as string);
    for (const m of Object.values(MISSION_DEFINITIONS)) {
      expect(ids, `${m.slug} level`).toContain(m.level);
    }
  });

  it("LVL-02 unknown or missing levels count as beginner so no mission is hidden", () => {
    expect(parseLevel(undefined)).toBe("beginner");
    expect(parseLevel("expert")).toBe("beginner");
    expect(parseLevel("advanced")).toBe("advanced");
  });

  it("LVL-03 the catalogue lists beginner, then intermediate, then advanced, and uses every level", async () => {
    const tracks = await getCatalogue();
    const excel = tracks.find((t) => t.slug === "excel-masterclass");
    const rank = (l: string) => MISSION_LEVELS.findIndex((x) => x.id === l);
    const ranks = (excel?.missions ?? []).map((m) => rank(m.level));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(3);
  });
});
