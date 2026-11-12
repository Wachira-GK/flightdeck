import { NextResponse, type NextRequest } from "next/server";
import { applySessionCookies, clearSessionCookies, REFRESH_COOKIE, refreshFromCookie } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

// Server components cannot set cookies, so a page that finds an expired access token redirects here.
// We swap the refresh token for new tokens, set the cookies and send the learner back. `refreshed=1`
// tells the page not to bounce here again if the session is still unusable (no redirect loop).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const rt = request.cookies.get(REFRESH_COOKIE)?.value;
  // Relative Location on purpose: an absolute URL built from request.url can carry a different host name
  // (localhost vs 127.0.0.1, or an internal host behind a proxy) and the browser would not send our cookies there.
  const back = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

  if (!rt) return back(`/sign-in?next=${encodeURIComponent(next)}`);

  const r = await refreshFromCookie(rt);
  if (!r.ok) {
    const res = back(`/sign-in?next=${encodeURIComponent(next)}&notice=expired`);
    if (r.reason !== "unavailable") clearSessionCookies(res.cookies); // refresh token is dead; keep it if Supabase was just down
    return res;
  }
  const sep = next.includes("?") ? "&" : "?";
  const res = back(`${next}${sep}refreshed=1`);
  applySessionCookies(res.cookies, r.value);
  return res;
}
