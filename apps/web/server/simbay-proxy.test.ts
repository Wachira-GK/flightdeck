import { describe, expect, it } from "vitest";
import type { SessionState } from "./auth/session";
import { cleanPath, proxySimBay, type SimBayBinding } from "./simbay-proxy";

const ORIGIN = "https://fd.test";
const signedIn = (extra: Partial<Extract<SessionState, { status: "signed-in" }>> = {}): SessionState =>
  ({ status: "signed-in", user: { id: "u1", email: "a@b.c" } as never, accessToken: "TOKEN-1", aal: "aal1", factorId: null, ...extra }) as SessionState;

function setup(session: SessionState) {
  const seen: Request[] = [];
  const binding: SimBayBinding = { fetch: async (r) => { seen.push(r); return new Response("ok", { status: 200, headers: { "set-cookie": "x=1", "content-type": "text/html" } }); } };
  const run = (path: string[] | undefined, init: RequestInit = {}, url = `${ORIGIN}/simbay`) => proxySimBay(new Request(url, init), path, { binding, session: async () => session });
  return { seen, run };
}

describe("Sim Bay proxy", () => {
  it("SBP-01 path checks refuse dots, encoded dots/slashes and odd characters", () => {
    expect(cleanPath(undefined)).toBe("/");
    expect(cleanPath(["assets", "a.js"])).toBe("/assets/a.js");
    for (const bad of [["..", "x"], [".", "x"], ["a%2fb"], ["%2e%2e"], ["a\\b"], [""], ["a b"], ["x%00"]]) expect(cleanPath(bad)).toBeNull();
  });

  it("SBP-02 the page entry sends anonymous visitors to sign-in and back; 2-step and refresh have their own pages", async () => {
    const anon = await setup({ status: "anonymous" }).run(undefined, {}, `${ORIGIN}/simbay?from=/missions/x`);
    expect(anon.status).toBe(307);
    expect(anon.headers.get("location")).toBe(`${ORIGIN}/sign-in?next=${encodeURIComponent("/simbay?from=/missions/x")}`);
    expect((await setup({ status: "needs-refresh" }).run(undefined)).headers.get("location")).toContain("/auth/refresh?next=");
    expect((await setup(signedIn({ factorId: "f1", aal: "aal1" })).run(undefined)).headers.get("location")).toContain("/mfa?next=");
  });

  it("SBP-03 signed in: the proxy adds the token itself and drops the browser's Authorization and Cookie", async () => {
    const t = setup(signedIn());
    const res = await t.run(["api", "me"], { headers: { authorization: "Bearer EVIL", cookie: "fd-at=secret" } }, `${ORIGIN}/simbay/api/me`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const up = t.seen[0]!;
    expect(up.headers.get("authorization")).toBe("Bearer TOKEN-1");
    expect(up.headers.get("cookie")).toBeNull();
    expect(up.headers.get("x-fd-via")).toBe("flightdeck");
    expect(new URL(up.url).pathname).toBe("/api/me");
  });

  it("SBP-04 a 2-step user who has not confirmed a code is treated as signed out by the API; anonymous gets no token", async () => {
    const a = setup(signedIn({ factorId: "f1", aal: "aal1" }));
    await a.run(["api", "me"], { headers: { authorization: "Bearer EVIL" } }, `${ORIGIN}/simbay/api/me`);
    expect(a.seen[0]!.headers.get("authorization")).toBeNull();
    const b = setup({ status: "anonymous" });
    await b.run(["api", "health"], {}, `${ORIGIN}/simbay/api/health`);
    expect(b.seen[0]!.headers.get("authorization")).toBeNull();
    const c = setup(signedIn({ factorId: "f1", aal: "aal2" }));
    await c.run(["api", "me"], {}, `${ORIGIN}/simbay/api/me`);
    expect(c.seen[0]!.headers.get("authorization")).toBe("Bearer TOKEN-1");
  });

  it("SBP-05 POST needs this site's Origin; other methods are refused", async () => {
    const t = setup(signedIn());
    const body = JSON.stringify({ a: 1 });
    const post = (origin?: string) => t.run(["api", "events"], { method: "POST", body, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } }, `${ORIGIN}/simbay/api/events`);
    expect((await post()).status).toBe(403);
    expect((await post("https://evil.test")).status).toBe(403);
    expect((await post(ORIGIN)).status).toBe(200);
    expect((await t.run(["api", "x"], { method: "PUT", body }, `${ORIGIN}/simbay/api/x`)).status).toBe(405);
    expect((await t.run(["api", "x"], { method: "DELETE" }, `${ORIGIN}/simbay/api/x`)).status).toBe(405);
  });

  it("SBP-06 static files need no sign-in; API answers are never cached; missing binding gives 503", async () => {
    const t = setup({ status: "anonymous" });
    expect((await t.run(["assets", "app.js"], {}, `${ORIGIN}/simbay/assets/app.js`)).status).toBe(200);
    expect((await t.run(["api", "health"], {}, `${ORIGIN}/simbay/api/health`)).headers.get("cache-control")).toBe("no-store");
    const none = await proxySimBay(new Request(`${ORIGIN}/simbay/x`), ["x"], { binding: undefined, session: async () => ({ status: "anonymous" }) });
    expect(none.status).toBe(503);
  });
});
