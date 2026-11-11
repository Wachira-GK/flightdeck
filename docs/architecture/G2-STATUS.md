# Gate 2 status — Platform shell and simulator spike

Updated: 2026-11-11 · Target: **7 Dec 2026** (Gantt v2, proposed) · All items AI-drafted, pending human review.

| Component | State | Evidence |
|---|---|---|
| FD-XLS01 Excel simulator spike + formula engine | ✔ draft | `packages/excel-engine` (270 tests incl. XLOOKUP exact-match per ADR-004, 500-cell recalc 10–30 ms), `apps/web/components/excel`, server check API `POST /api/exercises/[id]/check`, 4 exercises, missions EX-101/102/103 |
| FD-MATH01 Mathematics renderer + interactive visual | ✔ draft | `packages/math` (141 tests), `apps/web/components/math`, `docs/architecture/MATH-RENDERER.md`, mission MA-101 with server-graded assessment `POST /api/missions/[slug]/assessment` (ADR-005) |
| FD-AST01 Assessment grading (slice) | ◐ draft | Server grading for MA-101 and EX-101/102/103: pure graders (`packages/math` assessment, `apps/web/server/excel-assessment-grader.ts`), keys only in `apps/web/server/`, router `server/assessment.ts`, `POST /api/missions/[slug]/assessment`, client form `components/excel/assessment-form.tsx`. Pass mark from each mission JSON; explanations revealed only on a pass. Attempt storage and assessment versioning wait for Supabase (paused) |
| FD-C01 Versioned Excel/Math catalogue + lesson blocks | ✔ local | Seed generator → `packages/database/seeds/catalogue.sql` (3 tracks, 2 courses, 4 missions, 20 steps, keys only in app_private), 15 seed tests incl. drift check; static `/catalogue` page. Applying to Supabase is paused |
| FD-B01 Authentication, roles, Cockpit shell | ⏸ paused | Needs Supabase project (Godfrey to create — calendar item 1, 12 Nov) |
| Security headers (CSP, HSTS) + real 404 | ✔ | `docs/security/SECURITY-HEADERS.md`; live on preview |
| Preview deploy | ✔ | `flightdeck-web.godmarklee.workers.dev` version `c341b831` (11 Nov, commit `dbc3e2c`); E2E 100/100 locally (light + dark, incl. 375px); live grading smoke-tested (fail reveals nothing, pass reveals explanations, unknown slug 404) |

## Totals (11 Nov)
Unit tests 639 (DB 43, engine 270, math 141, ui 78, web 107) · E2E 100/100 (50 tests x light/dark) · key-leak scan OK (38 markers, 21 bundle files) · preview version `c341b831`.

## Decisions
ADR-004 (custom engine + XLOOKUP exact-match) and ADR-005 (MA-101 conventions) ACCEPTED 11 Nov.

## Open decisions raised by G2
1. Hosting: Free plan exceeded by real pages (CPU 7–62 ms) → Workers Paid (ADR-003, 23 Nov).
2. Migration for `missions.code` and `missions.estimated_minutes` before the catalogue reads from Supabase.
3. Assessment attempts, history and versioning (rest of FD-AST01) need Supabase, which is paused. Until then grading is stateless: nothing is saved and a pass does not yet unlock the next mission.
