import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@flightdeck/ui";
import { forgotPasswordAction } from "@/app/auth/actions";
import { ForgotForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Forgot your password?" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const failed = sp.notice === "reset-failed";
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mt-2 text-fg-muted">Enter your email and we will send you a link to choose a new one.</p>
      {failed ? (
        <p role="status" className="mt-4 rounded-md bg-accent-subtle px-3 py-2 text-sm">
          That reset link did not work. It may have been used already or opened in a different browser. Ask for a new one here.
        </p>
      ) : null}
      <Card className="mt-6">
        <ForgotForm action={forgotPasswordAction} />
      </Card>
      <p className="mt-4 text-sm text-fg-muted">
        Remembered it?{" "}
        <Link className="font-medium text-accent underline" href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
