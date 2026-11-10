/**
 * WCAG 2.2 contrast utilities (pure, dependency-free).
 * Formula: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 * Relative luminance: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

export type Rgb = { r: number; g: number; b: number };

/** Minimum ratios from WCAG 2.2 SC 1.4.3 (text) and SC 1.4.11 (non-text / UI). */
export const AA = {
  /** Body text (< 18pt regular / < 14pt bold). */
  text: 4.5,
  /** Large text (>= 18pt regular / >= 14pt bold). */
  largeText: 3,
  /** UI components, focus indicators and meaningful graphics. */
  ui: 3,
} as const;

export type ContrastLevel = keyof typeof AA;

export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Unsupported colour "${hex}": use #rgb or #rrggbb`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channel(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === "string" ? parseHex(color) : color;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Round down to 2 dp so a reported "4.50" never hides a true 4.499. */
export function floor2(n: number): number {
  return Math.floor(n * 100) / 100;
}

export function meets(ratio: number, level: ContrastLevel): boolean {
  return ratio >= AA[level];
}

/**
 * Extract `--name: #hex;` declarations from the first CSS block whose selector
 * text matches exactly. Only hex colours are collected; other tokens are ignored.
 */
export function extractColorVars(css: string, selector: string): Record<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(`(^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, "m");
  const match = blockRe.exec(withoutComments);
  if (!match) throw new Error(`Selector not found in CSS: ${selector}`);
  const body = match[2] ?? "";
  const vars: Record<string, string> = {};
  for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    vars[decl[1] as string] = (decl[2] as string).toLowerCase();
  }
  return vars;
}
