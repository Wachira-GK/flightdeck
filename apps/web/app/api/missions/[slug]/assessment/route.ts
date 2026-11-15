import { handleAssessment } from "@/server/assessment";
import { currentUserId } from "@/server/current-user";
import { progressConfig, recordAssessment, type SaveOutcome } from "@/server/progress";

// Grades a mission assessment (Mathematics MA-101 and Excel EX-101/102/103) on the server.
// When a learner is signed in, the graded attempt is also saved to their account (ADR-008). Saving is
// best-effort: the grade is always returned, with `saved` telling the page whether it was stored.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { status, body } = await handleAssessment(slug, request);

  if (status === 200 && "passed" in body) {
    let outcome: SaveOutcome = { saved: false, reason: "signed_out" };
    const userId = await currentUserId();
    if (userId) outcome = await recordAssessment(progressConfig(), userId, slug, body.score, body.passed);
    return Response.json({ ...body, saved: outcome.saved, ...(outcome.reason ? { savedReason: outcome.reason } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
