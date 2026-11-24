// SERVER-ONLY router for POST /api/missions/[slug]/assessment. Dispatches to the Mathematics
// handler (MA-101) or the Excel handler. Excel missions are graded from the database first (the learner's pinned
// published revision, ADR-015) and fall back to the built-in files when the database has nothing or is unreachable.
import { contentGrading } from "./content-db";
import { handleExcelAssessment, handleExcelAssessmentWith, hasExcelAssessment } from "./excel-assessment";
import { handleMathAssessment, hasMathAssessment, type HandlerResponse } from "./math-assessment";

export type { HandlerResponse };

export async function handleAssessment(slug: string, request: Request, userId: string | null = null): Promise<HandlerResponse> {
  if (hasMathAssessment(slug)) return handleMathAssessment(slug, request);
  const fromDb = await contentGrading(userId, slug);
  if (fromDb) return handleExcelAssessmentWith(fromDb, request);
  if (hasExcelAssessment(slug)) return handleExcelAssessment(slug, request);
  return { status: 404, body: { error: "Unknown mission." } };
}
