import { readSession } from "@/server/auth/session";

// Tells the header whether to show "Sign in" or "Sign out". The pages themselves stay static (cheap to serve);
// only this tiny call is per-visitor. It reveals no name, email or token: just signed-in or not.
// "needs-refresh" counts as signed in (a refresh token exists; the next protected page renews it).
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await readSession();
  const signedIn = s.status === "signed-in" || s.status === "needs-refresh";
  return Response.json({ signedIn }, { headers: { "Cache-Control": "no-store" } });
}
