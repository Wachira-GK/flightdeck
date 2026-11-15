"use client";

import { useActionState, useId } from "react";
import { Button } from "@flightdeck/ui";
import type { AuthFormState } from "@/app/auth/actions";

type Action = (prev: AuthFormState, fd: FormData) => Promise<AuthFormState>;

const inputClass = "mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base";

/** Asks for an email address and sends a reset link. Only the address travels. */
export function ForgotForm({ action }: { action: Action }) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, {} as AuthFormState);
  return (
    <form action={formAction} noValidate className="space-y-5">
      <div>
        <label htmlFor={`${uid}-email`} className="font-medium">
          Email
        </label>
        <input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          defaultValue={state.email ?? ""}
          className={inputClass}
        />
      </div>
      <div role="alert">{state.error ? <p className="text-danger">{state.error}</p> : null}</div>
      <div role="status">{state.notice ? <p className="text-fg">{state.notice}</p> : null}</div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending..." : "Send reset link"}
      </Button>
    </form>
  );
}

/** Two password boxes. The server re-checks length and that both match. */
export function ResetForm({ action }: { action: Action }) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, {} as AuthFormState);
  return (
    <form action={formAction} noValidate className="space-y-5">
      <div>
        <label htmlFor={`${uid}-password`} className="font-medium">
          New password
        </label>
        <input
          id={`${uid}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={200}
          required
          aria-describedby={`${uid}-hint`}
          className={inputClass}
        />
        <p id={`${uid}-hint`} className="mt-1 text-sm text-fg-muted">
          At least 10 characters. A few random words work well.
        </p>
      </div>
      <div>
        <label htmlFor={`${uid}-confirm`} className="font-medium">
          Type it again
        </label>
        <input id={`${uid}-confirm`} name="confirm" type="password" autoComplete="new-password" maxLength={200} required className={inputClass} />
      </div>
      <div role="alert">{state.error ? <p className="text-danger">{state.error}</p> : null}</div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving..." : "Save new password"}
      </Button>
    </form>
  );
}
