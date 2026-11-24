
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@flightdeck/ui";
import { ChallengeForm } from "@/components/auth/mfa-forms";
import { requireUser } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

export const metadata: Metadata = { title: "Two-step sign-in" };
export const dynamic = "force-dynamic";

// Sign-in step 2. Reached when someone with two-step sign-in has signed in with a password or Google but has
// not yet confirmed a code for this session. Anyone else is sent on to where they were going.
export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = safeNext(raw);
  const { user, factorId, aal } = await requireUser(`/mfa?next=${encodeURIComponent(next)}`, sp.refreshed === "1", { allowAal1: true });
  if (!factorId) redirect(`/account/security?next=${encodeURIComponent(next)}`);
  if (aal === "aal2") redirect(next);
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Two-step sign-in</h1>
      <p className="mt-2 text-fg-muted">Open your authenticator app and type the 6-digit code for FlightDeck. Signed in as {user.email}.</p>
      <Card className="mt-6">
        <ChallengeForm next={next} />
      </Card>
      <p className="mt-4 text-sm text-fg-muted">Lost your phone? Ask an admin to reset your two-step sign-in. You will set it up again next time you sign in.</p>
    </div>
  );
}
