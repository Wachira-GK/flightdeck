import type { Metadata } from "next";
import { Card } from "@flightdeck/ui";
import { resetPasswordAction } from "@/app/auth/actions";
import { ResetForm } from "@/components/auth/password-forms";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

// Reached from the reset email: the link signs the learner in once, then this page sets the new password.
// Anyone not signed in is sent to the sign-in page.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user } = await requireUser("/reset-password", sp.refreshed === "1");
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <p className="mt-2 text-fg-muted">For {user.email}. After saving, you go straight to your Cockpit.</p>
      <Card className="mt-6">
        <ResetForm action={resetPasswordAction} />
      </Card>
    </div>
  );
}
