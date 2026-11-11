import { handleCheck } from "@/server/excel-check";

// Grades an Excel exercise on the server with its server-only key (default Node.js runtime; works
// under the OpenNext Cloudflare worker). Nothing is saved yet: attempt storage needs Supabase.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, body } = await handleCheck(id, request);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
