# FlightDeck OWASP ASVS 4.0.3 control map (Level 2 target)

Status: **AI-drafted 2026-11-11, pending Security Architect review.** Only the chapters relevant to G1 are listed; ✔ = evidence exists in repo, ◐ = designed, not yet built, ○ = later gate.

| ASVS | Requirement (summary) | FlightDeck control | Evidence | State |
|---|---|---|---|---|
| V1.2.3 | Single vetted authentication mechanism | Supabase Auth only | Architecture v1.0 | ◐ G2 |
| V1.4.1 | Trusted enforcement points for access control | PostgreSQL grants + RLS; server actions | `20261110000200_grants_rls.sql` | ✔ |
| V1.4.4 | Single well-vetted access-control mechanism | RLS + helper functions in `app_private` | RLS-MATRIX.md | ✔ |
| V1.14.6 | No unsupported/insecure client technologies | No eval / Function in simulator | THREAT-MODEL CT5 | ◐ G2 |
| V2.1–2.5 | Password, credential recovery | Supabase Auth policy (min length 12, breached-password check, email OTP) | Supabase config | ◐ G2 |
| V3.4.x | Cookie attributes (Secure, HttpOnly, SameSite) | `@supabase/ssr` cookies, SameSite=Lax | — | ◐ G2 |
| V4.1.1 | Access control enforced server-side | RLS on every `public` table, no client grant on verdicts | RLS-T01..T24 | ✔ |
| V4.1.3 | Least privilege | Column-level grants; `app_definer` without BYPASSRLS | RLS-T24, RLS-MATRIX | ✔ |
| V4.1.5 | Access control fails securely | Default-deny: revoke all, then explicit grants | RLS-T01, T03 | ✔ |
| V4.2.1 | Protection against IDOR | Owner predicate `auth.uid()`; ids never trusted from client | RLS-T05..T09 | ✔ |
| V4.3.1 | Admin interfaces use MFA | Admin/reviewer require MFA (Supabase MFA, AAL2 check) | — | ○ G4 |
| V5.1.x | Input validation | DB check constraints (sizes, enums, slugs); zod on server actions | baseline migration | ◐ |
| V5.2.4 | No eval / dynamic code | Formula engine: own parser + allow-list | THREAT-MODEL CT5 | ◐ G2 |
| V5.3.x | Output encoding / XSS | React rendering of structured JSON; CSP | — | ◐ G2 |
| V6.2.x | Approved cryptography | Random codes from `gen_random_uuid()`; Paystack HMAC-SHA512 | `certificates` | ✔ / ○ |
| V7.1.1 | No credentials/PII in logs | Sentry/PostHog scrubbing, user-id only | PRIVACY-MAP | ◐ |
| V7.2.x | Security events logged | `app_private.audit_log` append-only | RLS-T20 | ✔ |
| V8.3.x | Sensitive data minimisation | Public profiles excluded; certificate verify returns no identity | RLS-T24, PRIVACY-MAP | ✔ |
| V10.3.2 | Dependency integrity | Lockfile, `onlyBuiltDependencies` | `pnpm-lock.yaml` | ◐ |
| V11.1.x | Business logic: sequential steps, limits | Attempt limits, one open attempt, time limits, publish workflow | RLS-T12, T18, T19 | ✔ |
| V13.1.x | API security | Data API exposes `public` only; `app_private` unexposed | Supabase config note | ◐ verify on staging |
| V14.1.x | Build/deploy security | CI with read-only token; secret scan in `pnpm check` | `quality.yml`, `scan-secrets.mjs` | ✔ |
| V14.4.x | HTTP security headers | CSP, HSTS, X-Content-Type-Options, frame-ancestors | — | ◐ G2 |
