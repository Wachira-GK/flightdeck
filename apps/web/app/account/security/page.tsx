
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, Card } from "@flightdeck/ui";
import { SetupFlow } from "@/components/auth/mfa-forms";
import { requireUser } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

export const metadata: Metadata = { title: "Account security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(sp.next), "/account/security");
  const here = `/account/security?next=${encodeURIComponent(next)}`;
  const { user, factorId, aal } = await requireUser(here, sp.refreshed === "1", { allowAal1: true });
  // Someone who already has two-step sign-in must prove it for this session before seeing this page.
  if (factorId && aal !== "aal2") redirect(`/mfa?next=${encodeURIComponent(here)}`);

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Account security</h1>
      <p className="mt-2 text-fg-muted">Signed in as {user.email}.</p>

      {one(sp.required) === "admin" && !factorId ? (
        <p role="status" className="mt-4 rounded-md bg-accent-subtle px-3 py-2 text-sm">
          Admin accounts must use two-step sign-in. Set it up now to continue to the admin area.
        </p>
      ) : null}

      <Card className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Two-step sign-in</h2>
          {factorId ? <Badge tone="accent">On</Badge> : <Badge tone="muted">Off</Badge>}
        </div>
        {factorId ? (
          <div className="mt-3 space-y-3">
            <p className="text-fg-muted">
              Every time you sign in you will also type a 6-digit code from your authenticator app. If you lose your phone, an admin can reset this and you set it up again.
            </p>
            <Link href={next === "/account/security" ? "/cockpit" : next} className="inline-block underline">
              Continue
            </Link>
          </div>
        ) : (
          <div className="mt-3">
            <p className="mb-4 text-fg-muted">Adds a 6-digit code from your phone to your password or Google sign-in, so a stolen password is not enough.</p>
            <SetupFlow next={next} />
          </div>
        )}
      </Card>
    </div>
  );
}
