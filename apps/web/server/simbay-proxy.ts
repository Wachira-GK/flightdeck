// SERVER-ONLY. Serves Sim Bay (the spreadsheet simulator, a separate Worker) to the browser under /simbay on this
// address, so it shares FlightDeck's sign-in (ADR-017). Rules:
//   - the browser never holds a token for Sim Bay: this proxy reads the HttpOnly sign-in cookie, checks it with
//     Supabase, and adds the Authorization header itself; any Authorization/Cookie header from the browser is dropped;
//   - someone who set up two-step sign-in must have confirmed a code (aal2) or Sim Bay sees them as signed out;
//   - POST must come from this site (Origin check), because the sign-in cookie is sent automatically;
//   - only GET, HEAD and POST pass; the page entry (/simbay) needs sign-in, static files do not;
//   - the path is validated (no "..", no encoded dots or slashes) before it is forwarded.
import type { SessionState } from "./auth/session";

export interface SimBayBinding {
  fetch(request: Request): Promise<Response>;
}
export interface ProxyDeps {
  binding: SimBayBinding | undefined;
  session: () => Promise<SessionState>;
}

const ALLOWED = new Set(["GET", "HEAD", "POST"]);
const FORWARD_HEADERS = ["accept", "accept-language", "content-type", "if-none-match", "range"];
const DROP_RESPONSE = new Set(["set-cookie", "transfer-encoding", "connection"]);
const SEGMENT_OK = /^[A-Za-z0-9._~@%!$&'()*+,;=:-]+$/;

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

/** A validated path ("/" or "/a/b") or null. Refuses dot segments, encoded dots/slashes, backslashes and empty segments. */
export function cleanPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return "/";
  for (const s of segments) {
    if (!s || s === "." || s === ".." || !SEGMENT_OK.test(s)) return null;
    if (/%2e|%2f|%5c|%00/i.test(s)) return null;
  }
  return "/" + segments.join("/");
}

export async function proxySimBay(request: Request, segments: string[] | undefined, deps: ProxyDeps): Promise<Response> {
  if (!ALLOWED.has(request.method)) return text(405, "Method not allowed.");
  const path = cleanPath(segments);
  if (path === null) return text(400, "Bad path.");
  if (!deps.binding) return text(503, "Sim Bay is not connected on this server.");
  const url = new URL(request.url);
  const isApi = path === "/api" || path.startsWith("/api/");

  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return text(403, "Cross-site request blocked.");
  }

  const s = await deps.session();
  const signedIn = s.status === "signed-in" && (!s.factorId || s.aal === "aal2");

  // The page itself needs a FlightDeck sign-in; the same sign-in page is used, then it comes back here.
  if (!isApi && path === "/") {
    if (!signedIn) {
      const next = encodeURIComponent(`/simbay${url.search}`);
      if (s.status === "signed-in") return Response.redirect(`${url.origin}/mfa?next=${next}`, 307);
      if (s.status === "needs-refresh") return Response.redirect(`${url.origin}/auth/refresh?next=${next}`, 307);
      if (s.status === "unavailable") return text(503, "Sign-in is unavailable. Try again shortly.");
      return Response.redirect(`${url.origin}/sign-in?next=${next}`, 307);
    }
  }

  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("x-fd-via", "flightdeck");
  if (isApi && signedIn && s.status === "signed-in") headers.set("authorization", `Bearer ${s.accessToken}`);

  const upstream = new Request(`https://sim-bay.internal${path}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === "POST" ? request.body : undefined,
    redirect: "manual",
    // @ts-expect-error duplex is required by the runtime for streamed request bodies
    duplex: "half",
  });
  let res: Response;
  try {
    res = await deps.binding.fetch(upstream);
  } catch {
    return text(502, "Sim Bay could not be reached. Please try again.");
  }
  const out = new Headers();
  res.headers.forEach((v, k) => {
    if (!DROP_RESPONSE.has(k.toLowerCase())) out.set(k, v);
  });
  if (isApi || path === "/") out.set("cache-control", "no-store");
  out.set("x-content-type-options", "nosniff");
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
}
