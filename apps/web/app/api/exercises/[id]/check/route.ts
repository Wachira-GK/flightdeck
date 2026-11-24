import { handleCheck } from "@/server/excel-check";
import { contentExercise } from "@/server/content-db";
import { getGradableExercise } from "@/server/excel-keys";
import { MISSION_DEFINITIONS } from "@/components/excel/registry.generated";
import { accessConfig, missionAccess } from "@/server/access";
import { currentUserId } from "@/server/current-user";
import { progressConfig, recordExercise, type SaveOutcome } from "@/server/progress";

// Grades an Excel exercise on the server with its server-only key (default Node.js runtime; works
// under the OpenNext Cloudflare worker). When a learner is signed in, the submission and the server's
// verdict are also saved to their account (ADR-008); `saved` tells the page whether that worked.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  // ADR-011: an exercise belongs to a mission; a locked or switched-off mission is neither checked nor saved.
  const fromDb = await contentExercise(id);
  const ownerSlug = fromDb?.slug ?? Object.values(MISSION_DEFINITIONS).find((m) => (m as { exerciseId?: string }).exerciseId === id)?.slug;
  if (ownerSlug) {
    const access = await missionAccess(accessConfig(), userId, ownerSlug);
    if (access !== "open") {
      return Response.json({ error: "mission_closed", reason: access }, { status: access === "error" ? 503 : 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  let graded: { submission: unknown; passed: boolean; score: number; validatorVersion: string } | undefined;
  const { status, body } = await handleCheck(id, request, (exId) => (fromDb ? { exercise: fromDb.exercise, key: fromDb.key } : getGradableExercise(exId)), (g) => {
    graded = g;
  });

  if (status === 200 && graded) {
    let outcome: SaveOutcome = { saved: false, reason: "signed_out" };
    if (userId) outcome = await recordExercise(progressConfig(), userId, id, graded.submission, graded.passed, graded.score, graded.validatorVersion);
    return Response.json({ ...body, saved: outcome.saved, ...(outcome.reason ? { savedReason: outcome.reason } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
