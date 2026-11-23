
// ADM-W01..W10: the web layer of user administration, with a fake fetch (no network).
import { describe, expect, it } from "vitest";
import { actorFacts, listUsers, sendResetLink, setRoles, setStatus, takeResetVerifier, type AdminConfig } from "./admin";

const A = "00000000-0000-4000-8000-000000000a01";
const B = "00000000-0000-4000-8000-000000000b02";
const RID = "11111111-2222-4333-8444-555555555555";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
function fake(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = await handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const cfg: AdminConfig = { url: "https://x.supabase.co/", serviceKey: "SERVICE-SECRET", fetch: f };
  return { cfg, calls };
}
const facts = (id: string, extra: Record<string, unknown> = {}) => ({ id, displayName: "N", createdAt: "2026-11-01T00:00:00Z", roles: ["learner"], status: "active", isMaster: false, ...extra });

describe("ADM-W user administration (web layer)", () => {
  it("ADM-W01 not configured: every call is refused without touching the network", async () => {
    expect(await actorFacts(null, A)).toEqual({ ok: false, reason: "not_configured" });
    expect(await setRoles(null, A, B, ["learner"], null)).toEqual({ ok: false, reason: "not_configured" });
    expect(await takeResetVerifier(null, RID)).toBeNull();
  });

  it("ADM-W02 the service key travels as headers, never in the URL, and the actor id comes from the caller", async () => {
    const { cfg, calls } = fake(() => ({ body: { ok: true, users: [facts(A, { roles: ["admin", "learner"] })] } }));
    const r = await actorFacts(cfg, A);
    expect(r).toMatchObject({ ok: true, value: { id: A, roles: ["admin", "learner"] } });
    expect(calls[0]!.url).toBe("https://x.supabase.co/rest/v1/rpc/fd_admin_user_facts");
    expect(calls[0]!.url).not.toContain("SERVICE-SECRET");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ p_actor: A, p_ids: [A] });
    expect((calls[0]!.init!.headers as Record<string, string>).apikey).toBe("SERVICE-SECRET");
  });

  it("ADM-W03 a refusal from the database becomes a typed reason; unknown reasons never leak", async () => {
    const r1 = fake(() => ({ body: { ok: false, reason: "master_protected" } }));
    expect(await setRoles(r1.cfg, A, B, ["learner"], null)).toEqual({ ok: false, reason: "master_protected" });
    const r2 = fake(() => ({ body: { ok: false, reason: "some internal detail" } }));
    expect(await setRoles(r2.cfg, A, B, ["learner"], null)).toEqual({ ok: false, reason: "unavailable" });
    const r3 = fake(() => ({ status: 500, body: { message: "relation app_private.x does not exist" } }));
    expect(await setRoles(r3.cfg, A, B, ["learner"], null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("ADM-W04 a network failure is reported as unavailable without the cause", async () => {
    const cfg: AdminConfig = { url: "https://x.supabase.co", serviceKey: "k", fetch: (async () => { throw new Error("getaddrinfo ENOTFOUND x.supabase.co"); }) as typeof fetch };
    const r = await setStatus(cfg, A, B, "suspended", null);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });

  it("ADM-W05 listUsers merges Auth emails with database facts, filters, and pages", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
      email: `person${i}@bata.test`,
      created_at: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      last_sign_in_at: null,
    }));
    const { cfg } = fake((url, init) => {
      if (url.includes("/auth/v1/admin/users")) return { body: { users } };
      const ids = (JSON.parse(String(init!.body)) as { p_ids: string[] }).p_ids;
      return { body: { ok: true, users: ids.map((id) => facts(id)) } };
    });
    const p1 = await listUsers(cfg, A, "", 1);
    expect(p1).toMatchObject({ ok: true, value: { total: 30, pages: 2, page: 1 } });
    expect(p1.ok && p1.value.rows).toHaveLength(25);
    expect(p1.ok && p1.value.rows[0]!.email).toBe("person29@bata.test"); // newest first
    const p2 = await listUsers(cfg, A, "", 2);
    expect(p2.ok && p2.value.rows).toHaveLength(5);
    const found = await listUsers(cfg, A, "PERSON7@", 1);
    expect(found.ok && found.value.rows.map((r) => r.email)).toEqual(["person7@bata.test"]);
  });

  it("ADM-W06 suspending saves in the database first, then blocks sign-in; a failed block is reported as a warning", async () => {
    const ok = fake((url) => (url.includes("/rpc/") ? { body: { ok: true, status: "suspended" } } : { body: {} }));
    const r = await setStatus(ok.cfg, A, B, "suspended", "left");
    expect(r).toMatchObject({ ok: true, value: "suspended" });
    expect(r.ok && r.warning).toBeUndefined();
    expect(ok.calls[0]!.url).toContain("/rpc/fd_admin_set_status");
    expect(ok.calls[1]!.url).toContain(`/auth/v1/admin/users/${B}`);
    expect(JSON.parse(String(ok.calls[1]!.init!.body))).toEqual({ ban_duration: "876000h" });

    const bad = fake((url) => (url.includes("/rpc/") ? { body: { ok: true } } : { status: 500, body: {} }));
    const w = await setStatus(bad.cfg, A, B, "suspended", null);
    expect(w.ok && w.warning).toMatch(/did not confirm/);

    const refused = fake(() => ({ body: { ok: false, reason: "self_change" } }));
    await setStatus(refused.cfg, A, A, "suspended", null);
    expect(refused.calls).toHaveLength(1); // no ban attempt when the database said no
  });

  it("ADM-W07 reactivating lifts the ban", async () => {
    const { cfg, calls } = fake((url) => (url.includes("/rpc/") ? { body: { ok: true } } : { body: {} }));
    await setStatus(cfg, A, B, "active", null);
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ ban_duration: "none" });
  });

  it("ADM-W08 reset: verifier stays server-side; Supabase is asked to email the link with the handoff id", async () => {
    let verifier = "";
    const { cfg, calls } = fake((url, init) => {
      if (url.includes("/auth/v1/admin/users/")) return { body: { id: B, email: "learner@bata.test", created_at: "2026-11-01T00:00:00Z" } };
      if (url.includes("/rpc/fd_admin_reset_begin")) {
        verifier = (JSON.parse(String(init!.body)) as { p_verifier: string }).p_verifier;
        return { body: { ok: true, rid: RID } };
      }
      if (url.includes("/auth/v1/recover")) return { body: {} };
      return { status: 404, body: {} };
    });
    const r = await sendResetLink(cfg, { url: "https://x.supabase.co", anonKey: "anon", fetch: cfg.fetch }, A, B, "https://app.example");
    expect(r).toEqual({ ok: true, value: true });
    const recover = calls.find((c) => c.url.includes("/auth/v1/recover"))!;
    expect(decodeURIComponent(recover.url)).toContain(`redirect_to=https://app.example/auth/callback?rid=${RID}`);
    const body = JSON.parse(String(recover.init!.body)) as Record<string, string>;
    expect(body.email).toBe("learner@bata.test");
    expect(body.code_challenge_method).toBe("s256");
    expect(body.code_challenge).not.toBe(verifier); // only the hash goes to Supabase
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify(r)).not.toContain(verifier); // nothing the admin screen could show
  });

  it("ADM-W09 reset is refused (and no email is sent) when the database says no, or the account is unknown", async () => {
    const no = fake((url) => (url.includes("/auth/v1/admin/users/") ? { body: { id: B, email: "l@bata.test" } } : { body: { ok: false, reason: "master_protected" } }));
    const r = await sendResetLink(no.cfg, { url: "https://x.supabase.co", anonKey: "a", fetch: no.cfg.fetch }, A, B, "https://app.example");
    expect(r).toEqual({ ok: false, reason: "master_protected" });
    expect(no.calls.some((c) => c.url.includes("/recover"))).toBe(false);
    const none = fake(() => ({ status: 404, body: {} }));
    expect(await sendResetLink(none.cfg, { url: "https://x.supabase.co", anonKey: "a", fetch: none.cfg.fetch }, A, B, "https://app.example")).toEqual({ ok: false, reason: "unknown_user" });
  });

  it("ADM-W10 takeResetVerifier only accepts a UUID-shaped id and returns the verifier text", async () => {
    const { cfg, calls } = fake(() => ({ body: "V".repeat(43) }));
    expect(await takeResetVerifier(cfg, "not-a-uuid; drop table")).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await takeResetVerifier(cfg, RID)).toBe("V".repeat(43));
    const gone = fake(() => ({ body: null }));
    expect(await takeResetVerifier(gone.cfg, RID)).toBeNull();
  });
});
