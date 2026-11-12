import { NextResponse, type NextRequest } from "next/server";
import { googleAuthorizeUrl, googleEnabled } from "@/server/auth/gotrue";
import { challengeFor, newVerifier } from "@/server/auth/pkce";
import { authConfig, OAUTH_COOKIE, oauthCookieOptions } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

// Start of "Continue with Google". One link, no form. We create a secret (PKCE verifier), keep it in an
// HttpOnly cookie, and send the browser to Supabase, which sends it to Google. Google shows its own
// account picker; afterwards Supabase returns the browser to /auth/callback with a one-time code.
// The same route serves sign-in and sign-up: a first-time Google user simply gets an account.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  // Relative redirects for our own pages (see /auth/confirm); only the Supabase hop is absolute.
  const local = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

  const cfg = authConfig();
  if (!(await googleEnabled(cfg))) return local("/sign-in?notice=google-off");

  const verifier = newVerifier();
  const redirectTo = `${request.nextUrl.origin}/auth/callback`;
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: googleAuthorizeUrl(cfg, redirectTo, await challengeFor(verifier)) },
  });
  // verifier + where to go afterwards; "." cannot appear in a base64url verifier so it is a safe separator
  res.cookies.set(OAUTH_COOKIE, `${verifier}.${encodeURIComponent(next)}`, oauthCookieOptions());
  return res;
}
