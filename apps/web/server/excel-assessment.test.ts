import { describe, expect, it } from "vitest";
import ifKeys from "../../../content/excel/missions/excel-if-102.keys.json";
import lookupKeys from "../../../content/excel/missions/excel-lookup-103.keys.json";
import sumKeys from "../../../content/excel/missions/excel-sum-101.keys.json";
import { handleAssessment } from "./assessment";
import { EXCEL_ASSESSMENT_SLUGS, handleExcelAssessment } from "./excel-assessment";
import { MAX_BODY_BYTES } from "./math-assessment";

const post = (slug: string, body: string, type = "application/json") =>
  new Request(`http://localhost/api/missions/${slug}/assessment`, { method: "POST", headers: { "content-type": type }, body });

const RATIONALES = [sumKeys, ifKeys, lookupKeys].flatMap((k) => k.items.map((i) => i.rationale));

describe("Excel assessment handler", () => {
  it("serves exactly the three Excel missions", () => {
    expect(EXCEL_ASSESSMENT_SLUGS).toEqual(["excel-sum-101", "excel-if-102", "excel-lookup-103"]);
  });

  it("grades a passing EX-101 attempt and reveals explanations", async () => {
    const answers = { "s1-range-12-months": "sum-range", "s2-kisumu-total": "145", "s3-copy-right": "shifted", "s4-corrected-month": "368" };
    const r = await handleAssessment("excel-sum-101", post("excel-sum-101", JSON.stringify({ answers })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ passed: true, score: 100, passMark: 0.8 });
    expect(JSON.stringify(r.body)).toContain("45 + 62 + 38 = 145K");
  });

  it("grades EX-102 and EX-103 numeric items with the mission's own pass mark", async () => {
    const a102 = Object.fromEntries(ifKeys.items.map((k) => [k.id, "expected" in k ? String(k.expected) : (k as { correctOptionId: string }).correctOptionId]));
    const a103 = Object.fromEntries(lookupKeys.items.map((k) => [k.id, "expected" in k ? String(k.expected) : (k as { correctOptionId: string }).correctOptionId]));
    expect((await handleAssessment("excel-if-102", post("excel-if-102", JSON.stringify({ answers: a102 })))).body).toMatchObject({ passed: true, passMark: 0.75 });
    expect((await handleAssessment("excel-lookup-103", post("excel-lookup-103", JSON.stringify({ answers: a103 })))).body).toMatchObject({ passed: true, score: 100 });
  });

  it("does not leak rationales, option ids or expected values on a failed attempt", async () => {
    const r = await handleAssessment("excel-lookup-103", post("excel-lookup-103", JSON.stringify({ answers: { "l1-boot-price": "1", "l4-line-total": "2" } })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ passed: false });
    const text = JSON.stringify(r.body);
    for (const rationale of RATIONALES) expect(text).not.toContain(rationale);
    expect(text).not.toMatch(/4599|1497|correctOptionId/);
  });

  it("404 for unknown, prototype and Maths slugs on the Excel handler", async () => {
    for (const slug of ["nope", "__proto__", "constructor", "toString", "descriptive-stats-101"]) {
      expect((await handleExcelAssessment(slug, post(slug, "{}"))).status).toBe(404);
    }
  });

  it("router: 404 for unknown and prototype slugs, still serves Maths", async () => {
    for (const slug of ["nope", "__proto__", "constructor", "hasOwnProperty"]) {
      expect((await handleAssessment(slug, post(slug, "{}"))).status).toBe(404);
    }
    const r = await handleAssessment("descriptive-stats-101", post("descriptive-stats-101", JSON.stringify({ answers: {} })));
    expect(r).toMatchObject({ status: 200, body: { passed: false } });
  });

  it("415 for non-JSON, 413 for oversized, 400 for malformed or wrong shape", async () => {
    expect((await handleAssessment("excel-sum-101", post("excel-sum-101", "a=1", "text/plain"))).status).toBe(415);
    const big = JSON.stringify({ answers: { x: "9".repeat(MAX_BODY_BYTES) } });
    expect((await handleAssessment("excel-sum-101", post("excel-sum-101", big))).status).toBe(413);
    expect((await handleAssessment("excel-sum-101", post("excel-sum-101", "{oops"))).status).toBe(400);
    expect((await handleAssessment("excel-sum-101", post("excel-sum-101", JSON.stringify({ answers: [] })))).status).toBe(400);
    expect((await handleAssessment("excel-sum-101", post("excel-sum-101", JSON.stringify({})))).status).toBe(400);
  });
});
