import { describe, expect, it } from "vitest";
import { recordAssessment, recordExercise, type ProgressConfig } from "./progress";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fake(answer: { status: number; json?: unknown } | Error) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    if (answer instanceof Error) throw answer;
    return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status });
  }) as unknown as typeof fetch;
  const cfg: ProgressConfig = { url: "https://proj.supabase.co/", serviceKey: "SERVICE-KEY", fetch: f };
  return { cfg, calls };
}

describe("recordAssessment", () => {
  it("calls the service-only RPC with the verified user id and the server's verdict", async () => {
    const { cfg, calls } = fake({ status: 200, json: { saved: true, attemptNo: 2, passed: true } });
    expect(await recordAssessment(cfg, "u-1", "excel-sum-101", 90, true)).toEqual({ saved: true });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/rest/v1/rpc/fd_record_assessment");
    expect(calls[0]!.body).toEqual({ p_user: "u-1", p_mission_slug: "excel-sum-101", p_score: 90, p_passed: true });
    expect(calls[0]!.headers.apikey).toBe("SERVICE-KEY");
    expect(calls[0]!.headers.authorization).toBe("Bearer SERVICE-KEY");
  });

  it("passes the database's reason through (attempt limit)", async () => {
    const { cfg } = fake({ status: 200, json: { saved: false, reason: "attempt_limit" } });
    expect(await recordAssessment(cfg, "u-1", "excel-sum-101", 50, false)).toEqual({ saved: false, reason: "attempt_limit" });
  });

  it("is switched off without a service key and never calls out", async () => {
    expect(await recordAssessment(null, "u-1", "excel-sum-101", 90, true)).toEqual({ saved: false, reason: "not_configured" });
  });

  it("turns HTTP errors and network failures into a quiet 'not saved' without leaking the cause", async () => {
    expect(await recordAssessment(fake({ status: 500, json: { message: "boom" } }).cfg, "u", "m", 1, true)).toEqual({ saved: false, reason: "error" });
    expect(await recordAssessment(fake(new Error("connect ECONNRESET secret-host")).cfg, "u", "m", 1, true)).toEqual({ saved: false, reason: "unavailable" });
  });
});

describe("recordExercise", () => {
  it("sends the submission and the verdict to the exercise RPC", async () => {
    const { cfg, calls } = fake({ status: 200, json: { saved: true, passed: false } });
    const sub = { exerciseId: "sum-relative-refs", exerciseVersion: 1, cells: { B5: "=SUM(B2:B4)" } };
    expect(await recordExercise(cfg, "u-1", "sum-relative-refs", sub, false, 50, "v1")).toEqual({ saved: true });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/rest/v1/rpc/fd_record_exercise");
    expect(calls[0]!.body).toEqual({
      p_user: "u-1",
      p_exercise_slug: "sum-relative-refs",
      p_submission: sub,
      p_passed: false,
      p_score: 50,
      p_validator: "v1",
    });
  });
});
