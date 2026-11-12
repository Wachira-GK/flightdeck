import { NextResponse, type NextRequest } from "next/server";
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
  const verifier = dot > 0 ? cookie.slice(0, dot) : "";
  let next = "/cockpit";
  try {
    next = safeNext(decodeURIComponent(dot > 0 ? cookie.slice(dot + 1) : ""));
  } catch {
    next = "/cockpit"; // malformed escape in the cookie
  }

  const go = (path: string) => {
    const res = new NextResponse(null, { status: 303, headers: { Location: path } });
    res.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 }); // single use
    return res;
  };

  if (p.get("error") || !code || code.length > 500 || !isVerifier(verifier)) return go("/sign-in?notice=google-failed");

  const r = await exchangePkceCode(authConfig(), code, verifier);
  if (!r.ok) return go("/sign-in?notice=google-failed");

  const res = go(next);
  applySessionCookies(res.cookies, r.value);
  return res;
}
