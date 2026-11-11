import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handleCheck, MAX_SUBMISSION_BYTES, type CheckResponseBody } from "./excel-check";
import { GRADABLE_EXERCISE_IDS } from "./excel-keys";
import { EXCEL_EXERCISE_IDS } from "@/components/excel/exercises";
import sumKey from "../../../content/excel/exercises/sum-relative-refs.key.json";
import ifKey from "../../../content/excel/exercises/if-business-thresholds.key.json";
import tierKey from "../../../content/excel/exercises/commission-tier-if-chain.key.json";
import xlpKey from "../../../content/excel/exercises/xlookup-price-list.key.json";

const post = (id: string, body: string, type = "application/json", headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/exercises/${id}/check`, {
    method: "POST",
    headers: { "content-type": type, ...headers },
    body,
  });

const sub = (exerciseId: string, cells: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ exerciseId, exerciseVersion: 1, cells, ...extra });

const XLP_SOLVED = Object.fromEntries(
  ["C2", "C3", "C4", "C5"].map((c) => [c, `=XLOOKUP(B${c.slice(1)},$E$2:$E$6,$G$2:$G$6,"Not listed")`]),
);

const body = (r: { body: unknown }) => r.body as CheckResponseBody;

describe("handleCheck: grading", () => {
  it("grades a solved sheet with 100", async () => {
    const r = await handleCheck("xlookup-price-list", post("xlookup-price-list", sub("xlookup-price-list", XLP_SOLVED)));
    expect(r.status).toBe(200);
    expect(body(r)).toMatchObject({ passed: true, score: 100 });
    expect(body(r).validatorVersion).toMatch(/^excel-validator@.+\+engine@0\.2\.0$/);
    expect(Object.keys(body(r)).sort()).toEqual(["checks", "passed", "score", "validatorVersion"]);
  });

  it("grades a typed-constant sheet as failed (hidden tests)", async () => {
    const r = await handleCheck("sum-relative-refs", post("sum-relative-refs", sub("sum-relative-refs", { B5: "358", C5: "287" })));
    expect(r.status).toBe(200);
    expect(body(r).passed).toBe(false);
    expect(body(r).checks.some((c) => c.kind === "hidden" && !c.passed)).toBe(true);
  });

  it("ignores client-claimed verdicts", async () => {
    const r = await handleCheck(
      "sum-relative-refs",
      post("sum-relative-refs", sub("sum-relative-refs", { B5: "1", C5: "1" }, { passed: true, score: 100 })),
    );
    expect(body(r)).toMatchObject({ passed: false });
    expect(body(r).score).toBeLessThan(100);
  });

  it("a disallowed function is a graded failure (200) with a rejection message", async () => {
    const r = await handleCheck("sum-relative-refs", post("sum-relative-refs", sub("sum-relative-refs", { B5: "=AVERAGE(B2:B4)", C5: "" })));
    expect(r.status).toBe(200);
    expect(body(r)).toMatchObject({ passed: false, score: 0, rejected: { code: "disallowed_function" } });
  });
});

describe("handleCheck: request errors", () => {
  it("404 for an unknown exercise", async () => {
    expect((await handleCheck("nope", post("nope", "{}"))).status).toBe(404);
    expect((await handleCheck("__proto__", post("x", "{}"))).status).toBe(404);
  });

  it("415 for a wrong content-type", async () => {
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", "a=1", "text/plain"))).status).toBe(415);
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", "{}", "application/jsonx"))).status).toBe(415);
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", sub("sum-relative-refs", {}), "application/json; charset=utf-8"))).status).toBe(200);
  });

  it("413 for an oversized body, by header or by streamed size", async () => {
    const big = sub("sum-relative-refs", { B5: "x".repeat(MAX_SUBMISSION_BYTES) });
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", big))).status).toBe(413);
    // A lying (small) content-length does not bypass the streamed cap.
    const lying = post("sum-relative-refs", big, "application/json", { "content-length": "10" });
    expect((await handleCheck("sum-relative-refs", lying)).status).toBe(413);
    const declared = post("sum-relative-refs", "{}", "application/json", { "content-length": String(MAX_SUBMISSION_BYTES + 1) });
    expect((await handleCheck("sum-relative-refs", declared)).status).toBe(413);
  });

  it("400 for malformed JSON or the wrong shape", async () => {
    for (const b of ["{oops", "[]", "null", '"x"', JSON.stringify({ exerciseId: "sum-relative-refs", exerciseVersion: 1 }), JSON.stringify({ exerciseId: "sum-relative-refs", exerciseVersion: "1", cells: {} }), JSON.stringify({ exerciseId: "sum-relative-refs", exerciseVersion: 1, cells: [] })]) {
      expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", b))).status, b).toBe(400);
    }
  });

  it("400 when the body names another exercise", async () => {
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", sub("if-business-thresholds", {})))).status).toBe(400);
  });

  it("409 for a stale exercise version", async () => {
    const b = JSON.stringify({ exerciseId: "sum-relative-refs", exerciseVersion: 99, cells: {} });
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", b))).status).toBe(409);
  });

  it("400 for tampered submissions (locked cells, bad refs, non-text cells)", async () => {
    const tampered: Record<string, string>[] = [{ B2: "1000" }, { $B$5: "1" }, { Z99: "1" }, { B5: 5 as unknown as string }];
    for (const cells of tampered) {
      const r = await handleCheck("sum-relative-refs", post("sum-relative-refs", sub("sum-relative-refs", cells)));
      expect(r.status, JSON.stringify(cells)).toBe(400);
    }
  });

  it("uses an injected lookup (pure)", async () => {
    expect((await handleCheck("sum-relative-refs", post("sum-relative-refs", "{}"), () => undefined)).status).toBe(404);
  });
});

describe("handleCheck: no key leaks", () => {
  const KEYS = { "sum-relative-refs": sumKey, "if-business-thresholds": ifKey, "commission-tier-if-chain": tierKey, "xlookup-price-list": xlpKey };

  it.each(Object.entries(KEYS))("%s: failed attempts reveal no expected values or hidden-test data", async (id, key) => {
    const r = await handleCheck(id, post(id, sub(id, {})));
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const t of key.hiddenTests) {
      expect(text).not.toContain(`"${t.id}"`);
      expect(text).not.toContain(`hidden:${t.id}`);
      for (const v of Object.values(t.overrides)) if (String(v).length >= 3) expect(text).not.toContain(String(v));
      for (const v of Object.values(t.expect)) if (String(v).length >= 3) expect(text, String(v)).not.toContain(String(v));
    }
    for (const e of key.expected) if (String(e.value).length >= 3) expect(text).not.toContain(String(e.value));
    expect(text).not.toMatch(/"computed"|"mode"|"expected"|"overrides"/);
  });
});

describe("server-only boundary", () => {
  it("every exercise is gradable", () => {
    expect([...GRADABLE_EXERCISE_IDS].sort()).toEqual([...EXCEL_EXERCISE_IDS].sort());
  });

  it("no client component or components/** module imports server/ or a key file", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
          const src = readFileSync(p, "utf8");
          const rel = relative(root, p).replace(/\\/g, "/");
          const isClient = /^\s*["']use client["']/.test(src) || rel.startsWith("components/");
          const importsServer = /from\s+["'](@\/server\/|(\.\.\/)+server\/)/.test(src);
          const importsKey = /\.keys?\.json["']/.test(src);
          if (isClient && (importsServer || importsKey)) offenders.push(rel);
        }
      }
    };
    walk(join(root, "components"));
    walk(join(root, "app"));
    expect(offenders).toEqual([]);
  });
});
