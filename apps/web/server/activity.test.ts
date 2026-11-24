// ACT-W01..W05: the activity log helpers (ADR-012). Recording must never get in the learner's way.
import { describe, expect, it } from "vitest";
import { activityOverview, minutesText, recordBeat, recordSignIn, reviewFlags, touchVisit, userActivity, userMissionTime } from "./activity";
import type { AccessConfig } from "./access";
import { subOf } from "./auth/aal";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cfgWith = (impl: (url: string, init: RequestInit) => Response | Promise<Response>): AccessConfig => ({
  url: "https://x.supabase.co/",
  serviceKey: "service-key",
  fetch: ((u: string, i: RequestInit) => Promise.resolve(impl(u, i))) as unknown as typeof fetch,
});
const UID = "11111111-2222-4333-8444-555555555555";
const token = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;

describe("ACT-W activity helpers", () => {
  it("ACT-W01 with no service key or no user, nothing is sent and nothing breaks", async () => {
    let called = false;
    const cfg = cfgWith(() => {
      called = true;
      return json({ ok: true });
    });
    expect(await recordSignIn(UID, "password", null)).toBe(false);
    expect(await touchVisit(UID, null)).toBe(false);
    expect(await recordSignIn(null, "password", cfg)).toBe(false);
    expect(await touchVisit(null, cfg)).toBe(false);
    expect(called).toBe(false);
  });

  it("ACT-W02 sends only the user id and method to the right functions", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const cfg = cfgWith((url, init) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return json({ ok: true });
    });
    expect(await recordSignIn(UID, "google", cfg)).toBe(true);
    expect(await touchVisit(UID, cfg)).toBe(true);
    expect(seen).toEqual([
      { url: "https://x.supabase.co/rest/v1/rpc/fd_activity_sign_in", body: { p_user: UID, p_method: "google" } },
      { url: "https://x.supabase.co/rest/v1/rpc/fd_activity_touch", body: { p_user: UID } },
    ]);
  });

  it("ACT-W03 outages, errors and refusals are swallowed (return false, never throw)", async () => {
    expect(await recordSignIn(UID, "password", cfgWith(() => json({ message: "boom" }, 500)))).toBe(false);
    expect(await recordSignIn(UID, "password", cfgWith(() => Promise.reject(new Error("network"))))).toBe(false);
    expect(await touchVisit(UID, cfgWith(() => json({ ok: false, reason: "unknown_user" })))).toBe(false);
    expect(await touchVisit(UID, cfgWith(() => new Response("not json", { status: 200 })))).toBe(false);
  });

  it("ACT-W04 admin views are parsed defensively and return null when unreadable", async () => {
    const o = await activityOverview(
      "admin",
      30,
      cfgWith(() => json({ ok: true, days: [{ day: "2026-11-24", activeUsers: 2, signIns: 3, visits: "x" }, 7], activeUsers: 2, signIns: 3, totalUsers: 9, topUsers: [{ userId: "u", daysActive: 4, signIns: 5, visits: 6, lastSeen: "t" }] })),
    );
    expect(o).toEqual({
      days: [{ day: "2026-11-24", activeUsers: 2, signIns: 3, visits: 0 }],
      activeUsers: 2,
      signIns: 3,
      totalUsers: 9,
      topUsers: [{ userId: "u", daysActive: 4, signIns: 5, visits: 6, lastSeen: "t" }],
    });
    expect(await activityOverview("admin", 30, cfgWith(() => json({ ok: false, reason: "forbidden" })))).toBeNull();
    expect(await activityOverview("admin", 30, null)).toBeNull();
    const u = await userActivity("admin", "u", cfgWith(() => json({ ok: true, signIns7: 1, signIns30: 2, daysActive30: 3, firstSeen: null, lastSeen: "t", recent: [{ at: "a", method: "password" }], daily: [] })));
    expect(u).toMatchObject({ signIns7: 1, signIns30: 2, daysActive30: 3, firstSeen: null, lastSeen: "t", recent: [{ at: "a", method: "password" }] });
    expect(await userActivity("admin", "u", cfgWith(() => Promise.reject(new Error("x"))))).toBeNull();
  });

  it("ACT-W06 heartbeats send the verified user, slug and whole seconds; flags and times parse defensively", async () => {
    let body: unknown;
    const cfg = cfgWith((_u, init) => {
      body = JSON.parse(String(init.body));
      return json({ ok: true });
    });
    expect(await recordBeat(UID, "excel-sum-101", 14.6, cfg)).toBe(true);
    expect(body).toEqual({ p_user: UID, p_slug: "excel-sum-101", p_seconds: 15 });
    expect(await recordBeat(null, "x", 5, cfg)).toBe(false);
    expect(await recordBeat(UID, "x".repeat(121), 5, cfg)).toBe(false);
    expect(await recordBeat(UID, "x", 5, null)).toBe(false);

    const f = await reviewFlags(
      "admin",
      90,
      180,
      cfgWith(() => json({ ok: true, trackingSince: "2026-11-24", minSeconds: 180, flags: [{ userId: "u", slug: "m", score: 90, gradedAt: "t", seconds: 40, reason: "fast" }, { slug: "bad" }, { userId: "u2", slug: "m2", reason: "other" }] })),
    );
    expect(f?.flags).toEqual([
      { userId: "u", slug: "m", score: 90, gradedAt: "t", seconds: 40, reason: "fast" },
      { userId: "u2", slug: "m2", score: 0, gradedAt: "", seconds: 0, reason: "no_time" },
    ]);
    expect(await reviewFlags("admin", 90, 180, cfgWith(() => json({ ok: false })))).toBeNull();
    expect(await userMissionTime("admin", "u", cfgWith(() => json({ ok: true, missions: [{ slug: "m", seconds: 125, days: 2, lastDay: "d" }] })))).toEqual([{ slug: "m", seconds: 125, days: 2, lastDay: "d" }]);
    expect(minutesText(40)).toBe("40 s");
    expect(minutesText(754)).toBe("13 min");
  });

  it("ACT-W05 subOf reads a user id from a token and refuses anything that is not a uuid", () => {
    expect(subOf(token({ sub: UID }))).toBe(UID);
    expect(subOf(token({ sub: "not-a-uuid" }))).toBeNull();
    expect(subOf(token({}))).toBeNull();
    expect(subOf("garbage")).toBeNull();
    expect(subOf("")).toBeNull();
  });
});
