// Liveness probe used by the Cloudflare/Vercel hosting spike. Reveals no configuration or secrets.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "flightdeck-web", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
