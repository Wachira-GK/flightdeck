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
    <div className="space-y-5">
    {/* Plain link, not next/link: Link would prefetch the route and start a Google sign-in nobody asked for. */}
    <a
      href={`/auth/google?next=${encodeURIComponent(next)}`}
      className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-border-strong bg-surface px-4 py-2 font-medium hover:bg-accent-subtle"
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      Continue with Google
    </a>
    <p className="flex items-center gap-3 text-sm text-fg-muted" aria-hidden="true">
      <span className="h-px flex-1 bg-border-strong" />
      or use your email
      <span className="h-px flex-1 bg-border-strong" />
    </p>
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
      {state.unconfirmed && state.email ? (
        <p className="text-sm">
          <Link className="font-medium text-accent underline" href={`/check-email?email=${encodeURIComponent(state.email)}&next=${encodeURIComponent(next)}`}>
            Send the confirmation email again
          </Link>
        </p>
      ) : null}
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
    </div>
  );
}
