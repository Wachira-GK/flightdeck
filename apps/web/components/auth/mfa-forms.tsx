
"use client";

import { useActionState, useId } from "react";
import { Button } from "@flightdeck/ui";
import { challengeMfaAction, confirmMfaAction, startMfaAction, type MfaFormState } from "@/app/mfa/actions";

const inputClass = "mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-center text-2xl tracking-[0.4em]";

function CodeField({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={id} className="font-medium">
        6-digit code
      </label>
      <input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} required autoFocus className={inputClass} />
    </div>
  );
}

/** Sign-in step 2: type the code from the authenticator app. */
export function ChallengeForm({ next }: { next: string }) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(challengeMfaAction, {} as MfaFormState);
  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <CodeField id={`${uid}-code`} />
      <div role="alert">{state.error ? <p className="text-danger">{state.error}</p> : null}</div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Checking..." : "Continue"}
      </Button>
    </form>
  );
}

/** Set-up: (1) show the QR code and secret, (2) confirm with the first code. */
export function SetupFlow({ next }: { next: string }) {
  const uid = useId();
  const [start, startAction, starting] = useActionState(startMfaAction, {} as MfaFormState);
  const [confirm, confirmAction, confirming] = useActionState(confirmMfaAction, {} as MfaFormState);
  const setup = start.setup;
  return (
    <div className="space-y-6">
      {!setup ? (
        <form action={startAction} className="space-y-4">
          <p className="text-fg-muted">You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or Authy.</p>
          <div role="alert">{start.error ? <p className="text-danger">{start.error}</p> : null}</div>
          <Button type="submit" disabled={starting}>
            {starting ? "Preparing..." : "Set up authenticator app"}
          </Button>
        </form>
      ) : (
        <form action={confirmAction} noValidate className="space-y-5">
          <input type="hidden" name="factorId" value={setup.factorId} />
          <input type="hidden" name="next" value={next} />
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Open your authenticator app and add an account by scanning this code.
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL SVG; next/image adds nothing here */}
              <img src={setup.qrSrc} alt="QR code for your authenticator app" width={192} height={192} className="mt-3 rounded-md border border-border bg-white p-2" />
            </li>
            <li>
              Cannot scan? Type this key into the app instead:
              <code className="mt-1 block break-all rounded-md bg-surface-2 px-3 py-2 text-sm" data-testid="mfa-secret">
                {setup.secret}
              </code>
            </li>
            <li>Type the 6-digit code the app now shows.</li>
          </ol>
          <CodeField id={`${uid}-code`} />
          <div role="alert">{confirm.error ? <p className="text-danger">{confirm.error}</p> : null}</div>
          <Button type="submit" disabled={confirming}>
            {confirming ? "Checking..." : "Turn on two-step sign-in"}
          </Button>
        </form>
      )}
    </div>
  );
}
