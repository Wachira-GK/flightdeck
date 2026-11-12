// Minimal Supabase Auth (GoTrue) client over plain fetch. Server-only: it is imported by server actions,
// route handlers and server components, never by client components. No node:fs, no Node-only APIs
// (Cloudflare Workers). The anon key is the public key; it never gives more than the user's own rights.
//
// Why not a library: @supabase/ssr needs a request proxy to refresh sessions, which forces every route
// dynamic (more Worker CPU) and its Node runtime is unproven on OpenNext. Five documented REST calls are
// smaller and fully unit-testable with a fake fetch. See docs/decisions/ADR-007-auth-session.md.

export interface AuthConfig {
  /** Project URL, for example https://abcd.supabase.co (no trailing slash needed). */
  url: string;
  anonKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds the access token stays valid, as reported by Supabase. */
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthFailure =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "invalid_request"
  | "unavailable";

export type AuthResult<T> = { ok: true; value: T } | { ok: false; reason: AuthFailure };

const fail = (reason: AuthFailure): { ok: false; reason: AuthFailure } => ({ ok: false, reason });

function base(cfg: AuthConfig): string {
  return cfg.url.replace(/\/+$/, "");
}

async function call(cfg: AuthConfig, path: string, init: { method: string; body?: unknown; bearer?: string }) {
  const f = cfg.fetch ?? fetch;
  const headers: Record<string, string> = { apikey: cfg.anonKey, accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  headers.authorization = `Bearer ${init.bearer ?? cfg.anonKey}`;
  const res = await f(`${base(cfg)}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
    cache: "no-store",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Record<string, unknown> | null };
}

function reasonFor(status: number, json: Record<string, unknown> | null): AuthFailure {
  const code = String(json?.error_code ?? json?.code ?? "");
  if (status === 429 || code.includes("rate_limit")) return "rate_limited";
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (code === "weak_password") return "weak_password";
  if (code === "invalid_credentials" || code === "user_not_found") return "invalid_credentials";
  if (status >= 500) return "unavailable";
  if (status === 400 || status === 401 || status === 403) return "invalid_credentials";
  return status === 422 ? "invalid_request" : "unavailable";
}

function toTokens(json: Record<string, unknown> | null): Tokens | null {
  const at = json?.access_token;
  const rt = json?.refresh_token;
  const exp = Number(json?.expires_in);
  if (typeof at !== "string" || typeof rt !== "string" || !at || !rt) return null;
  return { accessToken: at, refreshToken: rt, expiresIn: Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : 3600 };
}

async function safely<T>(run: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
  try {
    return await run();
  } catch {
    return fail("unavailable"); // network error or timeout; never leak the cause to the browser
  }
}

export function signInWithPassword(cfg: AuthConfig, email: string, password: string): Promise<AuthResult<Tokens>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    if (r.status !== 200) return fail(reasonFor(r.status, r.json));
    const t = toTokens(r.json);
    return t ? { ok: true, value: t } : fail("unavailable");
  });
}

/**
 * Creates an account. `session` is set only when the project does not require email confirmation;
 * otherwise Supabase sends a confirmation email and no session exists yet. An address that is already
 * registered looks the same as a new one (anti-enumeration): callers must show one neutral message.
 */
export function signUp(
  cfg: AuthConfig,
  input: { email: string; password: string; displayName: string },
): Promise<AuthResult<{ session: Tokens | null }>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/signup", {
      method: "POST",
      body: { email: input.email, password: input.password, data: { display_name: input.displayName } },
    });
    if (r.status !== 200) return fail(reasonFor(r.status, r.json));
    return { ok: true, value: { session: toTokens(r.json) } };
  });
}

export function refreshSession(cfg: AuthConfig, refreshToken: string): Promise<AuthResult<Tokens>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
    if (r.status !== 200) return fail(reasonFor(r.status, r.json));
    const t = toTokens(r.json);
    return t ? { ok: true, value: t } : fail("unavailable");
  });
}

/** The server asks Supabase who the token belongs to; the token is never trusted by decoding it locally. */
export function getUser(cfg: AuthConfig, accessToken: string): Promise<AuthResult<AuthUser>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/user", { method: "GET", bearer: accessToken });
    if (r.status === 401 || r.status === 403) return fail("invalid_credentials");
    if (r.status !== 200) return fail("unavailable");
    const id = r.json?.id;
    const email = r.json?.email;
    if (typeof id !== "string" || typeof email !== "string") return fail("unavailable");
    return { ok: true, value: { id, email } };
  });
}

/** Ends this session only (scope=local); other devices stay signed in. */
export function signOut(cfg: AuthConfig, accessToken: string): Promise<AuthResult<true>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/logout?scope=local", { method: "POST", bearer: accessToken });
    return r.status === 204 || r.status === 200 || r.status === 401 ? { ok: true, value: true } : fail("unavailable");
  });
}

/** Exchanges the token_hash from a confirmation email link for a session. */
export function verifyEmailLink(cfg: AuthConfig, tokenHash: string, type: "signup" | "email" | "magiclink"): Promise<AuthResult<Tokens>> {
  return safely(async () => {
    const r = await call(cfg, "/auth/v1/verify", { method: "POST", body: { token_hash: tokenHash, type } });
    if (r.status !== 200) return fail(reasonFor(r.status, r.json));
    const t = toTokens(r.json);
    return t ? { ok: true, value: t } : fail("unavailable");
  });
}

export interface ProfileView {
  displayName: string;
  timeZone: string;
  roles: string[];
}

/**
 * Reads the signed-in user's own profile and roles through PostgREST WITH the user's token, so Row Level
 * Security decides what comes back (a user can only ever see their own rows). Returns null on any failure;
 * the page then falls back to the email.
 */
export async function getOwnProfile(cfg: AuthConfig, accessToken: string): Promise<ProfileView | null> {
  try {
    const get = async (path: string) => {
      const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/rest/v1/${path}`, {
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
        cache: "no-store",
      });
      return res.ok ? ((await res.json()) as Record<string, unknown>[]) : null;
    };
    const [profile, roles] = await Promise.all([get("profiles?select=display_name,timezone&limit=1"), get("user_roles?select=role")]);
    if (!profile) return null;
    const row = profile[0] ?? {};
    return {
      displayName: typeof row.display_name === "string" ? row.display_name : "",
      timeZone: typeof row.timezone === "string" && row.timezone ? row.timezone : "Africa/Nairobi",
      roles: (roles ?? []).map((r) => String(r.role)).sort(),
    };
  } catch {
    return null;
  }
}
