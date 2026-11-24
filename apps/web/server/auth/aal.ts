
// Authenticator Assurance Level (two-step sign-in), ADR-010.
// aal1 = password / Google only. aal2 = a 6-digit authenticator code was also confirmed for this session.
// Supabase writes the level into the access token. The server has ALREADY asked Supabase to verify the token
// (readSession -> getUser) before this is read, so the claim cannot be forged; this only reads it, with Web APIs only.
import type { Factor } from "./gotrue";

export type Aal = "aal1" | "aal2";

export function aalOf(accessToken: string): Aal {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return "aal1";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const claims = JSON.parse(json) as { aal?: unknown };
    return claims.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

/** The user id (the "sub" claim) of a token Supabase has just issued. Null if it cannot be read. Used only to label activity. */
export function subOf(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

/** The confirmed authenticator-app factor, if the person has set one up. Unconfirmed set-ups do not count. */
export function verifiedTotpId(factors: Factor[] | undefined): string | null {
  return factors?.find((f) => f.type === "totp" && f.status === "verified")?.id ?? null;
}

export const isCode = (v: unknown): v is string => typeof v === "string" && /^\d{6}$/.test(v);
