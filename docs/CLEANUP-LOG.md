# Cleanup log (held until Godfrey says GREEN)

Rule: nothing here is deleted without GREEN. Only temporary working files I create during a build may be removed by me, and even those are held for now (24 Nov 2026).

| # | Item | Where | What it is | Created | Status |
|---|------|-------|------------|---------|--------|
| 1 | `prod-ca-2021.crt` copy | Stock and Sales folder (KP SS) | Supabase certificate downloaded via Chrome; original kept there | 24 Nov | HELD |
| 2 | `fdgen_a` to `fdgen_d`, `fdgen_lib`, `showitems.mjs` | `C:\Users\Public` | Old generator scratch scripts | 15 Nov | HELD |
| 3 | `flightdeck-diff.txt` | `C:\Temp` | Old diff output | 23 Nov | HELD |
| 4 | Branch `feat/google-sign-in` | Git repo | Merged long ago; no longer needed | 13 Nov | HELD |
| 5 | `C:\Temp\fdpg` | `C:\Temp` | My database helper scripts (`apply.mjs`, `q.mjs`, `try.mjs`, `pg` module, `ca.crt`). Still used to apply migrations | 24 Nov | HELD (in use) |
| 6 | `C:\WebDev\Backups\flightdeck-2026-11-24-01-30` | `C:\WebDev\Backups` | Data backup (personal data and answer keys). KEEP, not a cleanup item; listed so it is not forgotten | 24 Nov | KEEP |

Deleted so far in this phase: only my own build logs (`C:\Temp\fd-build.log`, `C:\Temp\fd-deploy.log`), 24 Nov.

24 Nov (later): progress reset run on live DB at Godfrey's GREEN (2 enrolments, 1 step, 3 simulator checks removed; audit entry progress_reset). The one-off script is C:\Temp\fdpg\reset.mjs, inside item 5 (held).
