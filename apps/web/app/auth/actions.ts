"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resendSignupEmail, signInWithPassword, signOut, signUp, type AuthFailure } from "@/server/auth/gotrue";
import { ACCESS_COOKIE, applySessionCookies, authConfig, clearSessionCookies } from "@/server/auth/session";
import { cleanName, isEmail, normaliseEmail, passwordProblem, safeNext } from "@/server/auth/validate";

export interface AuthFormState {
  error?: string;
  /** Neutral success message (sign-up asks the learner to check their email). */
  notice?: string;
  /** Echoed back so a failed attempt does not clear the field. Never the password. */
  email?: string;
  name?: string;
  /** Sign-in was refused only because the email is not confirmed yet: the form then offers "Resend". */
  unconfirmed?: boolean;
}

const FAILURE_TEXT: Record<AuthFailure, string> = {
  invalid_credentials: "That email and password do not match. Check them and try again.",
  email_not_confirmed: "Confirm your email first: open the link we sent you, then sign in.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  weak_password: "That password is too easy to guess. Choose a longer, less common one.",
  invalid_request: "We could not process that. Check the details and try again.",
  unavailable: "Sign-in is temporarily unavailable. Try again shortly.",
};

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

export async function signInAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = normaliseEmail(field(fd, "email"));
  const password = field(fd, "password");
  if (!isEmail(email)) return { error: "Enter a valid email address.", email };
  if (!password || password.length > 200) return { error: "Enter your password.", email };

  const r = await signInWithPassword(authConfig(), email, password);
  if (!r.ok) return { error: FAILURE_TEXT[r.reason], email, unconfirmed: r.reason === "email_not_confirmed" };

  applySessionCookies(await cookies(), r.value);
  redirect(safeNext(field(fd, "next")));
}

export async function signUpAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = normaliseEmail(field(fd, "email"));
  const name = cleanName(field(fd, "name"));
  const password = field(fd, "password");
  if (!name) return { error: "Enter the name you want us to use.", email, name };
  if (!isEmail(email)) return { error: "Enter a valid email address.", email, name };
  const problem = passwordProblem(password);
  if (problem) return { error: problem, email, name };

  const r = await signUp(authConfig(), { email, password, displayName: name });
  if (!r.ok) return { error: FAILURE_TEXT[r.reason], email, name };

  if (r.value.session) {
    // The project does not require email confirmation: the learner is signed in straight away.
    applySessionCookies(await cookies(), r.value.session);
    redirect(safeNext(field(fd, "next")));
  }
  // Same screen whether or not the address was already registered (no account enumeration).
  redirect(checkEmailPath(email, field(fd, "next")));
}

/** Where a learner waits for the confirmation email. The address is shown back so a typo is easy to spot. */
function checkEmailPath(email: string, next: string): string {
  const q = new URLSearchParams({ email });
  const n = safeNext(next);
  if (n !== safeNext(undefined)) q.set("next", n);
  return `/check-email?${q.toString()}`;
}

export async function resendAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = normaliseEmail(field(fd, "email"));
  if (!isEmail(email)) return { error: "Enter a valid email address.", email };
  const r = await resendSignupEmail(authConfig(), email);
  if (!r.ok && r.reason === "rate_limited") return { error: FAILURE_TEXT.rate_limited, email };
  if (!r.ok && r.reason === "unavailable") return { error: FAILURE_TEXT.unavailable, email };
  // Same message whether or not the address is registered or already confirmed.
  return { notice: "Sent again. If that address is waiting for confirmation, a new link is on its way. Check spam too.", email };
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const at = jar.get(ACCESS_COOKIE)?.value;
  if (at) await signOut(authConfig(), at); // best effort: cookies are cleared either way
  clearSessionCookies(jar);
  redirect("/sign-in?notice=signed-out");
}
