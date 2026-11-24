
// MFA-W01..W12: two-step sign-in server pieces with a fake fetch (no network). ADR-010.
import { describe, expect, it } from "vitest";
import { aalOf, isCode, verifiedTotpId } from "./aal";
import { enrollTotp, getUser, removeFactor, verifyTotp, type AuthConfig } from "./gotrue";
import { resetMfa, type AdminConfig } from "../admin/admin";

type Reply = { status?: number; json: unknown };
function fake(handler: (url: string, init?: RequestInit) => Reply) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = handler(String(input), init);
    return new Response(r.status === 204 ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const cfg: AuthConfig = { url: "https://x.supabase.co", anonKey: "anon", fetch: f };
  return { cfg, calls };
}
const jwt = (claims: Record<string, unknown>) => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
};
const SVG = "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>";
const headersOf = (init?: RequestInit) => init?.headers as Record<string, string>;

describe("MFA two-step sign-in (server)", () => {
  it("MFA-W01 aalOf reads the level from the token; anything odd means aal1", () => {
    expect(aalOf(jwt({ aal: "aal2" }))).toBe("aal2");
    expect(aalOf(jwt({ aal: "aal1" }))).toBe("aal1");
    expect(aalOf(jwt({}))).toBe("aal1");
    for (const bad of ["", "abc", "a.b.c", "a..c", jwt({ aal: 2 })]) expect(aalOf(bad)).toBe("aal1");
  });

  it("MFA-W02 only a CONFIRMED authenticator app counts as two-step sign-in", () => {
    expect(verifiedTotpId(undefined)).toBeNull();
    expect(verifiedTotpId([{ id: "f1", type: "totp", status: "unverified" }])).toBeNull();
    expect(verifiedTotpId([{ id: "p1", type: "phone", status: "verified" }])).toBeNull();
    expect(verifiedTotpId([{ id: "f1", type: "totp", status: "unverified" }, { id: "f2", type: "totp", status: "verified" }])).toBe("f2");
  });

  it("MFA-W03 isCode accepts exactly six digits", () => {
    expect(isCode("123456")).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", " 123456", "", null, 123456]) expect(isCode(bad)).toBe(false);
  });

  it("MFA-W04 getUser reports factors when present and omits them otherwise", async () => {
    const withF = fake(() => ({ json: { id: "u1", email: "a@b.c", factors: [{ id: "f1", factor_type: "totp", status: "verified" }, { id: "f2", factor_type: "totp", status: "unverified" }] } }));
    expect(await getUser(withF.cfg, "t")).toEqual({
      ok: true,
      value: { id: "u1", email: "a@b.c", factors: [{ id: "f1", type: "totp", status: "verified" }, { id: "f2", type: "totp", status: "unverified" }] },
    });
    const without = fake(() => ({ json: { id: "u1", email: "a@b.c" } }));
    expect(await getUser(without.cfg, "t")).toEqual({ ok: true, value: { id: "u1", email: "a@b.c" } });
  });

  it("MFA-W05 enrolment uses the person's own token and returns a safe QR data URL plus the secret", async () => {
    const { cfg, calls } = fake(() => ({ json: { id: "fac1", totp: { qr_code: `data:image/svg+xml;utf-8,${SVG}`, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" } } }));
    const r = await enrollTotp(cfg, "USER_AT");
    expect(r.ok && r.value.factorId).toBe("fac1");
    expect(r.ok && r.value.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(r.ok && r.value.qrSrc.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
    expect(calls[0]!.url).toBe("https://x.supabase.co/auth/v1/factors");
    expect(headersOf(calls[0]!.init).authorization).toBe("Bearer USER_AT");
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ factor_type: "totp", issuer: "FlightDeck" });
  });

  it("MFA-W06 a QR code that is not an SVG is rejected; a disabled project is reported plainly", async () => {
    const bad = fake(() => ({ json: { id: "f", totp: { qr_code: "data:text/html,<script>alert(1)</script>", secret: "S" } } }));
    expect(await enrollTotp(bad.cfg, "t")).toEqual({ ok: false, reason: "unavailable" });
    const off = fake(() => ({ status: 422, json: { error_code: "mfa_totp_enroll_not_enabled" } }));
    expect(await enrollTotp(off.cfg, "t")).toEqual({ ok: false, reason: "mfa_unavailable" });
  });

  it("MFA-W07 verify = challenge then verify; success returns the upgraded session tokens", async () => {
    const { cfg, calls } = fake((url) =>
      url.endsWith("/challenge") ? { json: { id: "ch1" } } : { json: { access_token: "AAL2_AT", refresh_token: "RT", expires_in: 3600 } },
    );
    const r = await verifyTotp(cfg, "USER_AT", "fac1", "123456");
    expect(r).toEqual({ ok: true, value: { accessToken: "AAL2_AT", refreshToken: "RT", expiresIn: 3600 } });
    expect(calls.map((c) => c.url)).toEqual(["https://x.supabase.co/auth/v1/factors/fac1/challenge", "https://x.supabase.co/auth/v1/factors/fac1/verify"]);
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ challenge_id: "ch1", code: "123456" });
  });

  it("MFA-W08 a wrong code is invalid_code; a failed challenge stops before verify; the factor id is URL-encoded", async () => {
    const wrong = fake((url) => (url.endsWith("/challenge") ? { json: { id: "ch1" } } : { status: 400, json: { error_code: "mfa_verification_failed" } }));
    expect(await verifyTotp(wrong.cfg, "t", "f", "000000")).toEqual({ ok: false, reason: "invalid_code" });
    const noChallenge = fake(() => ({ status: 404, json: { error_code: "mfa_factor_not_found" } }));
    const r = await verifyTotp(noChallenge.cfg, "t", "f/../x", "111111");
    expect(r.ok).toBe(false);
    expect(noChallenge.calls).toHaveLength(1);
    expect(noChallenge.calls[0]!.url).toContain("f%2F..%2Fx");
  });

  it("MFA-W09 removeFactor accepts 200 or 204 and fails otherwise", async () => {
    expect(await removeFactor(fake(() => ({ status: 204, json: null })).cfg, "t", "f1")).toEqual({ ok: true, value: true });
    expect((await removeFactor(fake(() => ({ status: 403, json: {} })).cfg, "t", "f1")).ok).toBe(false);
  });

  it("MFA-W10 admin reset: database first, then every factor is removed through the admin API", async () => {
    const { cfg, calls } = fake((url) => {
      if (url.includes("/rpc/fd_admin_mfa_reset")) return { json: { ok: true } };
      if (url.includes("/factors/")) return { status: 200, json: {} };
      return { json: { id: "u2", email: "l@b.c", factors: [{ id: "fa", factor_type: "totp", status: "verified" }, { id: "fb", factor_type: "totp", status: "unverified" }] } };
    });
    const adminCfg: AdminConfig = { url: "https://x.supabase.co", serviceKey: "SVC", fetch: cfg.fetch };
    const r = await resetMfa(adminCfg, "actor", "u2");
    expect(r).toEqual({ ok: true, value: true });
    const urls = calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`);
    expect(urls[0]).toContain("/rpc/fd_admin_mfa_reset");
    expect(urls).toContain("DELETE https://x.supabase.co/auth/v1/admin/users/u2/factors/fa");
    expect(urls).toContain("DELETE https://x.supabase.co/auth/v1/admin/users/u2/factors/fb");
  });

  it("MFA-W11 admin reset: when the database refuses, no factor is touched", async () => {
    const { cfg, calls } = fake(() => ({ json: { ok: false, reason: "master_protected" } }));
    const r = await resetMfa({ url: "https://x.supabase.co", serviceKey: "SVC", fetch: cfg.fetch }, "actor", "master");
    expect(r).toEqual({ ok: false, reason: "master_protected" });
    expect(calls).toHaveLength(1);
  });

  it("MFA-W12 admin reset: a factor that cannot be removed is reported as a warning, not hidden", async () => {
    const { cfg } = fake((url) => {
      if (url.includes("/rpc/")) return { json: { ok: true } };
      if (url.includes("/factors/")) return { status: 500, json: {} };
      return { json: { id: "u2", email: "l@b.c", factors: [{ id: "fa", factor_type: "totp", status: "verified" }] } };
    });
    const r = await resetMfa({ url: "https://x.supabase.co", serviceKey: "SVC", fetch: cfg.fetch }, "actor", "u2");
    expect(r.ok && r.warning).toMatch(/could not be removed/);
  });
});
