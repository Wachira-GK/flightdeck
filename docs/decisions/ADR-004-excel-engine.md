# ADR-004: Excel formula engine and lookup function

Status: **Accepted 2026-11-11 (GREEN, Godfrey Kariuki)** — answers the G0 open decision "exact Excel formula/grid library after spike".

## Decision
1. **Keep the custom engine** (`packages/excel-engine`) for G3 and the MVP. No third-party formula library.
2. **Add `XLOOKUP` in v1, exact match only**: `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])`. No match modes, search modes, wildcards or arrays-as-results. Missing match without `if_not_found` → `#N/A`.

## Why
- HyperFormula is GPL-3.0 unless a commercial licence is bought; formula.js has functions but no parser or recalculation engine.
- The custom engine already meets the security model (no eval, allow-list, limits, deterministic server re-validation) and the performance target (500 cells in 10–30 ms).
- Exact-match XLOOKUP covers the third starter exercise and the most common analyst lookup without importing Excel's full lookup semantics.

## Consequences
+ Full control of semantics, limits and security; no licence cost. − Each new function is our own work and needs tests. Deviations from Excel stay documented in `docs/architecture/EXCEL-ENGINE.md`.
