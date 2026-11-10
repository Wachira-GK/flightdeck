import katex from "katex";

/**
 * Server-safe KaTeX wrapper. Pure string in, HTML string out: no DOM, no window, so it runs in
 * React Server Components, the Cloudflare Worker and the browser alike.
 *
 * Security (see docs/architecture/MATH-RENDERER.md):
 * - trust: false      -> \href, \url, \includegraphics, \htmlClass, \htmlId, \htmlStyle, \htmlData
 *                        are NOT rendered as links/attributes; KaTeX shows them as inert error text.
 * - throwOnError:false -> bad TeX renders as escaped error text instead of crashing the page.
 * - strict: "warn"    -> non-standard input is logged, not rejected.
 * - maxSize / maxExpand -> caps on element size (em) and macro expansion (stops \def bombs).
 * - MAX_TEX_LENGTH    -> very long input is refused before it reaches the parser.
 */

export const MAX_TEX_LENGTH = 4000;
export const KATEX_MAX_SIZE_EM = 20;
export const KATEX_MAX_EXPAND = 500;

export type RenderMathOptions = { displayMode?: boolean };

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "warn",
  maxSize: KATEX_MAX_SIZE_EM,
  maxExpand: KATEX_MAX_EXPAND,
  // HTML for sighted users plus hidden MathML for screen readers.
  output: "htmlAndMathml",
  // Inherit the surrounding text colour so error text follows the design tokens.
  errorColor: "currentColor",
} as const;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMath(tex: string, options: RenderMathOptions = {}): string {
  const source = typeof tex === "string" ? tex : "";
  if (source.length > MAX_TEX_LENGTH) {
    return `<span class="katex-error" title="Formula too long">${escapeHtml(source.slice(0, 80))}…</span>`;
  }
  return katex.renderToString(source, { ...KATEX_OPTIONS, displayMode: options.displayMode ?? false });
}
