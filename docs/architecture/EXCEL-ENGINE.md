# Excel simulator engine (FD-XLS01 spike)

Status: spike complete, for review. Package: `packages/excel-engine` (`@flightdeck/excel-engine`, zero runtime dependencies). Browser runtime: `apps/web/components/excel/`. Fixtures: `content/excel/exercises/`. Threat model: CT4, CT5, TB7 in `docs/security/THREAT-MODEL-v0.1.md`.

The simulator does **not** claim Microsoft Excel compatibility. It implements a small, documented subset with Excel-like semantics.

## 1. Supported subset (v0)

| Area | Supported |
|---|---|
| Literals | numbers (`12`, `1.5`, `.5`, `1E3`), text in double quotes (`"a ""quoted"" word"`), `TRUE` / `FALSE` |
| References | `A1`, `$A$1`, `A$1`, `$A1` (case-insensitive), ranges `A1:B5` (any corner order) |
| Operators | `+ - * / ^`, unary `-` / `+`, postfix `%`, `&`, `= <> < > <= >=`, parentheses |
| Functions | `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `IF` (case-insensitive) |
| Cell input | text starting with `=` is a formula; numbers, `12%`, `TRUE`/`FALSE` are typed; a leading `'` forces text; `""` clears |

Anything else is rejected with a clear message:

- Unknown functions (`XLOOKUP`, `VLOOKUP`, `NOW`, `INDIRECT`, ...), bare names, sheet refs, `A:A`, array constants, table refs, `@`, `;` separators, error literals → **`#NAME?`**.
- Malformed formulas (`=1+`, `=(1`, `=SUM()`, empty arguments, wrong arity) → **`#ERROR!`** (Excel refuses entry; we store an error value).

Precedence (high → low), as in Excel: range `:` → unary `-`/`+` → `%` → `^` (left-associative) → `* /` → `+ -` → `&` → comparisons. So `=-2^2` is **4** and `=2^3^2` is **64**. Both are Excel behaviours that surprise learners; course content should call them out.

## 2. Semantics

| Rule | Behaviour |
|---|---|
| Blank in arithmetic | 0 (`=A1+5` with A1 blank is 5; `=A1` shows 0) |
| Blanks/text/booleans in ranges | ignored by `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` |
| Direct arguments | coerced: `SUM("3", TRUE)` = 4; `SUM("abc")` = `#VALUE!` |
| `COUNT` | counts numbers only in refs/ranges; counts numeric direct args; **ignores errors** (as Excel) |
| `AVERAGE` with no numbers | `#DIV/0!` |
| `MIN`/`MAX` with no numbers | 0 (as Excel) |
| Text in arithmetic | `#VALUE!`, except numeric-looking text, which is coerced (see deviations) |
| Divide by zero | `#DIV/0!` (also `0^-1`) |
| Invalid number | `#NUM!` (`0^0`, `(-8)^(1/3)`, overflow such as `10^400`) |
| Errors | propagate; the leftmost operand's error wins |
| `IF` | lazy: only the chosen branch is evaluated; omitted false branch returns `FALSE`; condition accepts numbers, booleans, blank (FALSE) and `"TRUE"`/`"FALSE"` text |
| Comparisons | blanks take the other side's type; numbers < text < booleans; text is case-insensitive; text is **not** coerced (`="1"=1` is FALSE) |
| `&` | numbers use General format (15 significant digits, so `0.1+0.2&""` is `"0.3"`) |
| Circular references | every cell in the cycle gets **`#CIRC!`**; downstream cells inherit it; detection is static (an `IF` that would avoid the cycle does not hide it, matching Excel's check) |
| Display | General-like: up to 15 significant digits; scientific (`1E+15`, `1.5E-07`) at the extremes; `-0` shows `0` |
| Determinism | no `Date`, `Math.random`, timers or locale APIs; evaluation order is a stable topological order; same input → byte-identical output |

### Deviations from Excel (deliberate, documented)

1. **`#CIRC!`**: Excel shows 0 plus a warning bar; we return an explicit error so the validator and the learner both see it.
2. **`#LIMIT!`** and **`#ERROR!`** are FlightDeck-only error values (limits; malformed formulas).
3. **Numeric text coercion** covers plain decimal/scientific numbers with optional sign and `%` (`"3"`, `" 1.5e1 "`, `"50%"`). Thousands separators, currency and dates (`"1,000"`, `"$5"`, `"1/2/2026"`) are `#VALUE!`; Excel would coerce them in some locales. Chosen for locale-independent determinism.
4. **Ranges outside aggregates** (`=A1:A3`, `=IF(x, A1:A3, 0)`) are `#VALUE!`; no implicit intersection, no dynamic-array spilling.
5. **No number formats.** `4%` is stored and shown as `0.04`.
6. **Space is whitespace**, not the intersection operator.
7. **Empty arguments** (`=IF(A1,,1)`) are `#ERROR!`.
8. **Long operator chains count toward AST depth**: `=A1+A2+...+A31` (31 terms) exceeds depth 30 and is `#LIMIT!`; the message suggests `SUM`.
9. **Text results over 32,767 characters** are `#VALUE!` (Excel's cell limit), which also stops `&` doubling attacks.

## 3. Limits

All configurable via `createWorkbook(limits)` / `evaluateSheet(cells, limits)`. Any breach gives a typed `LimitError` (`limit: "grid" | "cells" | "astDepth" | "edges" | "formulaLength" | "stringLength"`) and/or a `#LIMIT!` cell value; never a crash or hang.

| Limit | Default | Behaviour |
|---|---|---|
| Grid | 100 rows × 30 cols (A1:AD100) | `setCell` outside → throws `LimitError`; a formula referring outside → `#LIMIT!` |
| Non-empty cells | 500 | 501st `setCell` throws `LimitError`; `evaluateSheet` marks the cell `#LIMIT!` (cells accepted in row-major order) |
| AST depth | 30 | checked while parsing (nesting) and on the final tree → `#LIMIT!` |
| Dependency edges | 5,000 | precedent cells with ranges expanded, de-duplicated per formula; expansion stops as soon as the budget is exceeded → `#LIMIT!` |
| Formula length | 1,024 chars (incl. `=`) | `#LIMIT!` |
| Text length | 32,767 chars | typed text → `#LIMIT!`; computed text → `#VALUE!` |
| Worker time | 500 ms hard timeout | main thread terminates the Worker (see §4) |
| Submission | 256 KB (UTF-8) | validator rejects `too_large` before parsing |

**Performance** (`test/perf.test.ts`, 500 non-empty cells, ~3,700 edges, mixed SUM/AVERAGE/IF/MAX/COUNT/`&` chains): full evaluation median **~10–30 ms** on the dev PC (target ≤ 100 ms; CI asserts < 400 ms). An incremental edit recalculates only dependents (25 cells, < 1 ms).

## 4. Architecture and security model

```
browser (untrusted)                                     server (trusted, later)
┌──────────────────────────────┐   submission JSON    ┌─────────────────────────────┐
│ <ExcelGrid> (main thread)    │ ───────────────────► │ validateSubmission(ex, sub, │
│  - 500 ms watchdog           │   cells only, ≤256KB │   key)  ← app_private.      │
│  - terminate + restart Worker│                      │   exercise_keys             │
│ engine.worker.ts (Worker)    │                      │ recompute from scratch,     │
│  - evaluateSheet             │                      │ hidden tests, verdict via   │
│  - practice validate         │                      │ record_exercise_verdict     │
└──────────────────────────────┘                      └─────────────────────────────┘
```

- **Own tokenizer + recursive-descent parser → AST → tree-walking evaluator.** No `eval`, `new Function`, `with`, dynamic `import()`, network, storage, clipboard, timers or `Date` in the engine. `test/security.test.ts` scans every engine source file for these and runs hostile formulas (`constructor.constructor(...)`, `fetch(...)`, `<script>` text) to show they are inert data. The web ESLint config also bans eval/Function.
- **Dependency graph**: each formula's precedents (ranges expanded) and a reverse dependents index. An edit collects the changed cell plus its transitive dependents, then runs an iterative Tarjan SCC over that subgraph: SCCs come out in topological order (precedents first); multi-cell SCCs and self-loops become `#CIRC!`. No recursion over cells, so long chains cannot overflow the stack.
- **Worker (TB7)**: `new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })`. Turbopack bundles it as a same-origin classic worker (`/_next/static/chunks/turbopack-worker-*.js`), which the production CSP (`worker-src 'self' blob:`, `script-src 'self' 'unsafe-inline'`) allows; verified with `next build && next start`. The Worker deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `WebTransport`, `EventSource`, `BroadcastChannel`, `indexedDB`, `caches` and `navigator` from its scope before handling messages (defence in depth). Messages are plain JSON. The Worker is stateless: each edit sends the whole sheet (≤ 500 cells), so a terminated Worker can be replaced with no state to rebuild.
- **Watchdog**: `engine-client.ts` arms a 500 ms timer per request (an exercise may set a lower `timeoutMs`, never higher). On expiry it calls `worker.terminate()`, rejects pending requests with `EngineTimeoutError`, and starts a fresh Worker on the next request. The grid shows an alert and keeps Reset available.
- **The client is untrusted.** Values computed in the browser are display only. The browser practice check is labelled "Practice check" and says the official result comes from the server. CT4: the client may insert a submission and evidence; `passed`/`score`/`status` are only written by the server after `validateSubmission`.

## 5. Validator design (`validateSubmission`)

`validateSubmission(exercise, submission, key?) → { passed, score 0–100, checks[], validatorVersion, mode, computed, rejected? }`

1. **Exercise integrity**: `checkExercise` (canonical keys, grid ≤ 100×30, allow-list ⊆ engine functions, no named ranges, key id/version match, hidden tests only override locked cells).
2. **Size first**: the raw string (preferred on the server) or the serialised object must be ≤ 256 KB of UTF-8, else `too_large`. Then shape: plain object, matching `exerciseId` + `exerciseVersion`, `cells` a plain object of strings. Every other field (`passed`, `score`, `values`, ...) is ignored, never trusted.
3. **Cell rules** → rejection codes: invalid key (`$B$5`, `B0`, `__proto__`) `invalid_ref`; duplicate key after normalisation `malformed`; outside the exercise grid `outside_grid`; changed non-editable cell `locked_cell` (resending the unchanged starter value is allowed); function outside the exercise allow-list `disallowed_function` (found by tokenising, so `=XLOOKUP(...)` is rejected even though it would only be `#NAME?`); unsupported syntax such as `Sheet2!A1` or `{1,2}` `unsupported_formula`.
4. **Recompute from scratch**: starter + learner cells → `evaluateSheet` with the exercise's limits. Learner mistakes (syntax errors, bare names, `#DIV/0!`, `#CIRC!`) are graded failures, not rejections.
5. **Checks** (weighted, default weight 1): `formula` (cell must start with `=`), `function` (e.g. B5 must use `SUM`), `value` (expected values: numbers with tolerance `1e-9 × max(1, |expected|)`, text case- and outer-space-insensitive unless `caseSensitive`, booleans, error codes), and `hidden` tests. A hidden test overrides locked input cells, recomputes and checks the outputs. This defeats typed constants (`358`) and hard-coded formulas (`=SUM(120,95,143)`), which match the visible values but fail every hidden test.
6. **Result**: `score = round(100 × passed weight / total weight)`; `passed = score ≥ passThreshold` (default 100). Messages never contain expected values or hidden inputs (tested). `validatorVersion` is `excel-validator@0.1.0+engine@0.1.0`; store it with each verdict so re-grading is reproducible.

Without a key (`mode: "structure-only"`), it runs steps 1–4 and checks only that editable cells are filled and error-free. Use this for the browser practice check in production.

**Exercise contract**: learner-safe `content/excel/exercises/<id>.json` (starter, editable cells, allowed functions, hints; safe to ship to the browser) and server-only `<id>.key.json` (expected values, required formulas/functions, hidden tests; for `app_private.exercise_keys`). See `content/excel/EXERCISE-SPEC.md`.

## 6. Lookup recommendation (open question: "XLOOKUP conditional on spike")

v0 ships **no lookup function**. The third starter exercise (`commission-tier-if-chain`) uses the documented substitute: a nested `IF` over a visible tier table with absolute references, `=IF(B2>=$F$4,$G$4,IF(B2>=$F$3,$G$3,$G$2))`. Hidden tests change the table's rates and thresholds, so typed rates fail.

Recommendation for v1:

- Add **`XLOOKUP(lookup, lookup_array, return_array, [if_not_found])` with exact match only** (match_mode 0, search_mode 1). It is a pure function over two same-shaped 1-D ranges, fits the existing range plumbing and edge accounting, needs a new `#N/A` error, and costs about a day plus tests. Reject any 5th/6th argument with `#NAME?`-style guidance.
- Defer approximate match (`match_mode -1/1`), wildcards, binary search and `VLOOKUP`/`INDEX`/`MATCH`. Approximate match is what tier tables need in real Excel; keep teaching it with the IF chain until a later version adds `XLOOKUP(..., -1)` with documented sorted-input rules.
- Do not return ranges from `XLOOKUP` (no spill) in v1.

## 7. Library decision (open decision: "exact Excel formula/grid library after spike")

This is a recommendation; the decision belongs to the product/architecture owner.

| Option | Licence | Fit | Risk |
|---|---|---|---|
| **Custom engine (this spike)** | ours | Exactly the allow-list; limits, determinism and error messages are first-class; ~2,000 lines incl. comments; zero runtime deps; same code runs in the Worker and on the server validator | We own correctness; every new function is our work |
| **HyperFormula** | GPL-3.0, or a paid commercial licence | ~400 functions, high Excel fidelity, undo/redo, named ranges | GPL is incompatible with a closed SaaS unless we buy the commercial licence; large bundle; allow-listing means disabling most of it; its limits/timeouts are not the shape the threat model needs; still needs our own validator |
| **formula.js** (`@formulajs/formulajs`) | MIT | Large set of Excel function implementations | Functions only: no parser, references, dependency graph or recalculation. Its functions accept JS values, so we would still need this spike's tokenizer, parser, graph and limits; some functions differ from Excel on edge cases |
| **fast-formula-parser** (MIT) and similar | MIT | Parser + functions | Smaller community; must still restrict and wrap |

**Recommendation: keep the custom engine for the Gate 3 courses**, grow it one function at a time behind the allow-list (each with Excel-semantics tests), and revisit when the course catalogue needs more than ~25 functions or full text/date functions. At that point, evaluate a HyperFormula commercial licence (fidelity) or borrow MIT formula.js implementations for individual functions inside our evaluator (keeping our parser, limits and validator). The security model (own parser, allow-list, Worker + watchdog, server recompute) stays the same in every option.

## 8. Using it

```ts
import { createWorkbook, evaluateSheet, parseFormula, validateSubmission } from "@flightdeck/excel-engine";

const wb = createWorkbook();            // or createWorkbook({ maxCells: 200 })
wb.setCell("B2", "120");
wb.setCell("B5", "=SUM(B2:B4)");        // returns { recalculated: ["B5"] }
wb.getValue("B5");                      // 120
wb.getDisplay("B5");                    // "120"
wb.snapshot();                          // { B2: 120, B5: 120 }

evaluateSheet({ A1: "2", A2: "=A1^2" }); // { A1: 2, A2: 4 }
validateSubmission(exercise, rawBody, key);
```

React (client): `import { ExcelGrid } from "@/components/excel";` then `<ExcelGrid exercise={exercise} />`. Pass `practiceKey` only while server grading is unavailable; it ships the answers to the browser.

## 9. Tests

- Engine: `pnpm --filter @flightdeck/excel-engine test` (parser, every function, semantics and coercion, error propagation, references, precedence, circular references, every limit, performance, determinism, security scan, validator acceptance/rejection, the 3 fixtures solved/unsolved).
- Grid helpers and Worker client: `pnpm --filter @flightdeck/web exec vitest run --config components/excel/vitest.config.ts`. To run them in the default web suite, add `"components/**/*.test.ts"` to `include` in `apps/web/vitest.config.ts`.
