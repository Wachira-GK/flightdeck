import type { Submission, ValidationCheck } from "@flightdeck/excel-engine";

/** Body returned by POST /api/exercises/[id]/check (see apps/web/server/excel-check.ts). */
export interface ServerCheckResult {
  passed: boolean;
  score: number;
  checks: ValidationCheck[];
  validatorVersion: string;
  rejected?: { code: string; message: string };
}

export type ServerCheckOutcome =
  /** The server graded the sheet. */
  | { kind: "graded"; result: ServerCheckResult }
  /** The server refused the request (400/409/413/415): show the message, do not fall back. */
  | { kind: "refused"; message: string }
  /** The server could not be reached or is unavailable: fall back to the local practice check. */
  | { kind: "unavailable"; reason: string };

export interface ServerCheckOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  /** navigator.onLine; false skips the request. */
  online?: boolean;
  signal?: AbortSignal;
}

export function checkEndpointFor(exerciseId: string): string {
  return `/api/exercises/${encodeURIComponent(exerciseId)}/check`;
}

function isResult(v: unknown): v is ServerCheckResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.passed === "boolean" && typeof r.score === "number" && Array.isArray(r.checks);
}

/** Posts the submission to the server check endpoint and classifies the outcome. Never throws. */
export async function checkOnServer(submission: Submission, opts: ServerCheckOptions): Promise<ServerCheckOutcome> {
  if (opts.online === false) return { kind: "unavailable", reason: "You appear to be offline." };
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable", reason: "The server could not be reached." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && isResult(body)) return { kind: "graded", result: body };
  if (res.status === 404 || res.status >= 500 || res.ok) {
    return { kind: "unavailable", reason: "The server check is not available right now." };
  }
  const message =
    typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `The server refused the check (HTTP ${res.status}).`;
  return { kind: "refused", message };
}
