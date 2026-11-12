"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Button } from "@flightdeck/ui";
import type { AuthFormState } from "@/app/auth/actions";

type Props = {
  mode: "sign-in" | "sign-up";
  action: (prev: AuthFormState, fd: FormData) => Promise<AuthFormState>;
  next: string;
};

const inputClass = "mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base";

/** Sign-in / sign-up form. The server re-checks everything; the browser only adds quick hints. */
export function AuthForm({ mode, action, next }: Props) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, {} as AuthFormState);
  const signUp = mode === "sign-up";
  const errId = `${uid}-error`;

  return (
    <form action={formAction} noValidate className="space-y-5" aria-describedby={state.error ? errId : undefined}>
      <input type="hidden" name="next" value={next} />
      {signUp ? (
        <div>
          <label htmlFor={`${uid}-name`} className="font-medium">
            Your name
          </label>
          <input
            id={`${uid}-name`}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            required
            defaultValue={state.name ?? ""}
            className={inputClass}
          />
        </div>
      ) : null}
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
      <div>
        <label htmlFor={`${uid}-password`} className="font-medium">
          Password
        </label>
        <input
          id={`${uid}-password`}
          name="password"
          type="password"
          autoComplete={signUp ? "new-password" : "current-password"}
          maxLength={200}
          required
          aria-describedby={signUp ? `${uid}-pw-hint` : undefined}
          className={inputClass}
        />
        {signUp ? (
          <p id={`${uid}-pw-hint`} className="mt-1 text-sm text-fg-muted">
            At least 10 characters. A few random words work well.
          </p>
        ) : null}
      </div>

      <div role="alert" id={errId}>
        {state.error ? <p className="text-danger">{state.error}</p> : null}
      </div>
      <div role="status">{state.notice ? <p className="text-fg">{state.notice}</p> : null}</div>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
      </Button>

      <p className="text-sm text-fg-muted">
        {signUp ? (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-accent underline" href={`/sign-in?next=${encodeURIComponent(next)}`}>
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="font-medium text-accent underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
