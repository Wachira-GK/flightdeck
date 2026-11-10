# HTTP security headers (ASVS V14.4)

Status: implemented 2026-11-11 in `apps/web/next.config.ts` (production builds only). AI-drafted, pending Security Architect review.

| Header | Value | Purpose |
|---|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Blocks third-party scripts, plugins, framing, form hijack |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | HTTPS only for a year |
| X-Frame-Options | `DENY` | Clickjacking (legacy browsers) |
| X-Content-Type-Options | `nosniff` | MIME sniffing |
| Referrer-Policy | `strict-origin-when-cross-origin` | Limits URL leakage |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | No device access |

## Known gaps / next steps
1. `script-src 'unsafe-inline'` — required by Next.js App Router inline bootstrap scripts. Upgrade options: nonce CSP via `proxy.ts` (makes every page dynamic → more Worker CPU, relevant to the 10 ms Free cap) or hash-based SRI. Decide with ADR-003.
2. `connect-src` must add the Supabase project URL (`https://<ref>.supabase.co`, `wss://<ref>.supabase.co`) once Supabase is set up (paused).
3. Add PostHog / Sentry / Bunny origins only when those integrations land.
4. HSTS `preload` only after a custom domain is chosen (not on workers.dev).
