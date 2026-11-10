# FlightDeck threat model v0.1 (FD-S01)

Status: **AI-drafted 2026-11-11, pending Security Architect review.** Method: STRIDE per trust boundary; controls mapped to OWASP ASVS 4.0.3 (L2 target) in `ASVS-CONTROLS.md`.
Supersedes: `THREAT-MODEL-TEMPLATE.md` (kept for history). The 2026-10 "Gate1 Security Pack" was not found on any device; this version is rebuilt from the approved brief (G0) and the implemented schema.

## 1. Assets

| ID | Asset | Classification | Store |
|---|---|---|---|
| A1 | Accounts, sessions, JWTs | Restricted | Supabase Auth |
| A2 | Roles (learner/author/reviewer/admin/support) | Restricted | `public.user_roles` (server-written) |
| A3 | Learner profile, preferences, notes, bookmarks | Personal | `public.*` owner-only |
| A4 | Enrolments, progress, attempts, answers, grades | Personal | `public.*` owner-only, verdicts server-only |
| A5 | Answer keys, hidden tests | Restricted | `app_private.*_keys` |
| A6 | Draft / in-review content | Internal | `course_versions` status ≠ published |
| A7 | Certificates + verification codes | Personal / public-minimal | `public.certificates`, `verify_certificate()` |
| A8 | Entitlements, payments, webhooks | Restricted / financial | `public.entitlements`, `app_private.payments`, `webhook_events` |
| A9 | Audit log, outbox | Restricted | `app_private.audit_log` (append-only), `outbox` |
| A10 | Secrets (`SUPABASE_SERVICE_ROLE_KEY`, Paystack secret, Resend/Bunny keys) | Secret | server environment only |

## 2. Trust boundaries

| ID | Boundary | Main controls |
|---|---|---|
| TB1 | Internet → web edge | TLS, WAF/rate limits (Cloudflare), security headers |
| TB2 | Browser → app/API | Supabase JWT, server actions validate input (zod), CSRF-safe POST |
| TB3 | Client / Data API → PostgreSQL | Default-deny grants, column grants, RLS, `app_private` not exposed |
| TB4 | Server → privileged DB (`service_role`) | Server-only key, invoker functions with actor checks, audit |
| TB5 | App → vendors (Bunny, Resend, PostHog, Sentry, Paystack) | Signed webhooks, idempotency, PII minimisation |
| TB6 | Author / reviewer / admin | Separation of duties: author ≠ publisher, assigned reviewer only |
| TB7 | Excel simulator runtime (browser Web Worker) | Formula allow-list, AST/size/time limits, no network/fs/eval; server re-validates |

## 3. Critical threats (from G0 brief) and treatment

| ID | Threat (STRIDE) | Boundary | Prevention | Test / evidence | Residual |
|---|---|---|---|---|---|
| CT1 | Cross-user learner-data access (I) | TB3 | Owner RLS `user_id = auth.uid()` on every learner table; no anon grants | RLS-T01, T04, T05, T07; mutation `notes-readable-by-all` | Low |
| CT2 | Owner-id substitution (T/E) | TB3 | `user_id default auth.uid()`; no column grant on `user_id`; `WITH CHECK`; owner-immutable trigger | RLS-T06, T08, T09 | Low |
| CT3 | `service_role` leakage (E) | TB2/TB4 | Key only in server env; never `NEXT_PUBLIC_*`; secret + bundle scan in CI | `scripts/scan-secrets.mjs`; bundle scan (FD-O01) | Medium until bundle scan runs on every build |
| CT4 | Fabricated simulator pass (T) | TB7/TB3 | Client may insert submission + evidence only; `passed/score/status` have no client grant; verdict via `record_exercise_verdict` (service_role) after deterministic server validation | RLS-T15; mutation `client-sets-exercise-pass` | Medium until server validator exists (G2 FD-XLS01) |
| CT5 | Formula network/filesystem/dynamic code (E) | TB7 | Own parser + allow-list (SUM, AVERAGE, MIN, MAX, COUNT, IF); no `eval`/`new Function`; Worker with no network; limits (100×30 grid, 500 cells, AST depth 30, 5000 edges, 500 ms hard timeout, 256 KB submission) | DB-I03 (256 KB); simulator spike tests (G2) | Medium (engine not built yet) |
| CT6 | Draft / answer-key / hidden-test disclosure (I) | TB3 | Keys in `app_private` (no grants); drafts gated by `can_read_version` (published, author, assigned reviewer, admin) | RLS-T16, T17; mutations `answer-keys-exposed`, `drafts-readable` | Low |
| CT7 | Unsafe SECURITY DEFINER helper (E) | TB3 | Owner `app_definer` (NOLOGIN, no BYPASSRLS, explicit SELECT + RLS policies); `search_path = ''`; EXECUTE revoked from PUBLIC; uses `auth.uid()` never caller-supplied ids | RLS-T24 (catalog check); mutation `definer-search-path-reset` | Low |
| CT8 | Forged / replayed payment webhook (S/T) | TB5 | Verify Paystack HMAC-SHA512 signature before parse; `unique(provider, event_id)`; entitlements written only by server; re-query transaction from Paystack API | DB-I01 (replay); webhook handler tests (pre-launch FD-PAY01) | Medium until handler built |

## 4. Additional threats

| ID | Threat | Treatment | Status |
|---|---|---|---|
| T9 | Author self-publishes (E) | No client UPDATE on `course_versions`; `publish_course_version` rejects author = actor and unassigned reviewers | RLS-T18, T19 ✔ |
| T10 | Role escalation (E) | No client grant on `user_roles`; bootstrap trigger may insert `learner` only | RLS-T21, DB-I04 ✔ |
| T11 | Grade tampering after close (T) | Answers writable only while attempt open + within time limit; scores server-only | RLS-T11, T13, T14 ✔ |
| T12 | Attempt flooding (D) | `max_attempts`, one open attempt per assessment; edge rate-limits | RLS-T12 ✔ / edge pending |
| T13 | Certificate enumeration (I) | 122-bit random code; regex gate; returns course + date + validity only, no identity | RLS-T24 ✔ |
| T14 | Audit tampering (R) | Append-only trigger + no UPDATE/DELETE grant even for service_role | RLS-T20 ✔ |
| T15 | XSS via lesson content (T) | Content stored as structured JSON blocks, rendered by React (no `dangerouslySetInnerHTML`); CSP | Pending (G2) |
| T16 | PII in analytics/errors (I) | PostHog/Sentry: user id only, no emails/answers; `beforeSend` scrubbing | Pending (G2) |
| T17 | Supply-chain compromise (T) | Lockfile, `pnpm.onlyBuiltDependencies`, Dependabot/audit in CI | Partial (lockfile ✔) |

## 5. Open items for the Security Architect

1. Confirm on a Supabase staging project that `postgres` can create `app_definer` and grant it `usage on schema auth` / `execute on auth.uid()` (PGlite tests use a shim).
2. Decide ADR-002 (direct owner-only browser writes vs server-only mutations) — current implementation: browser writes only low-risk owner rows (notes, bookmarks, preferences, profile name, answers in an open attempt, simulator submissions, free enrolment).
3. Retention periods for events, answers and audit (privacy map §4).
4. Rate-limit values at the edge (TB1) once hosting is chosen.
