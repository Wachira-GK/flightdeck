// SERVER-ONLY. Saves a learner's graded work through the two service_role-only database functions
// (migration 20261115000700, ADR-008). Uses the SERVICE ROLE key, which bypasses row-level security, so:
//   - import this module only from route handlers / server code, never from components/ or "use client" files
//     (scripts/check-key-leak.mjs fails the build if the key reaches .next/static);
//   - call it only AFTER the signed-in user has been verified and the answers graded on the server;
//   - the user id passed in must come from the verified session, never from the request body.
// Saving is best-effort: grading always works; a save problem never changes the learner's result.

export interface SaveOutcome {
  saved: boolean;
  /** Why nothing was saved: signed_out | not_configured | attempt_limit | attempt_cap | unknown_* | unavailable | error */
  reason?: string;
}

export interface ProgressConfig {
  url: string;
  serviceKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** null when the server has no service key (saving is then switched off, e.g. local dev without secrets). */
export function progressConfig(): ProgressConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
}

async function rpc(cfg: ProgressConfig, fn: string, args: Record<string, unknown>): Promise<SaveOutcome> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.serviceKey,
        authorization: `Bearer ${cfg.serviceKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 5000),
      cache: "no-store",
    });
    if (!res.ok) return { saved: false, reason: "error" };
    const json = (await res.json()) as { saved?: unknown; reason?: unknown } | null;
    if (json?.saved === true) return { saved: true };
    return { saved: false, reason: typeof json?.reason === "string" ? json.reason : "error" };
  } catch {
    return { saved: false, reason: "unavailable" }; // never leak the cause (it could contain the host name)
  }
}

export function recordAssessment(
  cfg: ProgressConfig | null,
  userId: string,
  missionSlug: string,
  score: number,
  passed: boolean,
): Promise<SaveOutcome> {
  if (!cfg) return Promise.resolve({ saved: false, reason: "not_configured" });
  return rpc(cfg, "fd_record_assessment", { p_user: userId, p_mission_slug: missionSlug, p_score: score, p_passed: passed });
}

export function recordExercise(
  cfg: ProgressConfig | null,
  userId: string,
  exerciseSlug: string,
  submission: unknown,
  passed: boolean,
  score: number,
  validatorVersion: string,
): Promise<SaveOutcome> {
  if (!cfg) return Promise.resolve({ saved: false, reason: "not_configured" });
  return rpc(cfg, "fd_record_exercise", {
    p_user: userId,
    p_exercise_slug: exerciseSlug,
    p_submission: submission,
    p_passed: passed,
    p_score: score,
    p_validator: validatorVersion,
  });
}
