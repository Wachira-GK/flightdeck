import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AA,
  contrastRatio,
  extractColorVars,
  floor2,
  parseHex,
  relativeLuminance,
} from "../src/tokens/contrast";
import { TOKEN_PAIRS } from "../src/tokens/pairs";

const css = readFileSync(fileURLToPath(new URL("../src/tokens/tokens.css", import.meta.url)), "utf8");

const themes = {
  light: extractColorVars(css, ":root"),
  dark: extractColorVars(css, ':root[data-theme="dark"]'),
} as const;

describe("contrast maths (WCAG 2.2 reference values)", () => {
  it("parses short and long hex", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#0a6680")).toEqual({ r: 10, g: 102, b: 128 });
    expect(() => parseHex("rgb(0,0,0)")).toThrow();
  });

  it("computes luminance and ratio extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("matches the known #767676-on-white threshold (~4.54:1)", () => {
    expect(floor2(contrastRatio("#767676", "#ffffff"))).toBe(4.54);
  });
});

describe("token file integrity", () => {
  it("prefers-color-scheme dark block equals the explicit data-theme dark block", () => {
    expect(extractColorVars(css, ':root:not([data-theme="light"])')).toEqual(themes.dark);
  });

  it("light and dark define the same colour tokens", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("every token referenced by a pair exists", () => {
    for (const vars of Object.values(themes)) {
      for (const p of TOKEN_PAIRS) {
        expect(vars[p.fg], p.fg).toBeDefined();
        expect(vars[p.bg], p.bg).toBeDefined();
      }
    }
  });

  it("respects prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/--fd-duration-base:\s*0ms/);
  });
});

describe("WCAG 2.2 AA contrast for every token pair", () => {
  const rows: { theme: string; fg: string; bg: string; ratio: number; min: number; pass: boolean }[] = [];

  for (const [theme, vars] of Object.entries(themes)) {
    for (const p of TOKEN_PAIRS) {
      it(`${theme}: ${p.fg} on ${p.bg} >= ${AA[p.level]}:1 (${p.usage})`, () => {
        const ratio = floor2(contrastRatio(vars[p.fg] as string, vars[p.bg] as string));
        const min = AA[p.level];
        rows.push({ theme, fg: p.fg, bg: p.bg, ratio, min, pass: ratio >= min });
        expect(ratio).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it("reports the minimum ratio per threshold", () => {
    const text = rows.filter((r) => r.min === AA.text);
    const ui = rows.filter((r) => r.min === AA.ui);
    const minOf = (xs: typeof rows) => xs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    const minText = minOf(text);
    const minUi = minOf(ui);
    console.info(
      `[contrast] ${rows.length} pairs checked. Min text ratio ${minText.ratio}:1 (${minText.theme} ${minText.fg} on ${minText.bg}); ` +
        `min UI ratio ${minUi.ratio}:1 (${minUi.theme} ${minUi.fg} on ${minUi.bg}).`,
    );
    expect(rows.every((r) => r.pass)).toBe(true);
  });
});
