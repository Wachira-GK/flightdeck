import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, MAX_TEX_LENGTH, renderMath } from "../src";

// strict: "warn" logs to console.warn for non-LaTeX input; keep test output quiet but observable.
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

/** No live link, script, event handler or javascript: URL anywhere in the markup (outside escaped text). */
function expectInert(html: string) {
  expect(html).not.toMatch(/<a[\s>]/i);
  expect(html).not.toMatch(/\shref=/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img/i);
  expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i); // event-handler attribute inside a real tag
  expect(html).not.toMatch(/(href|src|xlink:href)="\s*javascript:/i);
}

describe("renderMath", () => {
  it("renders inline math with HTML plus MathML for screen readers", () => {
    const html = renderMath("\\bar{x} = \\frac{\\sum x_i}{n}");
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).not.toContain("katex-display");
  });
  it("renders display mode", () => {
    expect(renderMath("x^2", { displayMode: true })).toContain("katex-display");
  });
  it("does not throw on invalid TeX (throwOnError: false)", () => {
    const html = renderMath("\\frac{1}{");
    expect(html).toContain("katex-error");
  });
  it("handles non-string input defensively", () => {
    expect(() => renderMath(undefined as unknown as string)).not.toThrow();
  });
  it("refuses over-long input before parsing", () => {
    const html = renderMath("x".repeat(MAX_TEX_LENGTH + 1));
    expect(html).toContain("katex-error");
    expect(html.length).toBeLessThan(400);
  });
  it("is deterministic", () => {
    expect(renderMath("s = \\sqrt{2}")).toBe(renderMath("s = \\sqrt{2}"));
  });
});

describe("renderMath XSS safety (trust: false)", () => {
  it.each([
    ["\\href", "\\href{javascript:alert(1)}{click}"],
    ["\\href https", "\\href{https://evil.example}{click}"],
    ["\\url", "\\url{javascript:alert(1)}"],
    ["\\htmlClass", "\\htmlClass{evil-class}{x}"],
    ["\\htmlId", "\\htmlId{evil-id}{x}"],
    ["\\htmlStyle", "\\htmlStyle{background:url(javascript:alert(1))}{x}"],
    ["\\htmlData", "\\htmlData{foo=bar}{x}"],
    ["\\includegraphics", "\\includegraphics{https://evil.example/x.png}"],
  ])("%s is not rendered as live HTML", (_name, tex) => {
    const html = renderMath(tex);
    expectInert(html);
    expect(html).not.toMatch(/class="[^"]*evil-class/);
    expect(html).not.toMatch(/id="evil-id"/);
    expect(html).not.toMatch(/data-foo=/);
    expect(html).not.toMatch(/style="[^"]*background:url/);
  });
  it("escapes raw HTML inside \\text", () => {
    const html = renderMath("\\text{<script>alert(1)</script><img src=x onerror=alert(1)>}");
    expectInert(html);
    expect(html).toContain("&lt;script&gt;");
  });
  it("stops macro-expansion bombs (maxExpand)", () => {
    const start = Date.now();
    const html = renderMath("\\def\\a{\\a\\a}\\a");
    expect(html).toContain("katex-error");
    expect(Date.now() - start).toBeLessThan(2000);
  });
  it("caps element size (maxSize)", () => {
    const html = renderMath("\\rule{1000em}{1000em}");
    expect(html).not.toMatch(/style="[^"]*1000em/); // source text may appear in the MathML annotation, never in a style
  });
  it("escapeHtml escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
