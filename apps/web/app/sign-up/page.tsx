import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@flightdeck/ui";
import { AuthForm } from "@/components/auth/auth-form";
import { signUpAction } from "@/app/auth/actions";
import { readSession } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

export const metadata: Metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);

  if ((await readSession()).status === "signed-in") redirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-fg-muted">Free to start. We use your name and email to run your Cockpit.</p>
      <Card className="mt-6">
        <AuthForm mode="sign-up" action={signUpAction} next={next} />
      </Card>
    </div>
  );
}
