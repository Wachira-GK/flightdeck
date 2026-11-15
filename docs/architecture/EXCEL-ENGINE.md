# Excel simulator engine (FD-XLS01 spike, v1)

Status: v1. Engine decision accepted in `docs/decisions/ADR-004-excel-engine.md` (keep the custom engine; exact-match `XLOOKUP` added). Engine version `0.3.0` (adds ROUND, ABS, AND, OR, NOT, IFERROR, MEDIAN, SUMIF/COUNTIF/AVERAGEIF/SUMIFS/COUNTIFS and LEN/LEFT/RIGHT/UPPER/LOWER/TRIM; see 2.2 and ADR-004 addendum). Package: `packages/excel-engine` (`@flightdeck/excel-engine`, zero runtime dependencies). Browser runtime: `apps/web/components/excel/`. Fixtures: `content/excel/exercises/`. Threat model: CT4, CT5, TB7 in `docs/security/THREAT-MODEL-v0.1.md`.

The simulator does **not** claim Microsoft Excel compatibility. It implements a small, documented subset with Excel-like semantics.

## 1. Supported subset (v1)

| Area | Supported |
|---|---|
| Literals | numbers (`12`, `1.5`, `.5`, `1E3`), text in double quotes (`"a ""quoted"" word"`), `TRUE` / `FALSE` |
| References | `A1`, `$A$1`, `A$1`, `$A1` (case-insensitive), ranges `A1:B5` (any corner order) |
| Operators | `+ - * / ^`, unary `-` / `+`, postfix `%`, `&`, `= <> < > <= >=`, parentheses |
| Functions (allow-list, 25) | Aggregates: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `MEDIAN`. Logic: `IF`, `AND`, `OR`, `NOT`, `IFERROR`. Numeric: `ROUND`, `ABS`. Conditional aggregates: `SUMIF`, `COUNTIF`, `AVERAGEIF`, `SUMIFS`, `COUNTIFS` (no wildcards). Lookup: `XLOOKUP` (exact match only). Text: `LEN`, `LEFT`, `RIGHT`, `UPPER`, `LOWER`, `TRIM`. Names are case-insensitive. Each exercise further restricts this with `allowedFunctions`; the list lives in one place, `SUPPORTED_FUNCTIONS` in `packages/excel-engine/src/parser.ts`. |
| Cell input | text starting with `=` is a formula; numbers, `12%`, `TRUE`/`FALSE` are typed; a leading `'` forces text; `""` clears |

Anything else is rejected with a clear message:

- Unknown functions (`VLOOKUP`, `MATCH`, `INDEX`, `NOW`, `INDIRECT`, ...), bare names, sheet refs, `A:A`, array constants, table refs, `@`, `;` separators, error literals → **`#NAME?`**.
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
| `XLOOKUP` | see §2.1 |
| Circular references | every cell in the cycle gets **`#CIRC!`**; downstream cells inherit it; detection is static (an `IF` that would avoid the cycle does not hide it, matching Excel's check) |
| Display | General-like: up to 15 significant digits; scientific (`1E+15`, `1.5E-07`) at the extremes; `-0` shows `0` |
| Determinism | no `Date`, `Math.random`, timers or locale APIs; evaluation order is a stable topological order; same input → byte-identical output |

### 2.1 `XLOOKUP` (v1, exact match only)

`XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])`

| Rule | Behaviour |
|---|---|
| Arrays | `lookup_array` and `return_array` must be cell references or ranges, each **1-D** (one row or one column; a single cell is 1x1), with the **same shape** (same rows and columns). Otherwise `#VALUE!` with a message. A vertical lookup with a horizontal return range of the same length is also `#VALUE!`. |
| Matching | exact match, first match wins (top to bottom / left to right). Text is **case-insensitive** (`"bt-100"` finds `"BT-100"`), as Excel. Numbers compare numerically (`1050`, `1000+50` and `1.05E3` all find `1050`). |
| Numbers vs numeric text | **no coercion**: the number `1050` does not match the text `"1050"` (typed `'1050`), and `"1050"` does not match the number. Same as Excel. Booleans only match booleans. |
| Blank lookup value | matches only a blank cell (not `0` or `""`). |
| Not found | `if_not_found` when given, else **`#N/A`** (new error value). `if_not_found` is evaluated **lazily**, only when nothing matches, so `=XLOOKUP(x, A:A, B:B, 1/0)` is fine when found. |
| Result | the matched `return_array` cell; a blank result shows `0` at the top level (as Excel). |
| Errors | an error in `lookup_value` propagates; errors inside `lookup_array` never match and are skipped; an error in the **matched** return cell is returned; errors in other return cells are ignored. |
| 5th/6th arguments | `match_mode` / `search_mode` parse but evaluate to `#VALUE!` with "supports exact match only". 2 or 7+ arguments are `#ERROR!` (arity). |
| Dependencies | the cell depends on every cell of both ranges (plus `lookup_value` and `if_not_found` refs); each counts toward the edge limit. Changing any table cell recalculates the lookup. |
| Not supported | approximate match, wildcards, binary search, reverse search, array results / spilling, `VLOOKUP`/`HLOOKUP`/`INDEX`/`MATCH`. Approximate-match tier tables are taught with the nested-`IF` exercise `commission-tier-if-chain`. |

### 2.2 Engine 0.3.0 functions

Signatures (`[x]` is optional). Wrong argument counts are `#ERROR!` (as for every function).

| Function | Semantics |
|---|---|
| `ROUND(number, digits)` | Half **away from zero** on the 15-significant-digit decimal value, so `ROUND(2.675,2)` = 2.68 and `ROUND(-2.5,0)` = -3 (as Excel). `digits` may be negative (`ROUND(21.5,-1)` = 20) and is truncated toward zero (`1.9` acts as 1, `-0.5` as 0). Text numbers and blanks are coerced; errors propagate; a range is `#VALUE!`. |
| `ABS(number)` | Absolute value; same coercion as arithmetic. |
| `AND(logical1, ...)`, `OR(logical1, ...)` | 1-255 arguments. Numbers (non-zero = TRUE) and booleans count. In **references/ranges** text and blanks are ignored; **direct** text must be `"TRUE"`/`"FALSE"`, else `#VALUE!`. No logical value at all is `#VALUE!`. **No short-circuit**: any error argument propagates (`AND(FALSE,1/0)` is `#DIV/0!`, as Excel). |
| `NOT(logical)` | Negation; blank is FALSE so `NOT(blank)` is TRUE; `"TRUE"`/`"FALSE"` text is accepted, other text `#VALUE!`. |
| `IFERROR(value, value_if_error)` | Returns `value` unless it is an error, then `value_if_error`, which is evaluated **lazily**. Catches **every** engine error value: `#DIV/0!`, `#VALUE!`, `#NUM!`, `#N/A`, `#NAME?` (a referenced cell holding an unknown function), `#REF!`, and the FlightDeck values `#CIRC!`, `#LIMIT!`, `#ERROR!` when they come from a referenced cell. Both arguments are dependencies, even when the fallback is not used. A cell that is itself in a circular reference stays `#CIRC!` (cycles are detected statically, so an `IFERROR` cannot rescue its own cycle). |
| `MEDIAN(number1, ...)` | Middle value (mean of the two middle values for an even count). Range rules like `AVERAGE` (text, blanks, booleans in references ignored; direct arguments coerced). No numbers is `#NUM!`; errors propagate. |
| `SUMIF(range, criteria, [sum_range])` | Sums `sum_range` (default `range`) where `range` meets `criteria`. Only numbers are summed. See criteria rules below. |
| `COUNTIF(range, criteria)` | Counts cells in `range` meeting `criteria`. |
| `AVERAGEIF(range, criteria, [average_range])` | Mean of the numeric cells of `average_range` (default `range`) whose row matches. **No matching numbers is `#DIV/0!`.** |
| `SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)` | Sums where **all** criteria match (up to 127 pairs, bounded by the 255-argument limit). Argument count must be odd (else `#ERROR!`). |
| `COUNTIFS(criteria_range1, criteria1, [criteria_range2, criteria2], ...)` | Counts rows where **all** criteria match. Argument count must be even (else `#ERROR!`). |
| `LEN(text)` | Number of characters (UTF-16 code units, as Excel). |
| `LEFT(text, [num_chars])`, `RIGHT(text, [num_chars])` | `num_chars` defaults to 1, is truncated toward zero, may exceed the length (whole text is returned), may be 0 (empty text); negative or non-numeric is `#VALUE!`. |
| `UPPER(text)`, `LOWER(text)` | Case change. A character whose upper/lower form has a different length is left unchanged (Excel's `UPPER("straße")` keeps the `ß`). |
| `TRIM(text)` | Strips leading and trailing spaces and collapses internal runs of spaces to one. Only the ordinary space (code 32) is affected; tabs and non-breaking spaces stay (as Excel). |

Text arguments accept numbers, which become text in General format (`LEN(0.1+0.2)` is 3: "0.3"), booleans (`"TRUE"`/`"FALSE"`) and blanks (`""`). A range in a text slot is `#VALUE!`. Text results over 32,767 characters are `#VALUE!` (the existing limit; the inputs can never exceed it).

**Criteria syntax** (SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS):

| Criteria | Matches |
|---|---|
| number (`100`, or a cell holding one) | numeric cells equal to it **and** numeric text equal to it (as Excel's COUNTIF: `5` also counts the text `"5"`) |
| text (`"Open"`) | text cells equal to it, **case-insensitively** |
| `"=x"`, `"<>x"` | equal / not equal. `<>` also matches blank cells, and error cells |
| `"<x"`, `"<="`, `">"`, `">="` | followed by a **number**: numeric cells only (text is not compared). Followed by **text**: text cells only, compared case-insensitively by character code (no locale collation) |
| `">="&B1` | build the criteria text with `&`; numbers use General format |
| `""` | blank cells and empty text. `"="` alone: truly blank cells only. `"<>"` alone: all non-blank cells |
| `TRUE` / `FALSE` (or text `"TRUE"`) | boolean cells (and text equal to it) |
| blank criteria cell | acts like 0 |
| error value as criteria | **propagates** (deviation: Excel would count matching error cells) |

Error cells inside a criteria range never match (except `<>`). An error in the `sum_range`/`average_range` cell of a **matching** row propagates; errors in non-matching rows are ignored. Matching uses plain comparisons: **no regular expression is ever built from criteria**, and the scan is bounded (see Limits).

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
10. **`XLOOKUP` is exact match only**: `match_mode`/`search_mode` give `#VALUE!` (Excel would accept them). `lookup_array` must be a reference/range, not an array expression.
11. **No wildcards in criteria (engine 0.3.0)**: in `SUMIF`/`COUNTIF`/`AVERAGEIF`/`SUMIFS`/`COUNTIFS`, `*`, `?` and `~` are **literal characters** (`COUNTIF(A1:A9,"a*")` counts only cells that are exactly `a*`). Excel would treat them as wildcards. Use `LEFT`/`RIGHT`/`LEN` helper columns for prefix/suffix tests.
12. **`SUMIF`/`AVERAGEIF` need `sum_range`/`average_range` to be the same size as `range`** (`#VALUE!` otherwise). Excel silently resizes from the top-left cell. All of `SUMIFS`/`COUNTIFS`'s ranges must also match in size (as Excel). All range arguments must be real cell references/ranges, not array expressions.
13. **An error value used as criteria propagates** instead of matching error cells.
14. **Criteria text comparison** (`"<m"`) is by lower-cased character code, not Excel's locale collation (locale-independent determinism).
15. **`ROUND`** works on the 15-significant-digit decimal form of the number (as Excel), not on the raw binary double.
16. **`IFERROR` cannot rescue a circular reference** it is part of (`#CIRC!` is detected before evaluation).
17. **`AND`/`OR` never short-circuit** (same as Excel) and ranges holding no logical value give `#VALUE!`.

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
| Submission | 256 KB (UTF-8) | check API reads the raw body with a streamed cap (413) before parsing; validator also rejects `too_large` |
| Conditional-aggregate scan | cells read by `SUMIF`/`COUNTIF`/`AVERAGEIF`/`SUMIFS`/`COUNTIFS` in **one formula**, counting every range argument (criteria ranges and sum range; repeated ranges count each time): 4 x the edge limit = 20,000 by default | `#LIMIT!` (message "calculation budget exceeded"); the fresh budget applies to each formula. Ranges still count toward the edge limit as dependencies |
| `XLOOKUP` ranges | 1-D, same shape; cells counted as dependency edges (5,000 total) | `#VALUE!`; `#LIMIT!` if the edge budget is exceeded |

**Performance** (`test/perf.test.ts`, 500 non-empty cells, ~3,700 edges, mixed SUM/AVERAGE/IF/MAX/COUNT/`&` chains): full evaluation median **~10–30 ms** on the dev PC (target ≤ 100 ms; CI asserts < 400 ms). An incremental edit recalculates only dependents (25 cells, < 1 ms).

## 4. Architecture and security model

```
browser (untrusted)                                     server (trusted)
┌──────────────────────────────┐ POST /api/exercises/ ┌─────────────────────────────┐
│ <ExcelGrid> (main thread)    │   [id]/check         │ server/excel-check.ts       │
│  - 500 ms watchdog           │ ───────────────────► │  handleCheck: 415/413/404/  │
│  - terminate + restart Worker│   cells only, ≤256KB │  400/409, then              │
│ engine.worker.ts (Worker)    │                      │  validateSubmission(ex, sub,│
│  - evaluateSheet             │ ◄─────────────────── │   key) ← server/excel-keys  │
│  - practice validate         │  passed, score,      │ recompute, hidden tests.    │
│    (offline fallback)        │  safe checks         │ NOT persisted yet (Supabase)│
└──────────────────────────────┘                      └─────────────────────────────┘
```

- **Own tokenizer + recursive-descent parser → AST → tree-walking evaluator.** No `eval`, `new Function`, `with`, dynamic `import()`, network, storage, clipboard, timers or `Date` in the engine. `test/security.test.ts` scans every engine source file for these and runs hostile formulas (`constructor.constructor(...)`, `fetch(...)`, `<script>` text) to show they are inert data. The web ESLint config also bans eval/Function.
- **Dependency graph**: each formula's precedents (ranges expanded) and a reverse dependents index. An edit collects the changed cell plus its transitive dependents, then runs an iterative Tarjan SCC over that subgraph: SCCs come out in topological order (precedents first); multi-cell SCCs and self-loops become `#CIRC!`. No recursion over cells, so long chains cannot overflow the stack.
- **Worker (TB7)**: `new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })`. Turbopack bundles it as a same-origin classic worker (`/_next/static/chunks/turbopack-worker-*.js`), which the production CSP (`worker-src 'self' blob:`, `script-src 'self' 'unsafe-inline'`) allows; verified with `next build && next start`. The Worker deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `WebTransport`, `EventSource`, `BroadcastChannel`, `indexedDB`, `caches` and `navigator` from its scope before handling messages (defence in depth). Messages are plain JSON. The Worker is stateless: each edit sends the whole sheet (≤ 500 cells), so a terminated Worker can be replaced with no state to rebuild.
- **Watchdog**: `engine-client.ts` arms a 500 ms timer per request (an exercise may set a lower `timeoutMs`, never higher). On expiry it calls `worker.terminate()`, rejects pending requests with `EngineTimeoutError`, and starts a fresh Worker on the next request. The grid shows an alert and keeps Reset available.
- **The client is untrusted.** Values computed in the browser are display only. CT4: the client may insert a submission and evidence; `passed`/`score`/`status` are only written by the server after `validateSubmission`.

### 4.1 Server check API (v1, no database)

- **Route**: `POST /api/exercises/[id]/check` (`apps/web/app/api/exercises/[id]/check/route.ts`, default Node.js runtime; plain Web `Request`/streams only, so it runs under the OpenNext Cloudflare worker). Logic is the pure `handleCheck(id, request, lookup?)` in `apps/web/server/excel-check.ts` (unit-tested in `server/excel-check.test.ts`).
- **Body**: `{ exerciseId, exerciseVersion, cells }` exactly as `buildSubmission` builds it. Any other field (`passed`, `score`, ...) is dropped before validation.
- **Order of checks**: unknown `[id]` → **404**; content-type not `application/json` → **415**; `Content-Length` over 256 KB, or the raw body streamed past 256 KB (read with a byte cap, *before* parsing) → **413**; invalid UTF-8/JSON or wrong shape, `exerciseId` ≠ `[id]`, tampered cells (`locked_cell`, `invalid_ref`, `outside_grid`, non-text cells) → **400**; stale `exerciseVersion` → **409** ("reload the page"); misconfigured exercise → **500**.
- **Response 200**: `{ passed, score, checks, validatorVersion }` plus `rejected` when the learner used a function outside the exercise allow-list or unsupported syntax (a graded failure, score 0). Checks contain only id, kind, pass/fail, message and cell. Hidden-test ids are replaced with `hidden:1..n`; `computed` and `mode` are not returned; messages never contain expected values or hidden inputs (tested per key file). `Cache-Control: no-store`.
- **Keys stay server-side**: learner-safe exercises are registered in `components/excel/exercises.ts`; keys only in `apps/web/server/excel-keys.ts` (static JSON imports). `server-only` is not installed (no new dependencies), so the guards are a unit test that fails if any `"use client"` file or anything under `components/` imports `server/` or a `*.key(s).json`, and `apps/web/scripts/check-key-leak.mjs`, which greps `.next/static` after a build for hidden-test labels/ids, long expected-check labels and mission-key rationales from every key file (with a positive control proving the scan reads the bundle).
- **Grid**: "Check my work" posts to the endpoint and shows "Checked by the server (not saved yet)". If the browser is offline, the request fails, or the server answers 404/5xx, it falls back to the local Worker practice check ("Practice check in your browser", structure-only without `practiceKey`) and says why. A 400/409/413/415 is shown as an error, with no fallback.
- **Nothing is persisted.** Saving attempts, evidence and verdicts (`record_exercise_verdict`, `app_private.exercise_keys`) needs Supabase, which is paused. When it returns, the route keeps the same contract and adds the insert after grading; keys move from static imports to `app_private.exercise_keys`.

## 5. Validator design (`validateSubmission`)

`validateSubmission(exercise, submission, key?) → { passed, score 0–100, checks[], validatorVersion, mode, computed, rejected? }`

1. **Exercise integrity**: `checkExercise` (canonical keys, grid ≤ 100×30, allow-list ⊆ engine functions, no named ranges, key id/version match, hidden tests only override locked cells).
2. **Size first**: the raw string (preferred on the server) or the serialised object must be ≤ 256 KB of UTF-8, else `too_large`. Then shape: plain object, matching `exerciseId` + `exerciseVersion`, `cells` a plain object of strings. Every other field (`passed`, `score`, `values`, ...) is ignored, never trusted.
3. **Cell rules** → rejection codes: invalid key (`$B$5`, `B0`, `__proto__`) `invalid_ref`; duplicate key after normalisation `malformed`; outside the exercise grid `outside_grid`; changed non-editable cell `locked_cell` (resending the unchanged starter value is allowed); function outside the exercise allow-list `disallowed_function` (found by tokenising, so `=XLOOKUP(...)` is rejected even though it would only be `#NAME?`); unsupported syntax such as `Sheet2!A1` or `{1,2}` `unsupported_formula`.
4. **Recompute from scratch**: starter + learner cells → `evaluateSheet` with the exercise's limits. Learner mistakes (syntax errors, bare names, `#DIV/0!`, `#CIRC!`) are graded failures, not rejections.
5. **Checks** (weighted, default weight 1): `formula` (cell must start with `=`), `function` (e.g. B5 must use `SUM`), `value` (expected values: numbers with tolerance `1e-9 × max(1, |expected|)`, text case- and outer-space-insensitive unless `caseSensitive`, booleans, error codes), and `hidden` tests. A hidden test overrides locked input cells, recomputes and checks the outputs. This defeats typed constants (`358`) and hard-coded formulas (`=SUM(120,95,143)`), which match the visible values but fail every hidden test.
6. **Result**: `score = round(100 × passed weight / total weight)`; `passed = score ≥ passThreshold` (default 100). Messages never contain expected values or hidden inputs (tested). `validatorVersion` is `excel-validator@0.1.0+engine@0.3.0`; store it with each verdict so re-grading is reproducible.

Without a key (`mode: "structure-only"`), it runs steps 1–4 and checks only that editable cells are filled and error-free. Use this for the browser practice check in production.

**Exercise contract**: learner-safe `content/excel/exercises/<id>.json` (starter, editable cells, allowed functions, hints; safe to ship to the browser) and server-only `<id>.key.json` (expected values, required formulas/functions, hidden tests; for `app_private.exercise_keys`). See `content/excel/EXERCISE-SPEC.md`.

## 6. Lookup (decided: ADR-004)

**Decision (accepted 2026-11-11):** v1 ships exact-match `XLOOKUP` (§2.1). Starter exercise `xlookup-price-list` uses it (unit prices from a product table; hidden tests change prices, reorder the table, add a listing and change the order codes). `commission-tier-if-chain` stays as the approximate-match alternative. The original spike analysis follows.

v0 shipped **no lookup function**. The third starter exercise (`commission-tier-if-chain`) uses the documented substitute: a nested `IF` over a visible tier table with absolute references, `=IF(B2>=$F$4,$G$4,IF(B2>=$F$3,$G$3,$G$2))`. Hidden tests change the table's rates and thresholds, so typed rates fail.

Recommendation for v1:

- Add **`XLOOKUP(lookup, lookup_array, return_array, [if_not_found])` with exact match only** (match_mode 0, search_mode 1). It is a pure function over two same-shaped 1-D ranges, fits the existing range plumbing and edge accounting, needs a new `#N/A` error, and costs about a day plus tests. Reject any 5th/6th argument with `#NAME?`-style guidance.
- Defer approximate match (`match_mode -1/1`), wildcards, binary search and `VLOOKUP`/`INDEX`/`MATCH`. Approximate match is what tier tables need in real Excel; keep teaching it with the IF chain until a later version adds `XLOOKUP(..., -1)` with documented sorted-input rules.
- Do not return ranges from `XLOOKUP` (no spill) in v1.

## 7. Library decision (decided: ADR-004, keep the custom engine)

Accepted 2026-11-11: keep the custom engine. The spike comparison is kept for the record.

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

React (client): `import { ExcelGrid } from "@/components/excel";` then `<ExcelGrid exercise={exercise} />`. "Check my work" calls `/api/exercises/<id>/check`; pass `checkEndpoint={null}` for local-only previews. Pass `practiceKey` only while server grading is unavailable; it ships the answers to the browser.

Missions (server component): `const excel = getExcelMission(slug); <ExcelMissionStep mission={excel} step={step} />`. Mission JSON lives in `content/excel/missions/<slug>.json` (blocks: `paragraph`, `list`, `formula`, `table`, `excel-grid`, `exercise-hints`, `assessment-items`); assessment keys in `<slug>.keys.json` are server-only. Types and `validateExcelMission` are in `components/excel/missions.ts`. Missions: `excel-sum-101` (EX-101), `excel-if-102` (EX-102), `excel-lookup-103` (EX-103). Assessment items render as a form (`components/excel/assessment-form.tsx`) that posts to `POST /api/missions/[slug]/assessment`; the server grades with `server/excel-assessment-grader.ts` and the keys in `<slug>.keys.json` (pass mark from the mission JSON, explanations revealed only on a pass, nothing persisted yet).

## 9. Tests

- Engine: `pnpm --filter @flightdeck/excel-engine test` (parser, every function incl. `test/xlookup.test.ts`, `test/scalar-functions.test.ts`, `test/conditional.test.ts` and `test/validator-new-functions.test.ts` (0.3.0 functions through the validator), semantics and coercion, error propagation, references, precedence, circular references, every limit, performance, determinism, security scan, validator acceptance/rejection, the 4 fixtures solved/unsolved).
- Web: `pnpm --filter @flightdeck/web test` runs grid helpers, Worker client, server-check client, mission content (`components/excel/*.test.ts`) and the check handler + server-only boundary (`server/excel-check.test.ts`).
- Key leak: `pnpm --filter @flightdeck/web build` then `node apps/web/scripts/check-key-leak.mjs` (exit 1 on a leak).
