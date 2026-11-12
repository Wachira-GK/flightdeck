import { NextResponse, type NextRequest } from "next/server";
import { verifyEmailLink } from "@/server/auth/gotrue";
import { applySessionCookies, authConfig } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

// Target of the link in Supabase's confirmation email. The email template must point here:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// (see docs/decisions/ADR-007-auth-session.md). The token is single-use and verified by Supabase.
export const dynamic = "force-dynamic";

const TYPES = new Set(["signup", "email", "magiclink"]);

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const tokenHash = p.get("token_hash") ?? "";
  const type = p.get("type") ?? "";
  const next = safeNext(p.get("next"));
  // Relative Location on purpose: an absolute URL built from request.url can carry a different host name
  // (localhost vs 127.0.0.1, or an internal host behind a proxy) and the browser would not send our cookies there.
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

  if (!tokenHash || tokenHash.length > 200 || !TYPES.has(type)) return go("/sign-in?notice=link-invalid");

  const r = await verifyEmailLink(authConfig(), tokenHash, type as "signup" | "email" | "magiclink");
  if (!r.ok) return go("/sign-in?notice=link-invalid");

  const res = go(next);
  applySessionCookies(res.cookies, r.value);
  return res;
}
