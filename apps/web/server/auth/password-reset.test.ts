import { describe, expect, it } from "vitest";
import { requestPasswordReset, updatePassword, type AuthConfig } from "./gotrue";

function fake(...answers: Array<{ status: number; json?: unknown } | Error>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const queue = [...answers];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const a = queue.shift() ?? { status: 500 };
    if (a instanceof Error) throw a;
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof fetch;
  const cfg: AuthConfig = { url: "https://proj.supabase.co/", anonKey: "anon-key", fetch: fetchImpl };
  return { cfg, calls };
}

describe("requestPasswordReset", () => {
  it("asks Supabase to email a PKCE link that returns to our callback", async () => {
    const { cfg, calls } = fake({ status: 200, json: {} });
    const r = await requestPasswordReset(cfg, "ada@example.com", "https://site.test/auth/callback", "chal");
    expect(r).toEqual({ ok: true, value: true });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fsite.test%2Fauth%2Fcallback");
    expect(calls[0]!.body).toEqual({ email: "ada@example.com", code_challenge: "chal", code_challenge_method: "s256" });
    expect(calls[0]!.headers.authorization).toBe("Bearer anon-key");
  });

  it("reports rate limiting and outages without leaking details", async () => {
    expect(await requestPasswordReset(fake({ status: 429, json: { error_code: "over_email_send_rate_limit" } }).cfg, "a@b.co", "https://x.test/c", "c")).toEqual({ ok: false, reason: "rate_limited" });
    expect(await requestPasswordReset(fake(new Error("boom host.internal")).cfg, "a@b.co", "https://x.test/c", "c")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("updatePassword", () => {
  it("sends the new password with the learner's own token", async () => {
    const { cfg, calls } = fake({ status: 200, json: { id: "u" } });
    expect(await updatePassword(cfg, "user-token", "a-long-new-password")).toEqual({ ok: true, value: true });
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/user");
    expect(calls[0]!.headers.authorization).toBe("Bearer user-token");
    expect(calls[0]!.body).toEqual({ password: "a-long-new-password" });
  });

  it("maps weak and rejected passwords", async () => {
    expect(await updatePassword(fake({ status: 422, json: { error_code: "weak_password" } }).cfg, "t", "x")).toEqual({ ok: false, reason: "weak_password" });
    expect(await updatePassword(fake({ status: 422, json: { error_code: "same_password" } }).cfg, "t", "x")).toEqual({ ok: false, reason: "invalid_request" });
    expect(await updatePassword(fake({ status: 401 }).cfg, "t", "x")).toEqual({ ok: false, reason: "invalid_credentials" });
  });
});
