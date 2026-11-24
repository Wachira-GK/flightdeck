// HLT-W01..W03: liveness and the deep (database) check used by the keep-alive (ADR-014).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const call = async (qs = "") => {
  const res = await GET(new Request(`https://x.test/api/health${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("HLT-W health", () => {
  it("HLT-W01 the plain probe is up and says nothing about configuration", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", service: "flightdeck-web" });
    expect(r.body.db).toBeUndefined();
  });

  it("HLT-W02 deep check with a working database says db ok", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ staff: false, free: [], disabled: [], unlocked: [] }), { status: 200 })));
    const r = await call("?deep=1");
    expect(r.status).toBe(200);
    expect(r.body.db).toBe("ok");
  });

  it("HLT-W03 deep check with the database down answers 503 so the keep-alive fails loudly", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    const r = await call("?deep=1");
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ status: "degraded", db: "down" });
  });
});
