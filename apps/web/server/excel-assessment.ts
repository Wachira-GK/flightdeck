// SERVER-ONLY. Loads the Excel mission answer keys (content/excel/missions/*.keys.json) and handles
// POST /api/missions/[slug]/assessment for Excel missions. Never import this module from a client
// component or from anything under components/ (server/excel-check.test.ts enforces that, and
// scripts/check-key-leak.mjs fails the build if rationale text reaches .next/static).
import excelIf102 from "../../../content/excel/missions/excel-if-102.json";
import excelIf102Keys from "../../../content/excel/missions/excel-if-102.keys.json";
import excelLookup103 from "../../../content/excel/missions/excel-lookup-103.json";
import excelLookup103Keys from "../../../content/excel/missions/excel-lookup-103.keys.json";
import excelSum101 from "../../../content/excel/missions/excel-sum-101.json";
import excelSum101Keys from "../../../content/excel/missions/excel-sum-101.keys.json";
import type { ExcelMission, ExcelMissionKeys } from "../components/excel/missions";
import { gradeExcelAssessment } from "./excel-assessment-grader";
import { parseAnswersRequest, type HandlerResponse } from "./math-assessment";

const MISSIONS: Record<string, { mission: ExcelMission; keys: ExcelMissionKeys }> = {
  "excel-sum-101": { mission: excelSum101 as unknown as ExcelMission, keys: excelSum101Keys as unknown as ExcelMissionKeys },
  "excel-if-102": { mission: excelIf102 as unknown as ExcelMission, keys: excelIf102Keys as unknown as ExcelMissionKeys },
  "excel-lookup-103": { mission: excelLookup103 as unknown as ExcelMission, keys: excelLookup103Keys as unknown as ExcelMissionKeys },
};

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
