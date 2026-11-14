import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@flightdeck/ui";
import { ResendForm } from "@/components/auth/resend-form";
import { resendAction } from "@/app/auth/actions";
import { readSession } from "@/server/auth/session";
import { isEmail, normaliseEmail, safeNext } from "@/server/auth/validate";

export const metadata: Metadata = { title: "Check your email" };
export const dynamic = "force-dynamic";

/** Shown after "Create account" when Supabase needs the email confirmed. The next step is the inbox, not this form. */
export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const email = normaliseEmail(typeof sp.email === "string" ? sp.email : "");

  if ((await readSession()).status === "signed-in") redirect(next);
  if (!isEmail(email)) redirect("/sign-up");

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Check your email</h1>
      <p className="mt-2 text-fg-muted">
        If <strong data-testid="check-email-address" className="break-all text-fg">{email}</strong> can be registered, we have sent a confirmation link to it.
        Open the link, then sign in.
      </p>
      <Card className="mt-6 space-y-5">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open the email from FlightDeck. Look in spam or junk if it is not in your inbox.</li>
          <li>Click the confirmation link.</li>
          <li>Come back and sign in with your email and password.</li>
        </ol>
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-2 font-medium hover:bg-accent-subtle sm:w-auto"
        >
          Go to sign in
        </Link>
        <div className="border-t border-border-strong pt-4">
          <p className="mb-3 text-sm text-fg-muted">No email after a few minutes?</p>
          <ResendForm email={email} action={resendAction} />
          <p className="mt-3 text-sm text-fg-muted">
            Wrong address?{" "}
            <Link className="font-medium text-accent underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>
              Start again
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
