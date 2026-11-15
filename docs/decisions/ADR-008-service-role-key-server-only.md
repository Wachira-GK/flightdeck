# ADR-008: Service-role key is held on the server only, for saving progress

Status: Accepted (15 Nov 2026)

## Context
ADR-002 says the browser may write only safe rows owned by the learner. Grades, pass/fail and step completion must come from the server, never from the browser. The database enforces this with default-deny row-level security.

## Decision
- The grading routes (`/api/missions/[slug]/assessment`, `/api/exercises/[id]/check`) save results after grading. They use the Supabase secret key (`SUPABASE_SERVICE_ROLE_KEY`) and call two database functions, `fd_record_assessment` and `fd_record_exercise`.
- Those functions are executable only by `service_role`. Anon and authenticated users cannot call them.
- The user id comes from the verified session cookie (`currentUserId()`), never from the request body.
- The key lives only in `apps/web/.env.local` (local) and as a Cloudflare Worker secret (live). It is never prefixed `NEXT_PUBLIC_`, never committed, and `scripts/check-key-leak.mjs` scans the built output for it.
- Saving is best-effort: the grade is always returned, with `saved` (and `savedReason`) telling the page whether it was stored. The assessment attempt limit (3) is enforced by the database; attempts beyond it are graded but not saved.

## Consequences
- A leaked key would bypass row-level security, so it is rotated if ever exposed.
- Learners can read only their own progress (RLS); the Cockpit reads with the learner's own session.
