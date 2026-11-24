# ADR-014: Backups, keep-alive and monitoring (free-plan safety net)

Status: accepted (24 Nov 2026).

Problem: the Supabase free plan has no downloadable backups and pauses a project after about a week with no activity.

1. Backup: tools/backup-data.mjs reads every table in public and app_private plus a safe subset of auth.users (no password hashes, tokens or MFA secrets) in one read-only snapshot, into a NEW dated folder (default C:\WebDev\Backups). It never deletes or overwrites. The folder holds personal data and the answer keys: keep private, never commit. Restore outline is in each backup's README. Run it before risky changes and weekly until the project is on a paid plan. Not scheduled yet (needs Godfrey's approval for a scheduled task on his computer).
2. Keep-alive and alarm: /api/health?deep=1 also asks the database a cheap question and answers 503 if it does not respond. .github/workflows/keepalive.yml calls it every 2 days; a failed run emails the repository owner. GitHub turns scheduled workflows off after 60 days with no commits, so any commit re-enables it.
3. Limits: a pause that has already happened must still be undone by hand in the Supabase dashboard. This does not replace a paid plan with daily backups.
