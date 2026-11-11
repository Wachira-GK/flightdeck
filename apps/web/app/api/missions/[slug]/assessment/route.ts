import { handleAssessment } from "@/server/math-assessment";

// Grades a mission assessment on the server. Nothing is saved yet (attempt storage needs Supabase).
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { status, body } = await handleAssessment(slug, request);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
