# Gate 2 status — Platform shell and simulator spike

Updated: 2026-11-13 · Target: **7 Dec 2026** (Gantt v2, proposed) · All items AI-drafted, pending human review.

| Component | State | Evidence |
|---|---|---|
| FD-XLS01 Excel simulator spike + formula engine | ✔ draft | `packages/excel-engine` (270 tests incl. XLOOKUP exact-match per ADR-004, 500-cell recalc 10–30 ms), `apps/web/components/excel`, server check API `POST /api/exercises/[id]/check`, 4 exercises, missions EX-101/102/103 |
| FD-MATH01 Mathematics renderer + interactive visual | ✔ draft | `packages/math` (141 tests), `apps/web/components/math`, `docs/architecture/MATH-RENDERER.md`, mission MA-101 with server-graded assessment `POST /api/missions/[slug]/assessment` (ADR-005) |
| FD-AST01 Assessment grading (slice) | ◐ draft | Server grading for MA-101 and EX-101/102/103: pure graders (`packages/math` assessment, `apps/web/server/excel-assessment-grader.ts`), keys only in `apps/web/server/`, router `server/assessment.ts`, `POST /api/missions/[slug]/assessment`, client form `components/excel/assessment-form.tsx`. Pass mark from each mission JSON; explanations revealed only on a pass. Attempt storage and assessment versioning are now unblocked (Supabase live 12 Nov) and not yet built |
| FD-C01 Versioned Excel/Math catalogue + lesson blocks | ✔ local | Seed generator → `packages/database/seeds/catalogue.sql` (3 tracks, 2 courses, 4 missions, 20 steps, keys only in app_private), 15 seed tests incl. drift check; static `/catalogue` page. **Applied to live Supabase 12 Nov**: 3 tracks, 2 courses, 2 published versions, 4 missions, 20 steps, 5 exercises, 4 assessments, 16 items, 5+16 key rows; anon sees the published catalogue only, keys unreadable by anon and learners, seed idempotent. The web catalogue still reads the content files (Supabase-backed source comes later) |
| FD-B01 Authentication, roles, Cockpit shell | ◐ draft | **Sign-in built 13 Nov (ADR-007)**: `/sign-in`, `/sign-up`, sign-out, HttpOnly cookie session on Supabase Auth (plain REST, no proxy), silent refresh via `/auth/refresh`, `/auth/confirm` for email links, protected `/cockpit` showing the learner's own name and roles read through RLS. Live test passed against Supabase (wrong password refused, session cookies HttpOnly, refresh, sign-out). Open: email-confirmation template + Site URL in Supabase dashboard, password reset, role-gated author/reviewer screens, MFA for staff |
| FD-D02 Live database | ✔ | Migrations 000100-000500 applied to Supabase (000500 = display name from sign-up into the profile); live security check 37/38 (the one miss only counts the two seed accounts); 000400 fixes a bug found live: SECURITY DEFINER helpers could not call `auth.uid()` on Supabase (anon got "permission denied for schema auth"); now `app_private.current_uid()`. Test shim made faithful so unit tests reproduce it (18 failures without the migration) |
| Security headers (CSP, HSTS) + real 404 | ✔ | `docs/security/SECURITY-HEADERS.md`; live on preview |
| Preview deploy | ✔ | `flightdeck-web.godmarklee.workers.dev` version `c341b831` (11 Nov, commit `dbc3e2c`); E2E 100/100 locally (light + dark, incl. 375px); live grading smoke-tested (fail reveals nothing, pass reveals explanations, unknown slug 404) |

## Totals (13 Nov)
Unit tests 678 (DB 44, engine 270, math 141, ui 78, web 145) · E2E 124/124 (62 tests x light/dark, incl. live sign-in) · key-leak scan OK (38 markers, 21 bundle files) · preview version `c341b831`.

## Decisions
ADR-004 (custom engine + XLOOKUP exact-match) and ADR-005 (MA-101 conventions) ACCEPTED 11 Nov.

## Open decisions raised by G2
1. Hosting: Free plan exceeded by real pages (CPU 7–62 ms) → Workers Paid (ADR-003, 23 Nov).
2. Migration for `missions.code` and `missions.estimated_minutes` before the catalogue reads from Supabase.
3. Assessment attempts, history and versioning (rest of FD-AST01) need app work now that Supabase is live (12 Nov). Until built, grading is stateless: nothing is saved and a pass does not yet unlock the next mission.
