"use client";

import { useActionState } from "react";
import { Button } from "@flightdeck/ui";
import type { AuthFormState } from "@/app/auth/actions";

type Props = {
  email: string;
  action: (prev: AuthFormState, fd: FormData) => Promise<AuthFormState>;
};

/** "Send the email again" button on the Check-your-email screen. Only the address travels; no password. */
export function ResendForm({ email, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as AuthFormState);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending…" : "Send the email again"}
      </Button>
      <div role="alert">{state.error ? <p className="text-danger">{state.error}</p> : null}</div>
      <div role="status">{state.notice ? <p className="text-fg">{state.notice}</p> : null}</div>
    </form>
  );
}
