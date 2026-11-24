"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestPasswordReset, resendSignupEmail, signInWithPassword, signOut, signUp, updatePassword, type AuthFailure } from "@/server/auth/gotrue";
import { challengeFor, newVerifier } from "@/server/auth/pkce";
import { ACCESS_COOKIE, applySessionCookies, authConfig, clearSessionCookies, OAUTH_COOKIE, oauthCookieOptions, readSession } from "@/server/auth/session";
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
  invalid_code: "That code is not right or has expired. Try the next code from your app.",
  mfa_unavailable: "Two-step sign-in is not switched on for this project yet.",
  bad_response: "We could not read the sign-in service's reply. Try again shortly.",
  invalid_credentials: "That email and password do not match. Check them and try again.",
  email_not_confirmed: "Confirm your email first: open the link we sent you, then sign in.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  weak_password: "That password is too easy to guess. Choose a longer, less common one.",
  invalid_request: "We could not process that. Check the details. If you already have an account with this email, sign in instead.",
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

/** Where the reset link must land. Supabase only honours addresses on its allow-list, so a forged Host header gains nothing. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * "Forgot your password?": emails a reset link. The secret (PKCE verifier) stays in an HttpOnly cookie in
 * THIS browser, so the link only works in the browser that asked for it. Same message whether or not the
 * address is registered (no account enumeration).
 */
export async function forgotPasswordAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = normaliseEmail(field(fd, "email"));
  if (!isEmail(email)) return { error: "Enter a valid email address.", email };
  const verifier = newVerifier();
  const r = await requestPasswordReset(authConfig(), email, `${await siteOrigin()}/auth/callback`, await challengeFor(verifier));
  if (!r.ok && r.reason === "rate_limited") return { error: FAILURE_TEXT.rate_limited, email };
  if (!r.ok && r.reason === "unavailable") return { error: FAILURE_TEXT.unavailable, email };
  (await cookies()).set(OAUTH_COOKIE, `${verifier}.${encodeURIComponent("/reset-password")}`, oauthCookieOptions());
  return { notice: "If that address has an account, a reset link is on its way. Open it in this browser. It can take a minute; check spam too.", email };
}

/** Sets the new password for the learner who just opened a valid reset link (they are signed in by it). */
export async function resetPasswordAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const s = await readSession();
  if (s.status !== "signed-in") return { error: "Your reset link has ended. Ask for a new one from the sign-in page." };
  const password = field(fd, "password");
  if (password !== field(fd, "confirm")) return { error: "The two passwords do not match." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const r = await updatePassword(authConfig(), s.accessToken, password);
  if (!r.ok) {
    const text = r.reason === "invalid_request" ? "We could not use that password. Choose a different one." : FAILURE_TEXT[r.reason];
    return { error: text };
  }
  redirect("/cockpit?password=changed");
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const at = jar.get(ACCESS_COOKIE)?.value;
  if (at) await signOut(authConfig(), at); // best effort: cookies are cleared either way
  clearSessionCookies(jar);
  redirect("/sign-in?notice=signed-out");
}
