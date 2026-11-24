
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isCode } from "@/server/auth/aal";
import { enrollTotp, removeFactor, verifyTotp, type AuthFailure } from "@/server/auth/gotrue";
import { applySessionCookies, authConfig, readSession } from "@/server/auth/session";
import { safeNext } from "@/server/auth/validate";

export interface MfaFormState {
  error?: string;
  /** Set once enrolment has started: what the person scans or types into their authenticator app. */
  setup?: { factorId: string; qrSrc: string; secret: string };
}

const TEXT: Partial<Record<AuthFailure, string>> = {
  invalid_code: "That code is not right or has expired. Wait for the next code in your app and try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  mfa_unavailable: "Two-step sign-in is not switched on for this project yet. Ask the master admin.",
  unavailable: "The sign-in service is temporarily unavailable. Try again shortly.",
};
const textFor = (r: AuthFailure) => TEXT[r] ?? "We could not complete that. Try again.";

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

/** Step 1 of set-up: clears any abandoned unconfirmed set-up, then asks Supabase for a new secret + QR code. */
export async function startMfaAction(prev: MfaFormState): Promise<MfaFormState> {
  if (prev.setup) return prev; // a double click must not create a second secret
  const s = await readSession();
  if (s.status !== "signed-in") return { error: "Your session has ended. Sign in again." };
  if (s.factorId) return { error: "Two-step sign-in is already on for this account." };
  const cfg = authConfig();
  for (const f of s.user.factors ?? []) if (f.status === "unverified") await removeFactor(cfg, s.accessToken, f.id);
  const r = await enrollTotp(cfg, s.accessToken);
  return r.ok ? { setup: r.value } : { error: textFor(r.reason) };
}

/** Step 2 of set-up: the person types the first code from their app. Success upgrades the session and moves on. */
export async function confirmMfaAction(prev: MfaFormState, fd: FormData): Promise<MfaFormState> {
  const s = await readSession();
  if (s.status !== "signed-in") return { error: "Your session has ended. Sign in again." };
  const factorId = field(fd, "factorId");
  const code = field(fd, "code").replace(/\s+/g, "");
  // The factor must be one of THIS person's unconfirmed set-ups: the id from the form is never trusted on its own.
  const mine = (s.user.factors ?? []).find((f) => f.id === factorId && f.type === "totp" && f.status === "unverified");
  if (!mine) return { ...prev, error: "That set-up has expired. Start again." };
  if (!isCode(code)) return { ...prev, error: "Enter the 6 digits shown in your authenticator app." };
  const r = await verifyTotp(authConfig(), s.accessToken, mine.id, code);
  if (!r.ok) return { ...prev, error: textFor(r.reason) };
  applySessionCookies(await cookies(), r.value);
  redirect(safeNext(field(fd, "next")));
}

/** Sign-in step 2: the confirmed factor comes from Supabase for this user, never from the form. */
export async function challengeMfaAction(_prev: MfaFormState, fd: FormData): Promise<MfaFormState> {
  const s = await readSession();
  if (s.status !== "signed-in") return { error: "Your session has ended. Sign in again." };
  const code = field(fd, "code").replace(/\s+/g, "");
  if (!isCode(code)) return { error: "Enter the 6 digits shown in your authenticator app." };
  if (!s.factorId) return { error: "Two-step sign-in is not set up for this account." };
  const r = await verifyTotp(authConfig(), s.accessToken, s.factorId, code);
  if (!r.ok) return { error: textFor(r.reason) };
  applySessionCookies(await cookies(), r.value);
  redirect(safeNext(field(fd, "next")));
}
