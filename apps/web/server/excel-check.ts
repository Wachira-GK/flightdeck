// SERVER-ONLY (imports excel-keys). Pure request handler for POST /api/exercises/[id]/check.
// Grades a learner's sheet with validateSubmission and the server-only key. Nothing is persisted:
// saving attempts and verdicts needs Supabase (paused), see docs/architecture/EXCEL-ENGINE.md §4.
import {
  MAX_SUBMISSION_BYTES,
  validateSubmission,
  type CheckKind,
  type RejectCode,
} from "@flightdeck/excel-engine";
import { getGradableExercise, type GradableExercise } from "./excel-keys";

export { MAX_SUBMISSION_BYTES };

/** A check that is safe to show the learner: no expected values, hidden inputs or test ids. */
export interface PublicCheck {
  id: string;
  kind: CheckKind;
  passed: boolean;
  message: string;
  cell?: string;
}

export interface CheckResponseBody {
  passed: boolean;
  score: number;
  checks: PublicCheck[];
  validatorVersion: string;
  /** Present when the server refused to grade the sheet as submitted. */
  rejected?: { code: RejectCode; message: string };
}

export type CheckHandlerResponse = { status: number; body: CheckResponseBody | { error: string } };

export type ExerciseLookup = (id: string) => GradableExercise | undefined;

/**
 * Rejections a normal learner can cause by typing in an editable cell: graded as a failed check
 * (200). Everything else means a tampered or broken client and is a 400.
 */
const LEARNER_REJECTIONS = new Set<RejectCode>(["disallowed_function", "unsupported_formula"]);

class BodyTooLarge extends Error {}

/** Reads the raw body as UTF-8, aborting as soon as it exceeds `max` bytes. */
async function readCappedText(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Handles one check request. `id` is the [id] route segment. Status codes: 404 unknown exercise,
 * 415 not JSON, 413 over 256 KB, 400 malformed or tampered, 409 stale exercise version, 200 graded.
 */
export async function handleCheck(
  id: string,
  request: Request,
  lookup: ExerciseLookup = getGradableExercise,
): Promise<CheckHandlerResponse> {
  const entry = lookup(id);
  if (!entry) return { status: 404, body: { error: "Unknown exercise." } };

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) return { status: 415, body: { error: "Send JSON (application/json)." } };

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SUBMISSION_BYTES) {
    return { status: 413, body: { error: "Submission is larger than 256 KB." } };
  }
  let text: string;
  try {
    text = await readCappedText(request, MAX_SUBMISSION_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLarge) return { status: 413, body: { error: "Submission is larger than 256 KB." } };
    return { status: 400, body: { error: "Body is not valid UTF-8." } };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "Malformed JSON." } };
  }
  if (
    !isPlainObject(data) ||
    typeof data.exerciseId !== "string" ||
    typeof data.exerciseVersion !== "number" ||
    !isPlainObject(data.cells)
  ) {
    return { status: 400, body: { error: "Expected { exerciseId, exerciseVersion, cells }." } };
  }
  if (data.exerciseId !== id) return { status: 400, body: { error: "exerciseId does not match the URL." } };
  if (data.exerciseVersion !== entry.exercise.version) {
    return { status: 409, body: { error: "This exercise has been updated. Reload the page and try again." } };
  }

  // Only the three contract fields reach the validator; anything else (passed, score, ...) is dropped.
  const submission = { exerciseId: data.exerciseId, exerciseVersion: data.exerciseVersion, cells: data.cells };
  const result = validateSubmission(entry.exercise, submission, entry.key);

  if (result.rejected) {
    const { code, message } = result.rejected;
    if (code === "too_large") return { status: 413, body: { error: "Submission is larger than 256 KB." } };
    if (code === "invalid_exercise") return { status: 500, body: { error: "Exercise is misconfigured." } };
    if (!LEARNER_REJECTIONS.has(code)) return { status: 400, body: { error: message } };
  }

  let hidden = 0;
  const checks: PublicCheck[] = result.checks.map((c) => ({
    // Hidden test ids come from the key; replace them with a counter.
    id: c.kind === "hidden" ? `hidden:${++hidden}` : c.id,
    kind: c.kind,
    passed: c.passed,
    message: c.message,
    ...(c.cell ? { cell: c.cell } : {}),
  }));
  return {
    status: 200,
    body: {
      passed: result.passed,
      score: result.score,
      checks,
      validatorVersion: result.validatorVersion,
      ...(result.rejected ? { rejected: result.rejected } : {}),
    },
  };
}
