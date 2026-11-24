# ADR-012: Activity tracking (sign-in log and daily rollup)

Status: accepted (stage 1 built 24 Nov 2026). Stage 2 (learning evidence) is designed below and built separately.

## Why

Godfrey needs to see how often each learner comes back (trend and per-user), and later wants evidence that a learner really worked through the lessons, so certificates are harder to forge. This is a record of WHO and WHEN, not a surveillance tool.

## Stage 1 (live with migration 20261124001200_activity.sql)

- `app_private.sign_in_event`: one row per successful sign-in (user, time, method: password, google or signup).
- `app_private.activity_day`: one row per user per Nairobi day (sign-ins, visits, first and last seen). A visit is the first page view after 30 quiet minutes; the row is written at most once a minute per user.
- Recorded by the web server after Supabase has verified the person. Recording is best effort with a 1.5 second limit and swallows its own failures, so an outage in the log can never block sign-in or a page.
- Admin only: `/admin/activity` (trend, busiest learners) and a card on each user page. Reads go through service-role functions that check the caller is an active admin.
- NOT recorded: IP address, device, browser, page contents, answers, what was typed.
- With two-step sign-in, a password sign-in is counted when the password is accepted (before the code step). Good enough for "how often do they come back".

## Retention

`fd_activity_purge(months)` removes activity older than 13 months (never fewer than 3) and writes an audit entry. It is a function only: scheduling it is a separate step needing approval (open item, see REVIEW-2026-11-25). Tie the final period to ADR-006 (data retention), which is still a draft.

## Privacy

The privacy page must say we keep sign-in times and days active for administration and certificate integrity, who can see them, and the retention period. Anonymous visitor statistics, if wanted, should use Cloudflare Web Analytics (no cookies, no personal data) rather than this table.

## Stage 2 design (learning evidence)

- Active time per mission: the mission page sends a small heartbeat only while the tab is visible and the learner is interacting; the server adds up seconds per learner per mission step. Capped per day so a left-open tab cannot inflate it.
- Review flags for suspiciously fast passes (for example a pass in seconds, identical timing across attempts, no activity before the attempt). Flags are SOFT: they go to an admin review list and never block a learner automatically. Evidence kept for certificates is retained longer than general activity.
- Limits we accept: this makes forging harder, not impossible.

## Stage 2 built (24 Nov 2026, migration 20261124001400)

- The mission page sends a heartbeat every 15 seconds only while the tab is visible and the learner touched the page in the last minute. The server credits time no faster than the clock runs (so spamming earns nothing), at most 30 seconds per call and 4 hours per mission per day.
- /admin/review lists passed assessments with under 3 minutes of recorded time (soft flag; changes nothing). Per-mission active time shows on each user page.
- Open: pass attempts made before 24 Nov 2026 show as 'none recorded'. Retention for mission_time is not yet purged (decide with ADR-006; certificate evidence should be kept longer than sign-in logs).
