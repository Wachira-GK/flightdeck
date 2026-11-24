import { describe, expect, it } from "vitest";
import { blankDoc, PLACEHOLDER } from "../../lib/author/doc";
import { buildContent } from "./convert";
import { CONTENT_FAILURE_TEXT, editableRevision, getContent, listContent, reviewContent, saveDraft, type ContentSummary } from "./content";

const cfgWith = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => ({
  url: "https://db.test",
  serviceKey: "service-key-test",
  fetch: (async (url: string, init: RequestInit) => impl(url, init)) as unknown as typeof fetch,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (o: Partial<ContentSummary>): ContentSummary => ({
  slug: "excel-x1", revision: 1, status: "published", track: "excel", code: "EX-901", title: "T", level: "beginner",
  authorId: null, reviewerId: null, changeNote: null, reviewNote: null, liveSynced: true, updatedAt: "", submittedAt: null, publishedAt: null, mine: false, ...o,
});
const ACTOR = "00000000-0000-4000-8000-000000000001";

describe("CAU author content wrappers (ADR-015 stage 2c)", () => {
  it("CAU-01 nothing is called without a service key", async () => {
    expect(await listContent(null, ACTOR)).toEqual({ ok: false, reason: "not_configured" });
  });

  it("CAU-02 database refusals map to plain reasons and unknown ones to 'unavailable'; network errors never leak the cause", async () => {
    expect(await reviewContent(cfgWith(() => json({ ok: false, reason: "own_work" })), ACTOR, "excel-x1", 1, "publish", "")).toEqual({ ok: false, reason: "own_work" });
    expect(await reviewContent(cfgWith(() => json({ ok: false, reason: "weird" })), ACTOR, "excel-x1", 1, "publish", "")).toEqual({ ok: false, reason: "unavailable" });
    expect(await reviewContent(cfgWith(() => json({}, 500)), ACTOR, "excel-x1", 1, "publish", "")).toEqual({ ok: false, reason: "unavailable" });
    const r = await getContent(cfgWith(() => Promise.reject(new Error("connect ECONNREFUSED db.test"))), ACTOR, "excel-x1", null);
    expect(JSON.stringify(r)).not.toContain("db.test");
    for (const text of Object.values(CONTENT_FAILURE_TEXT)) expect(text.length).toBeGreaterThan(10);
  });

  it("CAU-03 the list carries the caller's role and what they may do", async () => {
    const r = await listContent(cfgWith(() => json({ ok: true, role: "reviewer", canWrite: true, canReview: true, items: [row({})] })), ACTOR);
    expect(r).toMatchObject({ ok: true, value: { role: "reviewer", canWrite: true, canReview: true } });
    const none = await listContent(cfgWith(() => json({ ok: true, role: "author", items: [] })), ACTOR);
    expect(none).toMatchObject({ ok: true, value: { canWrite: false, canReview: false } }); // missing flags mean no permission
  });

  it("CAU-04 saving sends the actor from the session, the built documents, and never the whole form", async () => {
    let body: Record<string, unknown> = {};
    const built = buildContent(blankDoc("excel-demo-901", "EX-901", "Demo", "beginner"));
    await saveDraft(cfgWith((_u, init) => {
      body = JSON.parse(String(init.body));
      return json({ ok: true, revision: 4 });
    }), ACTOR, built, "x".repeat(900));
    expect(body.p_actor).toBe(ACTOR);
    expect(body.p_slug).toBe("excel-demo-901");
    expect(body.p_level).toBe("beginner");
    expect(String(body.p_change_note).length).toBe(500);
    expect(JSON.stringify(body.p_mission)).not.toContain("rationale");
    expect(JSON.stringify(body.p_exercise_key)).toContain("authoring");
    expect(JSON.stringify(body.p_mission)).toContain(PLACEHOLDER);
  });

  it("CAU-05 the editor opens the open draft (or the one waiting) first, else the newest revision", () => {
    const items = [row({ revision: 1 }), row({ revision: 2, status: "draft" }), row({ slug: "other", revision: 3 })];
    expect(editableRevision(items, "excel-x1")?.revision).toBe(2);
    expect(editableRevision([row({ revision: 1 }), row({ revision: 3, status: "retired" })], "excel-x1")?.revision).toBe(3);
    expect(editableRevision(items, "missing")).toBeUndefined();
  });
});
