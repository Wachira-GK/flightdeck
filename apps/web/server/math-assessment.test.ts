import { describe, expect, it } from "vitest";
import { handleAssessment, MAX_BODY_BYTES } from "./math-assessment";

const post = (body: string, type = "application/json") =>
  new Request("http://localhost/api/missions/descriptive-stats-101/assessment", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });

describe("handleAssessment", () => {
  it("grades a passing attempt", async () => {
    const r = await handleAssessment("descriptive-stats-101", post(JSON.stringify({
      answers: { "a1-mean-store-b": "105.2", "a2-median-store-b": "90", "a3-sd-store-b": "50.86", "a4-typical-week": "median" },
    })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ passed: true, score: 100 });
  });
  it("404 for unknown mission", async () => {
    expect((await handleAssessment("nope", post("{}"))).status).toBe(404);
  });
  it("415 for non-JSON", async () => {
    expect((await handleAssessment("descriptive-stats-101", post("a=1", "text/plain"))).status).toBe(415);
  });
  it("413 for oversized body", async () => {
    const big = JSON.stringify({ answers: { x: "9".repeat(MAX_BODY_BYTES) } });
    expect((await handleAssessment("descriptive-stats-101", post(big))).status).toBe(413);
  });
  it("400 for malformed or wrong-shaped body", async () => {
    expect((await handleAssessment("descriptive-stats-101", post("{oops"))).status).toBe(400);
    expect((await handleAssessment("descriptive-stats-101", post(JSON.stringify({ answers: [] })))).status).toBe(400);
  });
  it("does not leak expected values on a failed attempt", async () => {
    const r = await handleAssessment("descriptive-stats-101", post(JSON.stringify({ answers: { "a1-mean-store-b": "1" } })));
    expect(JSON.stringify(r.body)).not.toMatch(/105\.2|50\.86|correctOptionId/);
  });
});
