# Mathematics renderer and statistics engine (FD-MATH01)

Status: draft for human review. Owner: maths/front-end. Last verified: 11 Nov 2026.

| Piece | Location |
|---|---|
| Statistics, parsing, grading, KaTeX wrapper, mission types | `packages/math/src` (tests in `packages/math/test`) |
| React components | `apps/web/components/math` (`MathTex`, `StatsExplorer`, `NumericQuestion`, `MathMissionStep`) |
| Mission content | `content/math/missions/descriptive-stats-101.json` (client-safe) |
| Answer keys | `content/math/missions/descriptive-stats-101.keys.json` (**server-only**) |

## 1. Renderer choice: KaTeX, not MathJax

| | KaTeX 0.16 | MathJax 3 |
|---|---|---|
| Server rendering | `renderToString` is synchronous and pure, so it runs in RSC and the Cloudflare Worker | Needs an async adaptor (liteDOM) and a much larger bundle |
| Client cost | About 270 KB JS, used only where a client component renders maths | Larger, plus runtime typesetting |
| Layout shift | None: final HTML is in the server response | Typesets after load unless pre-rendered |
| Coverage | Everything our analyst curriculum needs (fractions, sums, roots, cases, matrices) | Wider coverage (rare LaTeX packages) |
| Accessibility | Emits MathML next to visual HTML | Built-in speech-rule engine and explorer (stronger) |

We chose KaTeX for speed, synchronous SSR and the Worker CPU budget. Revisit if we need MathJax's
speech explorer (see section 7).

**Styles and fonts are self-hosted.** `math-tex.tsx` imports `katex/dist/katex.min.css`. Next bundles the
CSS and the KaTeX `.woff2` fonts into `/_next/static`, so they load from `'self'` and satisfy the
production CSP (`style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`). No CDN. KaTeX uses inline
`style` attributes for layout, which `style-src 'unsafe-inline'` allows. Verified on a production build
(`next start`): four KaTeX fonts loaded from the same origin, no CSP violations in the console.

## 2. Security settings

`renderMath(tex, { displayMode })` in `packages/math/src/render.ts` is the only way the app renders TeX.

| Setting | Value | Why |
|---|---|---|
| `trust` | `false` | `\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\htmlStyle`, `\htmlData` render as inert text, never as links or attributes |
| `throwOnError` | `false` | Bad TeX shows as escaped error text instead of crashing a page |
| `strict` | `"warn"` | Non-standard input logs a warning; it is not rejected |
| `maxSize` | `20` (em) | Stops giant `\rule` / spacing denial of service |
| `maxExpand` | `500` | Stops macro bombs such as `\def\a{\a\a}\a` |
| `output` | `htmlAndMathml` | Visual HTML plus MathML for assistive tech |
| `errorColor` | `currentColor` | Error text follows the design tokens (no hard-coded colour) |
| Input length | `MAX_TEX_LENGTH = 4000` | Refused before parsing |

`MathTex` uses `dangerouslySetInnerHTML` with KaTeX output only. Never pass HTML into it, and never
concatenate learner input into TeX. Evidence: `packages/math/test/render.test.ts` (XSS suite: `\href`
with `javascript:` and `https:`, `\url`, all `\html*` commands, `\includegraphics`, raw `<script>` /
`<img onerror>` inside `\text`, macro bomb, oversize rule).

Answer keys: mission JSON must not contain answers. `validateMathMission` fails if fields such as
`expected`, `correctOptionId`, `answer` or `rationale` appear in a mission file, and a test enforces it.
Only server code may read `*.keys.json`. `apps/web/components/math/content.ts` imports the mission file only.

## 3. Accessibility approach

- **Formulas:** KaTeX HTML is `aria-hidden`; the generated MathML is what screen readers read. Every
  formula in content also has plain-language text nearby (`definition.text`, `math.alt`).
  In worked steps the plain-text sentence carries the meaning, so the TeX line under it is `aria-hidden`
  to avoid reading the same thing twice.
- **StatsExplorer chart:** `<svg role="img">` with an `aria-label` built by `describeChart()`, for example:
  "Bar chart: Store A ... 10 values from 132 to 312 pairs. Mean 162.5 pairs, median 147 pairs, range 180
  pairs, sample standard deviation 53.1 pairs. The mean is 15.5 pairs above the median."
- **Data table alternative:** a native `<details>` ("Show data table") with a captioned table of the
  current values and the four statistics. Native disclosure means it is keyboard operable without script.
- **Live region:** `aria-live="polite"`, `aria-atomic`. It speaks the new value and all four statistics
  450 ms after the last change, so holding an arrow key does not flood the reader. Nothing is announced on
  first load.
- **The control:** a native `<input type="range">` with a visible `<label>`, `aria-valuetext` ("312 pairs")
  and a hint that explains the keys (arrows, Page Up/Down, Home/End). Focus ring comes from the global
  `:focus-visible` rule.
- **Mean versus median:** told apart by line style (solid versus dashed) as well as colour (WCAG 1.4.1).
  The legend shows live values.
- **Colour:** only `var(--fd-*)` tokens. Every pair used (fg, fg-muted, accent on surface or surface-2;
  border-strong and accent as UI on surface) is already in `packages/ui/src/tokens/pairs.ts`, so the
  contrast gate covers light and dark.
- **Motion:** bar and line transitions use `--fd-duration-base`, which is `0ms` under
  `prefers-reduced-motion: reduce`, plus Tailwind `motion-reduce:transition-none`.
- **NumericQuestion:** labelled text input (`inputMode="decimal"`, not `type="number"`, so the browser
  locale never rewrites the value). Parse errors are linked through `aria-describedby` and
  `aria-invalid`. Feedback is in a polite live region. It is labelled "Practice check" and says it is not
  graded or saved.
- **Mobile:** viewBox 440 x 270 with 14-unit fonts (about 11 px in a 340 px column). Shared x-label prefixes
  move into an axis title ("Wk") through `axisLabels()`. Checked at 375 px: no horizontal page overflow.

## 4. Statistics definitions and conventions

All functions are pure and deterministic, never mutate input, and throw `MathInputError` (with `code`)
on an empty dataset, non-arrays, non-finite numbers (NaN, ±Infinity) or too few values.

| Function | Definition | Excel |
|---|---|---|
| `mean` | sum / n | AVERAGE |
| `median` | middle of sorted data; mean of the two middle values when n is even | MEDIAN |
| `modes` | all most-frequent values, ascending; `[]` when no value repeats | MODE.MULT (#N/A when none) |
| `min`, `max`, `range` | range = max - min | MIN, MAX |
| `populationVariance` / `populationStdDev` | sum of squared deviations / **n** | VAR.P / STDEV.P |
| `sampleVariance` / `sampleStdDev` | sum of squared deviations / **(n - 1)**; needs n >= 2 | VAR.S / STDEV.S |
| `percentileInc`, `quartileInc`, `quartiles` | see below | PERCENTILE.INC / QUARTILE.INC |
| `zScore(x, mean, sd)`, `zScores(values, kind)` | (x - mean) / sd; sd must be > 0 | STANDARDIZE |

**Population vs sample.** Names always say which one. Default display is the **sample** standard deviation
(STDEV.S), because a few weeks of sales are a sample of all weeks, and it is what analysts use in Excel.
A dataset can set `"spread": "population"`.

**Quartile method (Excel QUARTILE.INC).** Sort ascending. For p in [0, 1], position
h = (n - 1) x p (0-indexed), and the result is x[floor(h)] + (h - floor(h)) x (x[floor(h) + 1] - x[floor(h)]).
Q0 = min, Q2 = median, Q4 = max. Verified against Microsoft's documentation example
`{1,2,4,7,8,9,10,12}`: Q1 = 3.5, Q3 = 9.25. This is "method 7" (R default, NumPy `linear`). It is **not**
QUARTILE.EXC or the Tukey hinges taught in some textbooks; learners comparing with a calculator may see
different Q1/Q3.

**Rounding and display.** `roundTo` rounds half away from zero (so 1.005 becomes 1.01). `formatNumber` uses "."
and no thousands separator, never `toLocaleString`, so server and client output match.

## 5. Grading and tolerance rules

`gradeNumericAnswer({ expected, tolerance, answer, explain? | workedSteps? })` returns
`{ correct, status: "correct" | "incorrect" | "invalid", feedback, workedSteps[], parsed? }`.

**Parsing (`parseNumericAnswer`).**
- Accepted: `3.5`, `-3.5`, `+3.5`, `.5`, `5.`, and surrounding spaces. A leading Unicode minus `−` (U+2212),
  or an en dash or full-width minus from autocorrect, is treated as `-`.
- Rejected, each with a specific message: `3,5` and `1,234` ("use a dot for decimals, no thousands
  separators"), `1 234`, `50%`, `1e3`, empty input, text, `Infinity`/`NaN`, and anything over 32 characters.
- An invalid input is `status: "invalid"`. It is not counted as wrong and no worked steps are revealed.

**Tolerance.**
- `{ kind: "absolute", value: t }`: correct when |answer - expected| <= t.
- `{ kind: "relative", value: r }`: correct when |answer - expected| <= r x |expected| (r = 0.01 means 1%).
  When expected is 0, a relative tolerance accepts only 0, so use absolute for such items.
- A floating-point guard of 1e-9 x max(1, |expected|) is added, so 0.1 + 0.2 grades as 0.3.
- Tolerance must be finite and >= 0; relative must be <= 1.
- Authoring convention: "round to 1 dp" uses absolute 0.05; "round to 2 dp" uses absolute 0.01, which also
  accepts a neighbouring rounding; whole numbers use absolute 0.

**Feedback.** Incorrect answers say whether the answer is lower or higher than expected, and name common
mix-ups when the answer matches a sibling statistic within tolerance (mean and median; sample and
population standard deviation or variance; range and max; IQR and range). `workedSteps` are generated by
`explainStatistic()` from the **actual dataset**: sorted values, totals, positions, squared deviations, and
the n versus n - 1 divisor. Each step has plain text and optional TeX.

**Practice vs graded.** `NumericQuestion` is a **practice check**. It grades in the browser and derives the
expected value from the public dataset, so no key reaches the client. Assessment items are graded
server-side against `*.keys.json` with the same `gradeNumericAnswer` (planned; Supabase is paused).
`mission-content.test.ts` already runs every key through the grader.

## 6. Mission content (MISSION-SPEC v0.1)

`descriptive-stats-101.json`: Briefing (why analysts care), Training (mean, median, range, sample and
population standard deviation in KaTeX, plus a practice check), Simulation (StatsExplorer on Store A, with
the week 10 school-reopening outlier as the slider), Assessment (Store B data: mean, median and STDEV.S as
numeric items, plus one single-choice item), Debrief. `validateMathMission(mission, keys)` checks step order,
references, explorer datasets, answer leaks, and that every key's `expected` matches the statistic
computed from its dataset within tolerance.

Datasets are illustrative (realistic shape and volumes for a footwear store) and are **not** real Bata sales.

## 7. Needs human review

1. **Screen-reader pass of KaTeX MathML** with NVDA + Firefox/Chrome, JAWS, VoiceOver (macOS and iOS) and
   TalkBack: check how `\bar{x}`, `\tilde{x}`, `x_{(5)}`, `\sum` and the `cases` median are spoken. If
   speech is poor, consider adding `aria-label`s from `alt` text or evaluating MathJax's speech engine.
2. **Live-region verbosity and the 450 ms delay** on the StatsExplorer with real screen-reader users.
3. **axe / Playwright coverage:** components are not on a route yet, so the e2e a11y suite does not reach
   them. Add the mission page to `e2e/a11y.spec.ts` once it is integrated, in light and dark, with reduced
   motion.
4. **Pedagogy:** the sample (STDEV.S) default; the "Wk" axis wording; tolerance for STDEV.S at 2 dp
   (±0.01); pass mark 0.75 (3 of 4 items).
5. **Display-mode formulas** wrap in `overflow-x-auto`. No overflow at 375 px today. If longer formulas
   are added, the scroll container may need `tabIndex={0}` and a label (axe `scrollable-region-focusable`).
6. **`strict: "warn"`** logs to the server console. Decide whether to route this to observability or
   switch to `"ignore"` in production.
7. **Bundle size:** KaTeX JS ships in the client chunk of `StatsExplorer` and `NumericQuestion` (live
   formulas). Measure it against the Worker and page budgets.
