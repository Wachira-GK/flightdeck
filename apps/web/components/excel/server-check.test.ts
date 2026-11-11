import { describe, expect, it } from "vitest";
import { checkEndpointFor, checkOnServer } from "./server-check";

const submission = { exerciseId: "sum-relative-refs", exerciseVersion: 1, cells: { B5: "=SUM(B2:B4)", C5: "" } };
const graded = { passed: false, score: 50, checks: [{ id: "structure", kind: "structure", passed: true, message: "ok" }], validatorVersion: "v" };

const fakeFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;

describe("checkOnServer", () => {
  it("builds an encoded endpoint", () => {
    expect(checkEndpointFor("xlookup-price-list")).toBe("/api/exercises/xlookup-price-list/check");
    expect(checkEndpointFor("a/b")).toBe("/api/exercises/a%2Fb/check");
  });

  it("posts JSON and returns the graded result", async () => {
    let seen: RequestInit | undefined;
    const f = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify(graded), { status: 200 });
    }) as typeof fetch;
    const out = await checkOnServer(submission, { endpoint: "/x", fetchImpl: f });
    expect(out).toEqual({ kind: "graded", result: graded });
    expect(seen?.method).toBe("POST");
    expect(new Headers(seen?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seen?.body))).toEqual(submission);
  });

  it("is unavailable when offline, without calling fetch", async () => {
    const f = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    expect((await checkOnServer(submission, { endpoint: "/x", fetchImpl: f, online: false })).kind).toBe("unavailable");
  });

  it("is unavailable on network errors, 404 and 5xx", async () => {
    const net = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect((await checkOnServer(submission, { endpoint: "/x", fetchImpl: net })).kind).toBe("unavailable");
    expect((await checkOnServer(submission, { endpoint: "/x", fetchImpl: fakeFetch(404, { error: "Unknown" }) })).kind).toBe("unavailable");
    expect((await checkOnServer(submission, { endpoint: "/x", fetchImpl: fakeFetch(503, "down") })).kind).toBe("unavailable");
    expect((await checkOnServer(submission, { endpoint: "/x", fetchImpl: fakeFetch(200, "<html>") })).kind).toBe("unavailable");
  });

  it("returns the server message when the request is refused", async () => {
    expect(await checkOnServer(submission, { endpoint: "/x", fetchImpl: fakeFetch(409, { error: "Reload the page" }) })).toEqual({
      kind: "refused",
      message: "Reload the page",
    });
    expect(await checkOnServer(submission, { endpoint: "/x", fetchImpl: fakeFetch(413, "nope") })).toEqual({
      kind: "refused",
      message: "The server refused the check (HTTP 413).",
    });
  });
});
