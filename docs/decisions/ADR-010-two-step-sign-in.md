# ADR-010: Two-step sign-in (authenticator app)

Status: **Accepted 2026-11-24** (follows ADR-009 decision 4: required for admins before launch). Builds on ADR-007 (session) and ADR-009 (administration).

## Decisions
1. **Method:** TOTP authenticator app (Google Authenticator, Microsoft Authenticator, Authy) through Supabase MFA. No SMS (cost, SIM-swap risk), no extra service, no extra cost.
2. **Who:** required for **every admin** (including the master) before the admin area; **optional for everyone else**, who can turn it on at `/account/security`. Once on, it is enforced for that person on every protected page.
3. **Enforcement point:** `requireUser` sends anyone who has a confirmed authenticator but whose session is still `aal1` to `/mfa`. `requireAdmin` runs the admin check first (non-admins still get a 404), then: no authenticator -> `/account/security?required=admin`; not yet confirmed this session -> `/mfa`. Every admin server action calls `requireAdmin`, so the rule covers actions as well as pages. The database admin functions stay service-only (ADR-009), so they are reachable only through these guarded paths.
4. **Assurance level:** Supabase writes `aal` into the access token. The token is first verified by Supabase (`getUser`, ADR-007), then only the `aal` claim is read. Anything unreadable counts as `aal1`.
5. **Set-up:** the server asks Supabase for a secret + QR code with the person's own token, clears any abandoned unconfirmed set-up first, and only a confirmed 6-digit code makes the factor count. The factor id in the form is checked against the person's own unconfirmed factors.
6. **Lost phone:** an admin presses "Reset two-step sign-in" on the person's page (`fd_admin_mfa_reset`: active admin, not self, not master, audited as `admin_mfa_reset`), then the server removes their factors through the Supabase admin API. They set up again at next sign-in (admins must, before reaching `/admin`). The **master** cannot be reset through the dashboard. Master recovery is by SQL run by the project owner: `delete from auth.mfa_factors where user_id = (select id from auth.users where lower(email) = 'godfreyclass24@gmail.com');` and then set up again.
7. **Not built (yet):** recovery codes, a "turn off" button, remembered devices, SMS/email codes. Supabase free has no "sign out everywhere", so a reset does not end sessions that already passed two-step.

## Consequences
- Supabase must have TOTP enrolment/verification enabled (default on). If it is off, set-up shows a plain message and admins cannot reach `/admin` until it is on.
- Two admins plus the SQL path means no single lost phone can lock the platform out.
- Existing Google and password sign-in are unchanged for people who have not turned it on.

## Tests
Database `ADM-T13..T14` (admin-mfa.test.ts); web `MFA-W01..W12` (server/auth/mfa.test.ts).
