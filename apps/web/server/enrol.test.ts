import { describe, expect, it } from "vitest";
import { enrolInCourse, getOwnEnrolments } from "./enrol";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ENW enrolment (server)", () => {
  it("ENW-01 not configured means no enrolment and no network call", async () => {
    expect(await enrolInCourse(null, "u", "excel-masterclass")).toEqual({ ok: false, reason: "not_configured" });
  });

  it("ENW-02 calls fd_enrol with the verified user and maps the answer", async () => {
    let seen: { url: string; body: unknown } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return json({ ok: true, already: false, course: "Excel Masterclass" });
    }) as unknown as typeof fetch;
    const r = await enrolInCourse({ url: "https://x.supabase.co/", serviceKey: "k", fetch: fetchFn }, "USER", "excel-masterclass");
    expect(r).toEqual({ ok: true, already: false, course: "Excel Masterclass" });
    expect(seen).toEqual({ url: "https://x.supabase.co/rest/v1/rpc/fd_enrol", body: { p_user: "USER", p_course_slug: "excel-masterclass" } });
  });

  it("ENW-03 refusals and failures never throw", async () => {
    const refused = (async () => json({ ok: false, reason: "not_found" })) as unknown as typeof fetch;
    expect(await enrolInCourse({ url: "https://x", serviceKey: "k", fetch: refused }, "u", "nope-course")).toEqual({ ok: false, reason: "not_found" });
    const down = (async () => { throw new Error("secret-host"); }) as unknown as typeof fetch;
    expect(await enrolInCourse({ url: "https://x", serviceKey: "k", fetch: down }, "u", "nope-course")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("ENW-04 own enrolments: count and course slugs; failure is null (unknown), none is count 0", async () => {
    const ok = (async () => json([{ courses: { slug: "a-course" } }, { courses: [{ slug: "b-course" }] }])) as unknown as typeof fetch;
    expect(await getOwnEnrolments({ url: "https://x", anonKey: "a", fetch: ok }, "T")).toEqual({ count: 2, slugs: ["a-course", "b-course"] });
    const none = (async () => json([])) as unknown as typeof fetch;
    expect(await getOwnEnrolments({ url: "https://x", anonKey: "a", fetch: none }, "T")).toEqual({ count: 0, slugs: [] });
    const bad = (async () => json({}, 500)) as unknown as typeof fetch;
    expect(await getOwnEnrolments({ url: "https://x", anonKey: "a", fetch: bad }, "T")).toBeNull();
  });
});
