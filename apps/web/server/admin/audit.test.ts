// AUD-W01..W03: the read-only audit screen helpers (ADR-013).
import { describe, expect, it } from "vitest";
import { auditDetailText, auditLog, type AdminConfig } from "./admin";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cfgWith = (impl: (url: string, init: RequestInit) => Response | Promise<Response>): AdminConfig => ({
  url: "https://x.supabase.co/",
  serviceKey: "service-key",
  fetch: ((u: string, i: RequestInit) => Promise.resolve(impl(u, i))) as unknown as typeof fetch,
});

describe("AUD-W audit screen", () => {
  it("AUD-W01 asks for 50 rows with the filter and cursor, and parses rows defensively", async () => {
    let body: unknown;
    const cfg = cfgWith((_u, init) => {
      body = JSON.parse(String(init.body));
      return json({
        ok: true,
        more: true,
        actions: ["a", 5, "b"],
        rows: [{ id: 9, at: "t", actorId: null, action: "admin_set_roles", entity: "user", entityId: "u1", detail: { before: ["learner"], after: ["author"] } }, { id: "bad" }, null],
      });
    });
    const r = await auditLog(cfg, "admin1", "admin_set_roles", 20);
    expect(body).toEqual({ p_actor: "admin1", p_action: "admin_set_roles", p_before: 20, p_limit: 50 });
    expect(r).toEqual({
      ok: true,
      value: {
        rows: [{ id: 9, at: "t", actorId: null, action: "admin_set_roles", entity: "user", entityId: "u1", detail: 'before: ["learner"]; after: ["author"]' }],
        more: true,
        actions: ["a", "b"],
      },
    });
  });

  it("AUD-W02 a refusal or outage is reported, never shown as an empty log", async () => {
    expect(await auditLog(cfgWith(() => json({ ok: false, reason: "forbidden" })), "x", "", null)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await auditLog(cfgWith(() => Promise.reject(new Error("net"))), "x", "", null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await auditLog(null, "x", "", null)).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("AUD-W03 detail text is short and safe for any shape", () => {
    expect(auditDetailText(null)).toBe("");
    expect(auditDetailText("text")).toBe("");
    expect(auditDetailText({})).toBe("");
    expect(auditDetailText({ a: "x".repeat(500) }).length).toBe(201);
  });
});
