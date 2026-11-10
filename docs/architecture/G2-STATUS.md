# Gate 2 status — Platform shell and simulator spike

Updated: 2026-11-11 · Target: **7 Dec 2026** (Gantt v2, proposed) · All items AI-drafted, pending human review.

| Component | State | Evidence |
|---|---|---|
| FD-XLS01 Excel simulator spike + formula engine | ✔ draft | `packages/excel-engine` (221 tests, 500-cell recalc 10–30 ms), `apps/web/components/excel`, `docs/architecture/EXCEL-ENGINE.md`, 3 exercises in `content/excel/exercises` |
| FD-MATH01 Mathematics renderer + interactive visual | ✔ draft | `packages/math` (134 tests), `apps/web/components/math`, `docs/architecture/MATH-RENDERER.md`, mission `content/math/missions/descriptive-stats-101.json` |
| FD-C01 Versioned Excel/Math catalogue + lesson blocks | ◐ | Mission content files + mock catalogue; DB seeding waits for Supabase |
| FD-B01 Authentication, roles, Cockpit shell | ⏸ paused | Needs Supabase project (Godfrey to create — calendar item 1, 12 Nov) |
| Security headers (CSP, HSTS) + real 404 | ✔ | `docs/security/SECURITY-HEADERS.md`; live on preview |
| Preview deploy | ✔ | `flightdeck-web.godmarklee.workers.dev` version `23c5cc01`; E2E 46/46 locally |

## Open decisions raised by G2
1. Lookup function in the Excel engine v1 (recommend XLOOKUP exact-match only) — `EXCEL-ENGINE.md`.
2. Formula library: keep custom engine for G3 (HyperFormula is GPL/commercial) — `EXCEL-ENGINE.md`.
3. Teaching choices for MA-101: sample SD (STDEV.S) default, pass mark 3/4, ±0.01 tolerance, QUARTILE.INC — `MATH-RENDERER.md`.
4. Hosting: Free plan exceeded by real pages (CPU 7–62 ms) → Workers Paid (ADR-003, 23 Nov).
