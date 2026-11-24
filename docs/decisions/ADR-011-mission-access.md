# ADR-011: Mission access (free tier, availability switch, per-learner unlocks)

Status: accepted, 24 Nov 2026. Builds on ADR-002 (server-only writes), ADR-008 (service role stays on the server) and ADR-009 (admin model).

## Decision

Whether someone can open a mission, have it graded and have the result saved is decided by one database function, `public.fd_mission_access(user, slug)`, which answers `open`, `locked`, `disabled` or `unknown`. The rules, in order:

1. Admins open everything, including missions that are switched off. Suspended admins are treated as ordinary learners.
2. A mission switched off (`is_enabled = false`) is `disabled` for everyone else.
3. Authors and reviewers open every enabled mission (they need to test what they write).
4. A mission marked free (`is_free = true`) is open to everyone, including visitors who are not signed in. The product owner chooses which missions are free; today it is five (the first five Excel missions, EX-101 to EX-105).
5. Any other mission is open only for learners who have an unlock row (`app_private.mission_unlock`), created by an admin on the learner's user page.
6. Everything else is `locked`.

There is no numeric quota ("any 5 missions of your choice"). The count rule was deferred by the owner until the free tier is final; the free tier is a fixed list instead, which is simpler to explain and test. A quota can be added later as one more rule in the same function.

## Where it is enforced

- The mission page asks first and sends no mission content when the answer is not `open`.
- The two grading routes (`/api/missions/[slug]/assessment`, `/api/exercises/[id]/check`) ask before grading, so a locked mission cannot be graded or saved by calling the API directly.
- The cockpit only offers open missions as "next".
- The check fails closed: if the database cannot be asked, the answer is `error` and nothing opens. The one exception is a server with no service key at all (local development).

## Tables and functions

- `app_private.mission_access (mission_slug, is_free, is_enabled, updated_by, updated_at)`; a mission with no row is locked and enabled.
- `app_private.mission_unlock (user_id, mission_slug, granted_by, granted_at)`.
- Service-role-only functions: `fd_mission_access`, `fd_access_summary`, `fd_admin_mission_list`, `fd_admin_set_mission`, `fd_admin_user_unlocks`, `fd_admin_set_unlocks`. The admin ones re-check in the database that the actor is an active admin and write to the audit log (`admin_set_mission_access`, `admin_unlock_missions`, `admin_lock_missions`).

## Payments later

A paid purchase will create the same kind of unlock (or an entitlement the function also checks). The mission page and routes do not change.

## Known limits

- The mission text is bundled in the app's JavaScript (it is learner-safe content, ADR-003), so access control protects grading, saving and the page, not secrecy of the lesson wording. Answer keys are never in the bundle.
- The public catalogue page is static and lists every mission; clicking a locked one shows the "not unlocked" page.
- Unlock changes apply on the next request; there is no cache.
