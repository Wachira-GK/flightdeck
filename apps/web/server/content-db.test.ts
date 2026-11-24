import { describe, expect, it } from "vitest";
import { getCatalogue, overlayCatalogue, type PublishedItem } from "../lib/catalogue";
import { contentExercise, contentForLearner, contentGrading, publishedSummaries } from "./content-db";
import { handleAssessment } from "./assessment";

const cfgWith = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => ({
  url: "https://db.test",
  serviceKey: "service-key-test",
  fetch: (async (url: string, init: RequestInit) => impl(url, init)) as unknown as typeof fetch,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("CDB content read path (ADR-015 stage 2b)", () => {
  it("CDB-01 no service key means no database read: every reader returns null", async () => {
    expect(await publishedSummaries(null)).toBeNull();
    expect(await contentForLearner("u", "excel-sum-101", true, null)).toBeNull();
    expect(await contentGrading("u", "excel-sum-101", null)).toBeNull();
    expect(await contentExercise("excel-sum-101-sheet", null)).toBeNull();
  });

  it("CDB-02 a failing or timed-out database returns null instead of throwing (fallback to built-in files)", async () => {
    expect(await contentForLearner(null, "excel-sum-101", false, cfgWith(() => json({ message: "boom" }, 500)))).toBeNull();
    expect(await contentGrading(null, "excel-sum-101", cfgWith(() => Promise.reject(new Error("host db.test unreachable"))))).toBeNull();
    expect(await contentForLearner(null, "excel-sum-101", false, cfgWith(() => json({ ok: false, reason: "not_found" })))).toBeNull();
  });

  it("CDB-03 bad slugs are refused before any network call", async () => {
    let calls = 0;
    const cfg = cfgWith(() => {
      calls += 1;
      return json({ ok: true });
    });
    expect(await contentForLearner(null, "Bad Slug", true, cfg)).toBeNull();
    expect(await contentGrading(null, "../x", cfg)).toBeNull();
    expect(await contentExercise("A", cfg)).toBeNull();
    expect(calls).toBe(0);
  });

  it("CDB-04 requests use the service key and send the verified user id and pin flag", async () => {
    let seen: { url: string; headers: Record<string, string>; body: unknown } | undefined;
    const cfg = cfgWith((url, init) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return json({ ok: true, revision: 3, track: "excel", level: "beginner", mission: { slug: "excel-x1" }, exercise: { id: "e" } });
    });
    const r = await contentForLearner("00000000-0000-4000-8000-000000000001", "excel-x1", true, cfg);
    expect(r?.revision).toBe(3);
    expect(seen?.url).toBe("https://db.test/rest/v1/rpc/fd_content_for_learner");
    expect(seen?.headers.apikey).toBe("service-key-test");
    expect(seen?.body).toEqual({ p_user: "00000000-0000-4000-8000-000000000001", p_slug: "excel-x1", p_pin: true });
  });

  it("CDB-05 the exercise lookup returns the owning mission so access rules can apply", async () => {
    const r = await contentExercise("excel-x1-sheet", cfgWith(() => json({ ok: true, slug: "excel-x1", exercise: { id: "excel-x1-sheet" }, exerciseKey: { k: 1 } })));
    expect(r?.slug).toBe("excel-x1");
    expect(r?.key).toEqual({ k: 1 });
  });

  it("CDB-06 the assessment router grades from the database when it has the mission, else from the built-in files", async () => {
    const built = await handleAssessment("no-such-mission-anywhere", new Request("http://x", { method: "POST" }));
    expect(built.status).toBe(404); // no service key in tests: database path is skipped, built-in path 404s
  });

  it("CDB-07 overlay: a published mission replaces the built-in one with the same slug and a new slug is added; empty input changes nothing", async () => {
    const base = await getCatalogue();
    const excel = base.find((t) => t.slug === "excel-masterclass")!;
    const first = excel.missions[0]!;
    const items: PublishedItem[] = [
      { slug: first.slug, track: "excel", code: first.code, title: "Renamed by an author", level: "advanced", summary: "New summary", estimatedMinutes: 12 },
      { slug: "excel-brand-new-1", track: "excel", code: "EX-901", title: "Brand new", level: "beginner", summary: null, estimatedMinutes: "x" },
    ];
    expect(overlayCatalogue(base, null)).toBe(base);
    expect(overlayCatalogue(base, [])).toBe(base);
    const out = overlayCatalogue(base, items).find((t) => t.slug === "excel-masterclass")!;
    expect(out.missions.length).toBe(excel.missions.length + 1);
    expect(out.missions.find((m) => m.slug === first.slug)).toMatchObject({ title: "Renamed by an author", level: "advanced", estimatedMinutes: 12 });
    expect(out.missions.find((m) => m.slug === "excel-brand-new-1")).toMatchObject({ level: "beginner", summary: null, estimatedMinutes: null, href: "/missions/excel-brand-new-1" });
    expect(out.missions.map((m) => m.position)).toEqual(out.missions.map((_, i) => i + 1));
    // other tracks are untouched
    expect(overlayCatalogue(base, items).find((t) => t.slug === "mathlab")).toEqual(base.find((t) => t.slug === "mathlab"));
  });
});
