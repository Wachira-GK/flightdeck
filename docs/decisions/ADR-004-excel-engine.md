# ADR-004: Excel formula engine and lookup function

Status: **Accepted 2026-11-11 (GREEN, Godfrey Kariuki)** — answers the G0 open decision "exact Excel formula/grid library after spike".

## Decision
1. **Keep the custom engine** (`packages/excel-engine`) for G3 and the MVP. No third-party formula library.
2. **Add `XLOOKUP` in v1, exact match only**: `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])`. No match modes, search modes, wildcards or arrays-as-results. Missing match without `if_not_found` → `#N/A`.

## Why
- HyperFormula is GPL-3.0 unless a commercial licence is bought; formula.js has functions but no parser or recalculation engine.
- The custom engine already meets the security model (no eval, allow-list, limits, deterministic server re-validation) and the performance target (500 cells in 10–30 ms).
- Exact-match XLOOKUP covers the third starter exercise and the most common analyst lookup without importing Excel's full lookup semantics.

## Addendum (engine 0.3.0, 2026-11-15): more functions, same custom engine
The allow-list grows by 18 functions so more Excel missions can be taught: `ROUND`, `ABS`, `AND`, `OR`, `NOT`, `IFERROR`, `MEDIAN`, `SUMIF`, `COUNTIF`, `AVERAGEIF`, `SUMIFS`, `COUNTIFS`, `LEN`, `LEFT`, `RIGHT`, `UPPER`, `LOWER`, `TRIM`. Semantics follow Excel, with documented deviations in `docs/architecture/EXCEL-ENGINE.md` (2.2 and deviations 11-17); the main ones:
- **No wildcards** (`*`, `?`, `~`) in conditional-aggregate criteria: they are literal characters. Criteria are matched with plain comparisons; no regular expression or dynamic code is built from user input (CT5 unchanged).
- `SUMIF`/`AVERAGEIF` require equally sized ranges (Excel resizes); an error value used as criteria propagates.
- Conditional aggregates have a per-formula scan budget (4 x `maxEdges`, `#LIMIT!` when exceeded) on top of the existing edge budget, so repeated large ranges cannot multiply the work.
- `IFERROR` catches every engine error value from evaluated cells; its fallback is lazy and still a dependency.
Still deferred: wildcards, `VLOOKUP`/`INDEX`/`MATCH`, `SUBSTITUTE`/`FIND`/`MID`/`CONCAT`, dates, array results. Engine and validator versions: `0.3.0`.

## Consequences
+ Full control of semantics, limits and security; no licence cost. − Each new function is our own work and needs tests. Deviations from Excel stay documented in `docs/architecture/EXCEL-ENGINE.md`.
