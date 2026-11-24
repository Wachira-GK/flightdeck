// Liveness probe. Reveals no configuration or secrets.
//   /api/health          -> the site is up.
//   /api/health?deep=1   -> also checks the database answers. Used by the scheduled keep-alive (ADR-014): the free Supabase
//                           plan pauses a project after about a week with no activity, and this keeps it awake and tells us
//                           (the scheduled job fails and GitHub emails the owner) if the database stops answering.
import { accessConfig, accessSummary } from "@/server/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const body: { status: string; service: string; time: string; db?: string } = { status: "ok", service: "flightdeck-web", time: new Date().toISOString() };
  let code = 200;
  if (new URL(request.url).searchParams.get("deep") === "1") {
    const cfg = accessConfig();
    if (!cfg) {
      body.db = "not_configured";
    } else {
      const ok = (await accessSummary(cfg, null)) !== null;
      body.db = ok ? "ok" : "down";
      if (!ok) {
        body.status = "degraded";
        code = 503;
      }
    }
  }
  return Response.json(body, { status: code, headers: { "Cache-Control": "no-store" } });
}
