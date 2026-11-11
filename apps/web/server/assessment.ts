// SERVER-ONLY router for POST /api/missions/[slug]/assessment. Dispatches to the Mathematics
// handler (MA-101) or the Excel handler (EX-101/102/103); anything else is a 404.
import { handleExcelAssessment, hasExcelAssessment } from "./excel-assessment";
import { handleMathAssessment, hasMathAssessment, type HandlerResponse } from "./math-assessment";

export type { HandlerResponse };

export async function handleAssessment(slug: string, request: Request): Promise<HandlerResponse> {
  if (hasMathAssessment(slug)) return handleMathAssessment(slug, request);
  if (hasExcelAssessment(slug)) return handleExcelAssessment(slug, request);
  return { status: 404, body: { error: "Unknown mission." } };
}
