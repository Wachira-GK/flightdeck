import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUser, refreshSession, type AuthConfig, type AuthUser, type Tokens } from "./gotrue";

// Session = two HttpOnly cookies set by the server. JavaScript in the browser can never read them
// (XSS cannot steal the session), they are SameSite=Lax (cross-site POSTs do not carry them) and Secure
// in production. The access token is short-lived; the refresh token lets the server renew it.
export const ACCESS_COOKIE = "fd-at";
export const REFRESH_COOKIE = "fd-rt";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

/** Reads the public Supabase settings. The literal `process.env.NEXT_PUBLIC_*` form is required for Next to inline them. */
export function authConfig(): AuthConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  return { url, anonKey };
}

export interface CookieJar {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function applySessionCookies(jar: CookieJar, tokens: Tokens): void {
  jar.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.expiresIn));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
}

export function clearSessionCookies(jar: CookieJar): void {
  jar.set(ACCESS_COOKIE, "", cookieOptions(0));
  jar.set(REFRESH_COOKIE, "", cookieOptions(0));
}

export type SessionState =
  | { status: "signed-in"; user: AuthUser; accessToken: string }
  | { status: "needs-refresh" }
  | { status: "anonymous" }
  | { status: "unavailable" };

/**
 * Who is making this request? The access token is checked with Supabase on every call (never decoded and
 * trusted locally). "needs-refresh" means the access token is missing or expired but a refresh token exists;
 * a server component cannot set cookies, so the caller redirects to /auth/refresh which can.
 */
export async function readSession(): Promise<SessionState> {
  const jar = await cookies();
  const at = jar.get(ACCESS_COOKIE)?.value;
  const rt = jar.get(REFRESH_COOKIE)?.value;
  if (at) {
    const r = await getUser(authConfig(), at);
    if (r.ok) return { status: "signed-in", user: r.value, accessToken: at };
    if (r.reason === "unavailable") return { status: "unavailable" };
  }
  return rt ? { status: "needs-refresh" } : { status: "anonymous" };
}

/**
 * Guard for protected pages. Anonymous visitors go to the sign-in page and come back afterwards.
 * `refreshed` is true when we just came back from /auth/refresh: if the session is still not valid then,
 * stop (sign in again) instead of looping.
 */
export async function requireUser(next: string, refreshed: boolean): Promise<{ user: AuthUser; accessToken: string }> {
  const s = await readSession();
  if (s.status === "signed-in") return { user: s.user, accessToken: s.accessToken };
  if (s.status === "unavailable") throw new Error("Sign-in service is unavailable. Try again shortly.");
  const q = encodeURIComponent(next);
  if (s.status === "needs-refresh" && !refreshed) redirect(`/auth/refresh?next=${q}`);
  redirect(`/sign-in?next=${q}${s.status === "needs-refresh" ? "&notice=expired" : ""}`);
}

/** Used by /auth/refresh: swap the refresh token for fresh tokens. */
export async function refreshFromCookie(refreshToken: string) {
  return refreshSession(authConfig(), refreshToken);
}
