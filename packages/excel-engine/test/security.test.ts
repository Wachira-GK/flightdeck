import { describe, expect, it } from "vitest";
import { createWorkbook, evaluateSheet, parseFormula } from "../src";
import { code } from "./helpers";

/** Engine source files as raw text (bundled by Vite at test time; no fs access needed). */
const SOURCES = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const BANNED: [string, RegExp][] = [
  ["eval", /\beval\s*\(/],
  ["new Function", /new\s+Function\b/],
  ["Function constructor", /\bFunction\s*\(/],
  ["with statement", /\bwith\s*\(/],
  ["dynamic import", /\bimport\s*\(/],
  ["require", /\brequire\s*\(/],
  ["fetch", /\bfetch\b/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["WebSocket", /WebSocket/],
  ["EventSource", /EventSource/],
  ["storage", /localStorage|sessionStorage|indexedDB|caches\./],
  ["clipboard / navigator", /navigator\.|clipboard/i],
  ["timers", /\bsetTimeout\b|\bsetInterval\b/],
  ["Date", /\bDate\b/],
  ["Math.random", /Math\.random/],
  ["process / globalThis", /\bprocess\.|globalThis/],
];

describe("engine source is free of dynamic code, I/O and nondeterminism (CT5)", () => {
  it("found the engine sources", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(7);
  });
  for (const [file, raw] of Object.entries(SOURCES)) {
    it(`${file}`, () => {
      const src = stripComments(raw);
      for (const [label, re] of BANNED) expect(re.test(src), `${label} in ${file}`).toBe(false);
    });
  }
});

describe("hostile formulas are inert", () => {
  it.each([
    '=SUM(A1);fetch("https://evil.example")',
    "=constructor.constructor(\"return 1\")()",
    "=__proto__",
    '=IF(TRUE,"<script>alert(1)</script>","")',
    "=A1+eval(1)",
    "=process.exit(1)",
    "=import(\"x\")",
  ])("%s", (f) => {
    const wb = createWorkbook();
    wb.setCell("A2", f);
    const v = wb.getValue("A2");
    // Either an error value or plain data; never execution.
    expect(typeof v === "string" || code(v) !== undefined).toBe(true);
  });
  it("script-like text is just text", () => {
    expect(evaluateSheet({ A1: '="<img src=x onerror=alert(1)>"' }).A1).toBe("<img src=x onerror=alert(1)>");
  });
  it("prototype keys are not cells", () => {
    expect(evaluateSheet({ __proto__: "1", constructor: "=1" } as Record<string, string>).constructor).toMatchObject({
      error: "#REF!",
    });
    expect(() => parseFormula("=toString()")).toThrow();
  });
});
