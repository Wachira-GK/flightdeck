# ADR-007: Sign-in and session handling (FD-B01)

Status: **Accepted 2026-11-13 (Product Owner Godfrey asked for sign-in on Supabase Auth)**. AI-drafted; Security Architect review pending at Gate 1.

## Context

Learners need to sign in with Supabase Auth so that Row Level Security (RLS) can recognise them. The app runs on Cloudflare Workers (OpenNext). The Supabase helper library `@supabase/ssr` refreshes sessions in a request proxy, which makes every route dynamic (more Worker CPU, and Free-plan CPU is already tight, see ADR-003) and relies on a Node runtime that is unproven on OpenNext.

## Decision

1. **Plain REST calls to Supabase Auth** (`apps/web/server/auth/gotrue.ts`): password sign-in, sign-up, refresh, user lookup, sign-out, email-link verification. No new dependency. Unit-tested with a fake `fetch` (19 tests).
2. **Session = two HttpOnly cookies** set by the server: `fd-at` (access token, lifetime from Supabase, 1 h) and `fd-rt` (refresh token, 30 days). `HttpOnly` (page scripts cannot read them), `SameSite=Lax`, `Secure` in production, path `/`.
3. **The token is never trusted by decoding it.** Every protected request asks Supabase `GET /auth/v1/user`. The learner's profile and roles are read through PostgREST **with the learner's own token**, so RLS decides what is returned.
4. **No proxy.** A page that finds no valid access token but a refresh token redirects to `/auth/refresh`, a route handler (which may set cookies), which swaps the refresh token, sets new cookies and returns with `?refreshed=1` (loop guard). Public pages stay static; only `/cockpit`, `/sign-in`, `/sign-up` and `/auth/*` are dynamic.
5. **Redirects are relative** (`Location: /path`). An absolute URL built from `request.url` can carry a different host name (localhost vs 127.0.0.1, or an internal host behind a proxy), and the browser then would not send our cookies. Found by the live test.
6. **Open redirect guard**: `?next=` must be a same-site path (`safeNext`).
7. **No account enumeration on sign-up**: the same neutral message is shown whether or not the address exists. Sign-in errors are generic ("email and password do not match").
8. **Passwords**: new accounts need 10+ characters and at most 72 bytes (bcrypt limit). Supabase applies its own rate limits; the app maps them to a friendly message.
9. **Display name**: sent as sign-up metadata; migration `20261113000500` makes the new-user trigger copy it (control characters removed, trimmed, 80 characters) into `public.profiles`.
10. **Sign-out** ends this session only (`scope=local`) and clears both cookies.

## Not yet done (follow-ups)

- **Email confirmation links.** With "Confirm email" on, Supabase sends a link that must point at `/auth/confirm`. In the Supabase dashboard (Authentication > Email Templates > Confirm sign up) set the link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, and set Authentication > URL Configuration > Site URL to the app URL. Until then, either turn "Confirm email" off for testing or create accounts in the dashboard.
- **Google one-button sign-in (built 13 Nov).** "Continue with Google" on /sign-in and /sign-up. Flow: `/auth/google` makes a PKCE secret (verifier kept in the HttpOnly cookie `fd-oauth`, path /auth, 10 min), asks Supabase `GET /auth/v1/settings` whether Google is on, then redirects to Supabase `/auth/v1/authorize?provider=google` with only the SHA-256 challenge; Google shows its account picker; Supabase returns to `/auth/callback?code=`; the server trades code + verifier at `/auth/v1/token?grant_type=pkce`, sets the usual `fd-at`/`fd-rt` cookies and drops `fd-oauth`. Any failure ends on /sign-in with a neutral notice. Same route = sign-in and sign-up (first Google login creates the account; Supabase links it to an existing account with the same verified email). Name comes from Google metadata (`full_name`, then `name`) via migration 20261113000600 (applied live). Google needs one-time setup outside the code: a Google Cloud OAuth client, its ID and secret pasted into Supabase (Authentication > Sign In / Providers > Google), and the app URL added to Supabase Redirect URLs. Tests: gotrue.test.ts (Google block), pkce.test.ts (RFC 7636 vector), DB-I06, e2e auth.spec.ts (button, forged/absent cookie).
- Password reset, change password, change email, magic link, Microsoft sign-in, MFA for staff roles.
- Role-aware screens (author/reviewer tools). Roles are read and shown, not yet used to gate features.
- Persisting progress/attempts per learner (next slice of FD-AST01).
- The Supabase default email sender is rate-limited (a few emails per hour); real sending needs a custom SMTP (Resend is in the architecture).

## Evidence

- Unit: `server/auth/gotrue.test.ts`, `server/auth/validate.test.ts`; DB-I05 (display name trigger).
- E2E `e2e/auth.spec.ts` (18 incl. 375px) and, with `FD_E2E_EMAIL`/`FD_E2E_PASSWORD` set, a live test: wrong password refused, right password reaches the Cockpit, cookies HttpOnly + SameSite=Lax and invisible to `document.cookie`, expired access token renewed transparently, sign-out ends the session. Run once on 13 Nov against the live Supabase project with a temporary account that was deleted afterwards.
