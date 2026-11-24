import { handleAssessment } from "@/server/assessment";
import { accessConfig, missionAccess } from "@/server/access";
import { currentUserId } from "@/server/current-user";
import { progressConfig, recordAssessment, type SaveOutcome } from "@/server/progress";

// Grades a mission assessment (Mathematics MA-101 and Excel EX-101/102/103) on the server.
// When a learner is signed in, the graded attempt is also saved to their account (ADR-008). Saving is
// best-effort: the grade is always returned, with `saved` telling the page whether it was stored.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await currentUserId();
  // ADR-011: a mission that is locked or switched off is neither graded nor saved.
  const access = await missionAccess(accessConfig(), userId, slug);
  if (access !== "open") {
    return Response.json({ error: "mission_closed", reason: access }, { status: access === "error" ? 503 : 403, headers: { "Cache-Control": "no-store" } });
  }
  const { status, body } = await handleAssessment(slug, request, userId);

  if (status === 200 && "passed" in body) {
    let outcome: SaveOutcome = { saved: false, reason: "signed_out" };
    if (userId) outcome = await recordAssessment(progressConfig(), userId, slug, body.score, body.passed);
    return Response.json({ ...body, saved: outcome.saved, ...(outcome.reason ? { savedReason: outcome.reason } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
