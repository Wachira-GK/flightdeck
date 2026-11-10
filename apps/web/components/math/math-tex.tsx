import "katex/dist/katex.min.css";
import { renderMath } from "@flightdeck/math";

type MathTexProps = {
  /** TeX source. Rendered with trust: false, so \href, \url and \html* commands stay inert. */
  tex: string;
  /** Block (centred, own line) instead of inline. */
  displayMode?: boolean;
  className?: string;
};

/**
 * KaTeX formula. Works as a Server Component (HTML is produced at render time, no client JS)
 * and inside client components such as <StatsExplorer>. KaTeX emits visual HTML (aria-hidden)
 * plus MathML, which screen readers announce.
 *
 * dangerouslySetInnerHTML is safe here only because renderMath runs KaTeX with trust: false and
 * KaTeX escapes all text; see packages/math/test/render.test.ts for the XSS tests.
 */
export function MathTex({ tex, displayMode = false, className }: MathTexProps) {
  const html = renderMath(tex, { displayMode });
  if (displayMode) {
    return <div className={["fd-math max-w-full overflow-x-auto", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span className={["fd-math", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: html }} />;
}
