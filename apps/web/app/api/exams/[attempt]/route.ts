import { NextResponse } from "next/server";
import { currentUserId } from "@/server/current-user";
import { EXAM_FAILURE_TEXT, examCall, examConfig, getAttempt, gradePlan, hintAvailableFor, hintPayload, integrityFlags, UUID } from "@/server/exams";

// POST /api/exams/[attempt]  body: { action: "save" | "hint" | "finish", ... }
// The user comes from the verified session. The database owns the clock: saves after the deadline are refused and a late
// finish can never pass. The answer key never leaves the server; a finished attempt returns the score and topics only.
export const dynamic = "force-dynamic";

const MAX_BODY = 60_000;
const fail = (reason: keyof typeof EXAM_FAILURE_TEXT, status: number) => NextResponse.json({ ok: false, reason, message: EXAM_FAILURE_TEXT[reason] }, { status });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keeps only task-index keys with short string values. */
function cleanAnswers(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (/^\d{1,2}$/.test(k) && typeof val === "string") out[k] = val.slice(0, 64);
  return out;
}

export async function POST(request: Request, ctx: { params: Promise<{ attempt: string }> }) {
  const { attempt } = await ctx.params;
  if (!UUID.test(attempt)) return fail("not_found", 404);
  const userId = await currentUserId();
  if (!userId) return fail("signed_out", 401);
  if (!/^application\/json/i.test(request.headers.get("content-type") ?? "")) return fail("invalid_request", 415);
  const text = await request.text();
  if (text.length > MAX_BODY) return fail("invalid_request", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("invalid_request", 400);
  }
  if (!isObj(body) || typeof body.action !== "string") return fail("invalid_request", 400);
  const cfg = examConfig();

  if (body.action === "save") {
    const r = await examCall<{ secondsLeft: number }>(cfg, "fd_exam_save", { p_user: userId, p_attempt: attempt, p_answers: cleanAnswers(body.answers) });
    return r.ok ? NextResponse.json({ ok: true, secondsLeft: r.secondsLeft }) : fail(r.reason, r.reason === "not_found" ? 404 : 409);
  }

  const got = await getAttempt(cfg, userId, attempt);
  if (!got.ok) return fail(got.reason, got.reason === "not_found" ? 404 : 503);

  if (body.action === "hint") {
    const task = typeof body.task === "number" && Number.isInteger(body.task) ? body.task : -1;
    const t = got.plan.tasks[task];
    if (!t || !hintAvailableFor(t)) return fail("invalid_request", 400);
    const r = await examCall<{ charged: boolean; hintsLeft: number }>(cfg, "fd_exam_hint", { p_user: userId, p_attempt: attempt, p_task: task, p_hint: 0 });
    if (!r.ok) return fail(r.reason, 409);
    return NextResponse.json({ ok: true, hintsLeft: r.hintsLeft, hint: hintPayload(t) });
  }

  if (body.action === "finish") {
    if (got.status !== "in_progress") return fail("closed", 409);
    const answers = { ...cleanAnswers(got.answers), ...cleanAnswers(body.answers) };
    const result = gradePlan(got.plan, answers, got.passPct);
    const started = Date.parse(got.startedAt);
    const seconds = Number.isFinite(started) ? (Date.parse(got.now ?? "") - started) / 1000 : 0;
    const flags = integrityFlags({ seconds: Number.isFinite(seconds) ? seconds : 0, limitSeconds: 0, blurs: body.blurs, pastes: body.pastes, total: result.total });
    const r = await examCall<{ status: string; late: boolean; certificateNumber: string | null }>(cfg, "fd_exam_finish", {
      p_user: userId, p_attempt: attempt, p_answers: answers, p_flags: flags, p_result: result, p_holder: got.plan.holder ?? "",
    });
    if (!r.ok) return fail(r.reason, 409);
    // What comes back: pass/fail, a percentage and the topics to revisit. No question text, no right answers.
    return NextResponse.json({
      ok: true,
      status: r.status,
      late: r.late,
      passed: r.status === "passed",
      score: result.score,
      correct: result.correct,
      total: result.total,
      topics: r.status === "passed" ? [] : result.topics,
      certificateNumber: r.certificateNumber,
    });
  }
  return fail("invalid_request", 400);
}
