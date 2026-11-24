import { NextResponse, type NextRequest } from "next/server";
import { adminConfig, takeResetVerifier } from "@/server/admin/admin";
import { recordSignIn } from "@/server/activity";
import { subOf } from "@/server/auth/aal";
import { exchangePkceCode } from "@/server/auth/gotrue";
import { isVerifier } from "@/server/auth/pkce";
import { applySessionCookies, authConfig, OAUTH_COOKIE, oauthCookieOptions } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

// Where Supabase sends the browser back after Google. It carries a one-time ?code=. We trade it for a
// session using the secret verifier from the cookie set in /auth/google, then drop that cookie.
// Any problem (user pressed Cancel, no cookie, expired or replayed code) ends on the sign-in page with a
// neutral message and no session. The raw error text is never shown or logged.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const code = p.get("code") ?? "";
  const cookie = request.cookies.get(OAUTH_COOKIE)?.value ?? "";
  const dot = cookie.indexOf(".");
  let verifier = dot > 0 ? cookie.slice(0, dot) : "";
  let next = "/cockpit";
  try {
    next = safeNext(decodeURIComponent(dot > 0 ? cookie.slice(dot + 1) : ""));
  } catch {
    next = "/cockpit"; // malformed escape in the cookie
  }
  // A reset link that an ADMIN started for this learner carries ?rid= instead of a cookie: the secret verifier
  // was kept on the server (migration 20261123000800) and is handed over once. It only ever leads to /reset-password.
  const rid = p.get("rid") ?? "";
  if (!verifier && rid) {
    verifier = (await takeResetVerifier(adminConfig(), rid)) ?? "";
    next = "/reset-password";
  }

  const go = (path: string) => {
    const res = new NextResponse(null, { status: 303, headers: { Location: path } });
    res.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 }); // single use
    return res;
  };

  // The same return point serves Google sign-in and password-reset links; only the failure message differs.
  const failed = next === "/reset-password" ? "/forgot-password?notice=reset-failed" : "/sign-in?notice=google-failed";
  if (p.get("error") || !code || code.length > 500 || !isVerifier(verifier)) return go(failed);

  const r = await exchangePkceCode(authConfig(), code, verifier);
  if (!r.ok) return go(failed);

  const res = go(next);
  applySessionCookies(res.cookies, r.value);
  // A reset link also ends here; only a real Google sign-in is counted (best effort, never blocks the sign-in).
  if (next !== "/reset-password") await recordSignIn(subOf(r.value.accessToken), "google");
  return res;
}
