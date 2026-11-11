// SERVER-ONLY. Imports answer keys; never import this module from a client component.
// The key-leak scan (scripts/scan-secrets.mjs) fails the build if key values reach .next/static.
import { gradeMathAssessment, type AssessmentResult, type MathMission, type MathMissionKeys } from "@flightdeck/math";
import mission from "../../../content/math/missions/descriptive-stats-101.json";
import keys from "../../../content/math/missions/descriptive-stats-101.keys.json";

const MISSIONS: Record<string, { mission: MathMission; keys: MathMissionKeys }> = {
  "descriptive-stats-101": { mission: mission as unknown as MathMission, keys: keys as unknown as MathMissionKeys },
};

export const MAX_BODY_BYTES = 16 * 1024;

export type HandlerResponse = { status: number; body: AssessmentResult | { error: string } };

export type ParsedAnswers = { ok: true; answers: Record<string, unknown> } | { ok: false; response: HandlerResponse };

/** Shared by the Maths and Excel handlers: content type, size cap, JSON shape. */
export async function parseAnswersRequest(request: Request): Promise<ParsedAnswers> {
  const fail = (status: number, error: string): ParsedAnswers => ({ ok: false, response: { status, body: { error } } });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "Send JSON.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return fail(413, "Request too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, "Request too large.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(400, "Malformed JSON.");
  }
  const answers = (parsed as { answers?: unknown })?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return fail(400, "Expected { answers: { [itemId]: string } }.");
  }
  return { ok: true, answers: answers as Record<string, unknown> };
}

export function hasMathAssessment(slug: string): boolean {
  return Object.hasOwn(MISSIONS, slug);
}

/** Pure request handler so it can be unit-tested without a server. */
export async function handleMathAssessment(slug: string, request: Request): Promise<HandlerResponse> {
  if (!hasMathAssessment(slug)) return { status: 404, body: { error: "Unknown mission." } };
  const parsed = await parseAnswersRequest(request);
  if (!parsed.ok) return parsed.response;
  const entry = MISSIONS[slug]!;
  return { status: 200, body: gradeMathAssessment(entry.mission, entry.keys, parsed.answers) };
}

/** Kept for existing callers and tests: Maths missions only. The route uses ./assessment. */
export const handleAssessment = handleMathAssessment;
