import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@flightdeck/ui";
import { AuthForm } from "@/components/auth/auth-form";
import { signInAction } from "@/app/auth/actions";
import { readSession } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  "signed-out": "You are signed out.",
  expired: "Your session ended. Sign in again to continue.",
  "link-invalid": "That confirmation link is not valid any more. Sign in, or create the account again.",
  confirmed: "Email confirmed. Sign in to continue.",
  "google-failed": "Google sign-in did not finish. Try again, or use your email.",
  "google-off": "Google sign-in is not switched on yet. Use your email for now.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const next = safeNext(one("next"));
  const notice = NOTICES[one("notice") ?? ""];

  if ((await readSession()).status === "signed-in") redirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-fg-muted">Welcome back. Pick up your mission where you left it.</p>
      {notice ? (
        <p role="status" className="mt-4 rounded-md bg-accent-subtle px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <Card className="mt-6">
        <AuthForm mode="sign-in" action={signInAction} next={next} />
      </Card>
    </div>
  );
}
