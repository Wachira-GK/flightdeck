// ACC-W01..W06: mission access checks used by the mission page, grading routes and cockpit (ADR-011).
import { describe, expect, it } from "vitest";
import { accessMessage, accessSummary, isOpenFor, missionAccess, type AccessConfig } from "./access";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cfgWith = (impl: (url: string, init: RequestInit) => Response | Promise<Response>): AccessConfig => ({
  url: "https://x.supabase.co/",
  serviceKey: "service-key",
  fetch: ((u: string, i: RequestInit) => Promise.resolve(impl(u, i))) as unknown as typeof fetch,
});

describe("ACC-W mission access", () => {
  it("ACC-W01 with no service key, access control is off (local development only)", async () => {
    expect(await missionAccess(null, "u1", "m")).toBe("open");
    expect(await accessSummary(null, "u1")).toBeNull();
  });

  it("ACC-W02 asks the database function with the verified user id and the slug, and returns its answer", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const cfg = cfgWith((url, init) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return json("locked");
    });
    expect(await missionAccess(cfg, "u1", "excel-if-102")).toBe("locked");
    expect(seen).toEqual({ url: "https://x.supabase.co/rest/v1/rpc/fd_mission_access", body: { p_user: "u1", p_slug: "excel-if-102" } });
    expect(await missionAccess(cfgWith(() => json("open")), null, "excel-sum-101")).toBe("open");
  });

  it("ACC-W03 fails closed: an outage, an error status or an unexpected answer never opens a mission", async () => {
    expect(await missionAccess(cfgWith(() => json({ message: "boom" }, 500)), "u1", "m")).toBe("error");
    expect(await missionAccess(cfgWith(() => json("sure, open it please")), "u1", "m")).toBe("error");
    expect(await missionAccess(cfgWith(() => json({ open: true })), "u1", "m")).toBe("error");
    expect(await missionAccess(cfgWith(() => Promise.reject(new Error("network"))), "u1", "m")).toBe("error");
  });

  it("ACC-W04 the summary is parsed defensively", async () => {
    const s = await accessSummary(cfgWith(() => json({ staff: false, free: ["a", 3, "b"], disabled: ["c"], unlocked: "nope" })), "u1");
    expect(s).toEqual({ staff: false, free: ["a", "b"], disabled: ["c"], unlocked: [] });
    expect(await accessSummary(cfgWith(() => json(null)), "u1")).toBeNull();
    expect(await accessSummary(cfgWith(() => json({}, 500)), "u1")).toBeNull();
  });

  it("ACC-W05 isOpenFor mirrors the database rule", () => {
    const learner = { staff: false, free: ["f"], disabled: ["d", "f2"], unlocked: ["u", "d"] };
    expect(isOpenFor(learner, "f")).toBe(true);
    expect(isOpenFor(learner, "u")).toBe(true);
    expect(isOpenFor(learner, "x")).toBe(false);
    expect(isOpenFor(learner, "d")).toBe(false); // switched off wins over an unlock
    expect(isOpenFor({ staff: true, free: [], disabled: ["d"], unlocked: [] }, "x")).toBe(true);
    expect(isOpenFor({ staff: true, free: [], disabled: ["d"], unlocked: [] }, "d")).toBe(false);
  });

  it("ACC-W06 every closed state has learner-facing words", () => {
    for (const a of ["locked", "disabled", "unknown", "error"] as const) {
      const m = accessMessage(a);
      expect(m.title.length).toBeGreaterThan(5);
      expect(m.body.length).toBeGreaterThan(5);
    }
  });
});
