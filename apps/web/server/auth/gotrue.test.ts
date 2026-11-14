import { describe, expect, it } from "vitest";
import {
  exchangePkceCode,
  getOwnProfile,
  getUser,
  googleAuthorizeUrl,
  googleEnabled,
  refreshSession,
  resendSignupEmail,
  signInWithPassword,
  signOut,
  signUp,
  verifyEmailLink,
  type AuthConfig,
} from "./gotrue";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake fetch that records requests and answers from a queue. */
function fake(...answers: Array<{ status: number; json?: unknown } | Error>) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const a = queue.shift() ?? { status: 500 };
    if (a instanceof Error) throw a;
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof fetch;
  const cfg: AuthConfig = { url: "https://proj.supabase.co/", anonKey: "anon-key", fetch: fetchImpl };
  return { cfg, calls };
}

const tokens = { access_token: "AT", refresh_token: "RT", expires_in: 3600 };

describe("signInWithPassword", () => {
  it("posts credentials to the password grant with the anon key and returns tokens", async () => {
    const { cfg, calls } = fake({ status: 200, json: tokens });
    const r = await signInWithPassword(cfg, "ada@example.com", "pw");
    expect(r).toEqual({ ok: true, value: { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 } });
    expect(calls[0]).toMatchObject({
      url: "https://proj.supabase.co/auth/v1/token?grant_type=password",
      method: "POST",
      body: { email: "ada@example.com", password: "pw" },
    });
    expect(calls[0]!.headers.apikey).toBe("anon-key");
    expect(calls[0]!.headers.authorization).toBe("Bearer anon-key");
  });

  it.each([
    [400, { error_code: "invalid_credentials" }, "invalid_credentials"],
    [400, { error_code: "email_not_confirmed" }, "email_not_confirmed"],
    [429, { error_code: "over_request_rate_limit" }, "rate_limited"],
    [500, {}, "unavailable"],
    [400, { msg: "something new" }, "invalid_credentials"],
  ])("maps HTTP %i %j to %s", async (status, json, reason) => {
    const { cfg } = fake({ status, json });
    expect(await signInWithPassword(cfg, "a@b.co", "x")).toEqual({ ok: false, reason });
  });

  it("treats a network error or timeout as unavailable without leaking the cause", async () => {
    const { cfg } = fake(new Error("connect ECONNRESET secret-host"));
    expect(await signInWithPassword(cfg, "a@b.co", "x")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("does not accept a 200 without usable tokens", async () => {
    const { cfg } = fake({ status: 200, json: { access_token: "AT" } });
    expect(await signInWithPassword(cfg, "a@b.co", "x")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("signUp", () => {
  it("sends the display name as metadata and reports no session when confirmation is required", async () => {
    const { cfg, calls } = fake({ status: 200, json: { id: "u1", email: "ada@example.com" } });
    const r = await signUp(cfg, { email: "ada@example.com", password: "long enough pw", displayName: "Ada" });
    expect(r).toEqual({ ok: true, value: { session: null } });
    expect(calls[0]!.body).toEqual({ email: "ada@example.com", password: "long enough pw", data: { display_name: "Ada" } });
  });
  it("returns the session when the project signs learners in straight away", async () => {
    const { cfg } = fake({ status: 200, json: tokens });
    const r = await signUp(cfg, { email: "a@b.co", password: "long enough pw", displayName: "A" });
    expect(r).toMatchObject({ ok: true, value: { session: { accessToken: "AT" } } });
  });
  it("maps a weak password and a rate limit", async () => {
    expect(await signUp(fake({ status: 422, json: { error_code: "weak_password" } }).cfg, { email: "a@b.co", password: "x", displayName: "A" })).toEqual({ ok: false, reason: "weak_password" });
    expect(await signUp(fake({ status: 429, json: { error_code: "over_email_send_rate_limit" } }).cfg, { email: "a@b.co", password: "x", displayName: "A" })).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("resendSignupEmail", () => {
  it("asks Supabase to resend the sign-up email for that address", async () => {
    const { cfg, calls } = fake({ status: 200, json: {} });
    expect(await resendSignupEmail(cfg, "ada@example.com")).toEqual({ ok: true, value: true });
    expect(calls[0]).toMatchObject({ url: "https://proj.supabase.co/auth/v1/resend", method: "POST", body: { type: "signup", email: "ada@example.com" } });
  });
  it("maps a rate limit and an outage", async () => {
    expect(await resendSignupEmail(fake({ status: 429, json: { error_code: "over_email_send_rate_limit" } }).cfg, "a@b.co")).toEqual({ ok: false, reason: "rate_limited" });
    expect(await resendSignupEmail(fake(new Error("down")).cfg, "a@b.co")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("refreshSession / verifyEmailLink", () => {
  it("refreshes with the refresh token", async () => {
    const { cfg, calls } = fake({ status: 200, json: { ...tokens, access_token: "AT2" } });
    const r = await refreshSession(cfg, "RT");
    expect(r).toMatchObject({ ok: true, value: { accessToken: "AT2" } });
    expect(calls[0]).toMatchObject({ url: "https://proj.supabase.co/auth/v1/token?grant_type=refresh_token", body: { refresh_token: "RT" } });
  });
  it("a dead refresh token is invalid_credentials", async () => {
    expect(await refreshSession(fake({ status: 400, json: { error_code: "refresh_token_not_found" } }).cfg, "x")).toEqual({ ok: false, reason: "invalid_credentials" });
  });
  it("verifies an email link token", async () => {
    const { cfg, calls } = fake({ status: 200, json: tokens });
    expect(await verifyEmailLink(cfg, "HASH", "email")).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ url: "https://proj.supabase.co/auth/v1/verify", body: { token_hash: "HASH", type: "email" } });
  });
});

describe("getUser", () => {
  it("asks Supabase who owns the token (Bearer = the user's token, not the anon key)", async () => {
    const { cfg, calls } = fake({ status: 200, json: { id: "u1", email: "ada@example.com" } });
    expect(await getUser(cfg, "USER_AT")).toEqual({ ok: true, value: { id: "u1", email: "ada@example.com" } });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/user");
    expect(calls[0]!.headers.authorization).toBe("Bearer USER_AT");
  });
  it("401/403 means the token is not valid; 5xx means we cannot tell", async () => {
    expect(await getUser(fake({ status: 401, json: {} }).cfg, "t")).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await getUser(fake({ status: 403, json: {} }).cfg, "t")).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await getUser(fake({ status: 503, json: {} }).cfg, "t")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("signOut", () => {
  it("ends only this session (scope=local)", async () => {
    const { cfg, calls } = fake({ status: 204 });
    expect(await signOut(cfg, "AT")).toEqual({ ok: true, value: true });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/logout?scope=local");
    expect(calls[0]!.headers.authorization).toBe("Bearer AT");
  });
});

describe("getOwnProfile (read with the user's token so Row Level Security applies)", () => {
  it("returns name, time zone and sorted roles", async () => {
    const { cfg, calls } = fake({ status: 200, json: [{ display_name: "Ada", timezone: "Africa/Nairobi" }] }, { status: 200, json: [{ role: "learner" }, { role: "author" }] });
    expect(await getOwnProfile(cfg, "USER_AT")).toEqual({ displayName: "Ada", timeZone: "Africa/Nairobi", roles: ["author", "learner"] });
    for (const c of calls) expect(c.headers.authorization).toBe("Bearer USER_AT");
    expect(calls.map((c) => c.url).sort()).toEqual([
      "https://proj.supabase.co/rest/v1/profiles?select=display_name,timezone&limit=1",
      "https://proj.supabase.co/rest/v1/user_roles?select=role",
    ]);
  });
  it("falls back to null on any failure", async () => {
    expect(await getOwnProfile(fake({ status: 401 }, { status: 401 }).cfg, "t")).toBeNull();
    expect(await getOwnProfile(fake(new Error("boom"), new Error("boom")).cfg, "t")).toBeNull();
  });
});

describe("Google sign-in (PKCE)", () => {
  it("builds the Supabase authorize URL with provider, return address and the S256 challenge only", () => {
    const { cfg } = fake();
    const u = new URL(googleAuthorizeUrl(cfg, "https://app.example/auth/callback", "CHALLENGE"));
    expect(u.origin + u.pathname).toBe("https://proj.supabase.co/auth/v1/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      provider: "google",
      redirect_to: "https://app.example/auth/callback",
      code_challenge: "CHALLENGE",
      code_challenge_method: "s256",
    });
  });

  it("exchanges the one-time code with the verifier for tokens", async () => {
    const { cfg, calls } = fake({ status: 200, json: tokens });
    const r = await exchangePkceCode(cfg, "CODE", "VERIFIER");
    expect(r).toEqual({ ok: true, value: { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 } });
    expect(calls[0]).toMatchObject({
      url: "https://proj.supabase.co/auth/v1/token?grant_type=pkce",
      method: "POST",
      body: { auth_code: "CODE", code_verifier: "VERIFIER" },
    });
  });

  it.each([
    [400, { error_code: "bad_code_verifier" }, "invalid_credentials"],
    [500, {}, "unavailable"],
  ])("refuses a bad exchange (HTTP %i) without a session", async (status, json, reason) => {
    const { cfg } = fake({ status, json });
    expect(await exchangePkceCode(cfg, "CODE", "V")).toEqual({ ok: false, reason });
  });

  it("treats a 200 without tokens as unavailable", async () => {
    const { cfg } = fake({ status: 200, json: {} });
    expect(await exchangePkceCode(cfg, "C", "V")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports whether Google is switched on, and false on any failure", async () => {
    expect(await googleEnabled(fake({ status: 200, json: { external: { google: true } } }).cfg)).toBe(true);
    expect(await googleEnabled(fake({ status: 200, json: { external: { google: false } } }).cfg)).toBe(false);
    expect(await googleEnabled(fake({ status: 200, json: {} }).cfg)).toBe(false);
    expect(await googleEnabled(fake({ status: 500 }).cfg)).toBe(false);
    expect(await googleEnabled(fake(new Error("boom")).cfg)).toBe(false);
  });
});
