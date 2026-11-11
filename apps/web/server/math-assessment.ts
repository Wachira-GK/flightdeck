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

/** Pure request handler so it can be unit-tested without a server. */
export async function handleAssessment(slug: string, request: Request): Promise<HandlerResponse> {
  const entry = MISSIONS[slug];
  if (!entry) return { status: 404, body: { error: "Unknown mission." } };
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { status: 415, body: { error: "Send JSON." } };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { status: 413, body: { error: "Request too large." } };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { status: 413, body: { error: "Request too large." } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "Malformed JSON." } };
  }
  const answers = (parsed as { answers?: unknown })?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { status: 400, body: { error: "Expected { answers: { [itemId]: string } }." } };
  }
  return { status: 200, body: gradeMathAssessment(entry.mission, entry.keys, answers as Record<string, unknown>) };
}
