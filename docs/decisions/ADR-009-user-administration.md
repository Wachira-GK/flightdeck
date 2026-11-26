# ADR-009: User administration, master admin and password resets

Status: **Accepted by the Product Owner 2026-11-23** (decisions 1-5 below). Builds on ADR-002 (hybrid writes) and ADR-008 (service key server-only).

## Context
FlightDeck will be a paid, multi-track platform with certificates and staff who separate duties (an author never publishes their own content). Until now roles existed in the database (`app_role`: learner, author, reviewer, admin, support; `user_roles`) but could only be granted by hand in SQL, there was no master admin, and nobody could suspend an account or start a password reset.

## Decisions
1. **One master admin**, stored in a single-row table (`app_private.platform_owner`, `singleton` check). It is set only by SQL (`seeds/bootstrap-admins.sql`), never by a function or screen. Nobody can change the master's roles or status; only the master can rename itself; only the master can act on the master. Initial master: `godfreyclass24@gmail.com`.
2. **Admins may edit other admins** (roles, status, name, reset) except the master. An admin cannot change their own roles, status or password from the dashboard. Because the actor must be an active admin and cannot be the target, at least one admin always remains.
3. **Password resets are an emailed one-time link only.** Admins never set, see or receive a password, link or code. The PKCE verifier stays on the server (`app_private.reset_handoff`, single use, one hour, max three per learner per hour) and the link returns through `/auth/callback?rid=`.
4. **Two-step sign-in (authenticator app) is required for admins before launch**, not before Gate 1. Supabase includes it at no extra cost. Tracked as FD-B02 (to build).
5. **Suspend/reactivate is in v1.** Suspending writes the status and bans the account in Supabase Auth (blocks new sign-ins and token refresh). An already-issued access token works until it expires (at most one hour); Supabase's free API has no "end all other sessions" call, so we do not claim that.

## How it is enforced (ADR-002 pattern)
- Tables live in `app_private` with no browser grants. Functions live in `public` for RPC but only `service_role` may execute them (migration `20261123000800_user_admin.sql`).
- The web server passes the actor id from the verified session; every function re-checks in the database that the actor is an **active admin**. A suspended admin has no admin power.
- Every change (`admin_set_roles`, `admin_set_status`, `admin_set_name`, `admin_password_reset_requested`, `admin_reset_link_opened`) and every view of another user's data (`admin_view_user`) is written to the append-only audit log (Kenya Data Protection Act 2019 map: access to personal data is logged).
- `/admin` shows a normal 404 to anyone who is not an active admin.
- Admins can see a progress **summary** (counts) only. They cannot edit answers, grades or certificates.

## Roles for the two initial admins (separation of duties)
- `godfreyclass24@gmail.com`: master admin, admin, author.
- `godmarklee@gmail.com`: admin, reviewer.
This makes "author cannot publish own work" usable between the two real accounts.

## Consequences and limits
- The user list reads up to 1,000 accounts from Supabase Auth and filters in the server; replace with a search endpoint at scale.
- Reset emails come from the default Supabase sender (rate-limited, branded "Supabase Auth") until a domain and custom SMTP exist (domain decision due 20 Dec 2026). The admin sees a clear message when the sender is rate-limited.
- Supabase's Redirect URLs allow-list must include `https://flightdeck.stegmon.com/**` (production address since 26 Nov 2026); the `?rid=` query must be accepted by that pattern (verify with the first live admin reset).
- Not built yet: MFA for staff (FD-B02), role-gated author/reviewer screens, audit-log viewer screen.

## Tests
Database `ADM-T01..T12` (admin.test.ts) and web `ADM-W01..W10` (server/admin/admin.test.ts).
