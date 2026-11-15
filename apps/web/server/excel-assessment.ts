// SERVER-ONLY. Loads the Excel mission answer keys (content/excel/missions/*.keys.json) and handles
// POST /api/missions/[slug]/assessment for Excel missions. Never import this module from a client
// component or from anything under components/ (server/excel-check.test.ts enforces that, and
// scripts/check-key-leak.mjs fails the build if rationale text reaches .next/static).
import type { ExcelMission, ExcelMissionKeys } from "../components/excel/missions";
import { MISSION_DEFINITIONS } from "../components/excel/registry.generated";
import { gradeExcelAssessment } from "./excel-assessment-grader";
import { MISSION_KEYS } from "./excel-registry.generated";
import { parseAnswersRequest, type HandlerResponse } from "./math-assessment";

// Built from the generated tables (scripts/gen-excel-registry.mjs): a mission is gradable when it has both
// its learner-safe definition and its server-only keys.
const MISSIONS: Record<string, { mission: ExcelMission; keys: ExcelMissionKeys }> = Object.fromEntries(
  Object.keys(MISSION_KEYS)
    .filter((slug) => Object.hasOwn(MISSION_DEFINITIONS, slug))
    .map((slug) => [slug, { mission: MISSION_DEFINITIONS[slug]!, keys: MISSION_KEYS[slug]! }]),
);
export const EXCEL_ASSESSMENT_SLUGS = Object.keys(MISSIONS);

export function hasExcelAssessment(slug: string): boolean {
  return Object.hasOwn(MISSIONS, slug);
}

/** Pure request handler so it can be unit-tested without a server. Nothing is persisted (Supabase paused). */
export async function handleExcelAssessment(slug: string, request: Request): Promise<HandlerResponse> {
  if (!hasExcelAssessment(slug)) return { status: 404, body: { error: "Unknown mission." } };
  const parsed = await parseAnswersRequest(request);
  if (!parsed.ok) return parsed.response;
  const { mission, keys } = MISSIONS[slug]!;
  return { status: 200, body: gradeExcelAssessment(mission, keys, parsed.answers) };
}
