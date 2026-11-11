import { handleAssessment } from "@/server/assessment";

// Grades a mission assessment (Mathematics MA-101 and Excel EX-101/102/103) on the server.
// Nothing is saved yet (attempt storage needs Supabase, which is paused).
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { status, body } = await handleAssessment(slug, request);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
