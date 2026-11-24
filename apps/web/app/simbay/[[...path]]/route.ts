import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSession } from "@/server/auth/session";
import { proxySimBay, type SimBayBinding } from "@/server/simbay-proxy";

// /simbay/** is the Sim Bay spreadsheet simulator (a separate Worker reached through a service binding). All the rules
// (sign-in, two-step, origin check, path checks) live in server/simbay-proxy.ts.
export const dynamic = "force-dynamic";

async function handle(request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  let binding: SimBayBinding | undefined;
  try {
    binding = (getCloudflareContext().env as { SIMBAY?: SimBayBinding }).SIMBAY;
  } catch {
    binding = undefined;
  }
  return proxySimBay(request, path, { binding, session: readSession });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
