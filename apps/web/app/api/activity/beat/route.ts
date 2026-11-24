import { NextResponse, type NextRequest } from "next/server";
import { recordBeat } from "@/server/activity";
import { currentUserId } from "@/server/current-user";

// "This learner is active on this mission" (ADR-012). Always answers 204 and never reveals whether it counted, so it
// cannot be used to probe anything. The who is the VERIFIED session user, never anything in the request body. The database
// credits time no faster than the clock runs, so repeated calls cannot inflate it. Requests from other websites are ignored.
export const dynamic = "force-dynamic";

const quiet = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return quiet();
  let slug = "";
  let seconds = 0;
  try {
    const body = (await request.json()) as { slug?: unknown; seconds?: unknown };
    slug = typeof body.slug === "string" ? body.slug.slice(0, 120) : "";
    seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? body.seconds : 0;
  } catch {
    return quiet();
  }
  const userId = await currentUserId();
  if (userId && slug) await recordBeat(userId, slug, seconds);
  return quiet();
}
