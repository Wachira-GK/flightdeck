import { handleCheck } from "@/server/excel-check";
import { currentUserId } from "@/server/current-user";
import { progressConfig, recordExercise, type SaveOutcome } from "@/server/progress";

// Grades an Excel exercise on the server with its server-only key (default Node.js runtime; works
// under the OpenNext Cloudflare worker). When a learner is signed in, the submission and the server's
// verdict are also saved to their account (ADR-008); `saved` tells the page whether that worked.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let graded: { submission: unknown; passed: boolean; score: number; validatorVersion: string } | undefined;
  const { status, body } = await handleCheck(id, request, undefined, (g) => {
    graded = g;
  });

  if (status === 200 && graded) {
    let outcome: SaveOutcome = { saved: false, reason: "signed_out" };
    const userId = await currentUserId();
    if (userId) outcome = await recordExercise(progressConfig(), userId, id, graded.submission, graded.passed, graded.score, graded.validatorVersion);
    return Response.json({ ...body, saved: outcome.saved, ...(outcome.reason ? { savedReason: outcome.reason } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
