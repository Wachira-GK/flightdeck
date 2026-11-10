# Gate 1 status — Architecture Foundation

Updated: 2026-11-11 (pm) · Target: **24 Nov 2026** (re-baselined from 10 Nov; Gantt v2 `docs/plan/flightdeck-accelerated-excel-math-v2.gantt.json`) · Decision owner: Project Owner (Godfrey Kariuki)
Overall: **NOT approval-ready** — evidence is being built; every item below is AI-drafted and needs accountable human review (Definition of Done).

## G1 approval rule

| Rule | State | Evidence |
|---|---|---|
| Every P0 complete with evidence | ◐ | table below |
| No untreated Critical/High risk | ◐ | `docs/security/THREAT-MODEL-v0.1.md` — CT3, CT4, CT5, CT8 Medium until G2 code exists |
| RLS-T01..T24 pass | ✔ locally | `pnpm test:rls` → 28/28 (24 RLS + 4 integrity), PostgreSQL 17 / PGlite |
| Clean CI passes | ◐ | Pushed to `Wachira-GK/flightdeck` (main `1fd3095`); `pnpm check` passes locally; confirm the GitHub Actions run |
| Cloudflare spike passes OR Vercel fallback recorded | ◐ | `docs/architecture/CLOUDFLARE-SPIKE.md`, `docs/decisions/ADR-003-hosting-spike.md` |
| Keyboard / contrast review passes | ◐ | Contrast gate 70 pairs (min 5.09:1 text, 3.75:1 UI); Playwright + axe 30/30, 0 violations; human screen-reader pass pending (`docs/design/ACCESSIBILITY-REVIEW.md`) |
| No P0 waiver | ✔ | none requested |

## P0 blocking work

| # | Step (official term) | Component | State | Evidence |
|---|---|---|---|---|
| 1 | Physical ERD + data dictionary | FD-D01 | ✔ draft | `docs/data/ERD.md`, `docs/data/DATA-DICTIONARY.md` (generated) |
| 2 | Baseline migration | FD-D01 | ✔ draft | `packages/database/supabase/migrations/20261110000100_baseline_schema.sql` |
| 3 | Grants + RLS policy migration | FD-D01/S01 | ✔ draft | `…000200_grants_rls.sql`, `…000300_server_functions.sql`, `docs/security/RLS-MATRIX.md/.csv` |
| 4 | Automated RLS-T01..T24 harness | FD-Q01 | ✔ | `packages/database/test/rls.test.ts`; mutation check 8/8 caught (`pnpm --filter @flightdeck/database test:mutations`) |
| 5 | Role / capability matrix | FD-S01 | ✔ draft | `docs/security/ROLE-CAPABILITY-MATRIX.md` |
| 6 | Cockpit + lesson-shell prototype | FD-U01 | ✔ draft | `apps/web` (`/cockpit`, `/missions/excel-sum-101`), tokens in `packages/ui`, `docs/design/` |
| 7 | CI clean-run evidence | FD-Q01 | ◐ | pushed; check GitHub Actions `quality` run for `1fd3095` |
| 8 | Cloudflare compatibility spike | FD-O01 | ◐ local pass | OpenNext build OK, gzip 1,053 KiB, SSR OK on local workerd; real Free-account deploy + CPU time pending (`docs/architecture/CLOUDFLARE-SPIKE.md`) |
| 9 | Secret / bundle scan | FD-Q01 | ✔ | `scripts/scan-secrets.mjs` (first step of `pnpm check`) |
| 10 | Gate-1 evidence review | Owner | ○ | 21–23 Nov (Gantt task FD-G1R) |

Supporting: threat model v0.1, ASVS L2 map, privacy map, ADR-002 (browser writes, proposed).

## Open decisions (Project Owner)
1. Approve Gantt v2 re-baseline (G1 24 Nov, G2 7 Dec, G3 8 Jan, G4 8 Feb, G5 9 Mar).
2. ADR-002 browser writes (hybrid proposed) and ADR-003 hosting.
3. Retention periods (privacy map §4).
4. Excel formula/grid library (after G2 spike); domain/brand availability.
