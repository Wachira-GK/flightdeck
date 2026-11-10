# ADR-003: Host the web app on Cloudflare Workers (OpenNext), with Vercel as fallback

Status: **Proposed, pending human review** (drafted 11 November 2026)

## Context
G0 approved Next.js and asked for a Cloudflare Workers compatibility spike, with Vercel as the fallback. The G1 spike (`docs/architecture/CLOUDFLARE-SPIKE.md`) built the prototype (Next.js 16.4.6, App Router) with `@opennextjs/cloudflare` 1.20.16 and wrangler 4.160.0. It ran on local workerd and found:

- **Size fits:** 4.87 MiB uncompressed / 1.03 MiB gzip. Current Cloudflare docs set a 64 MiB uncompressed limit with no compressed limit. The bundle also fits the older 3 MiB Free gzip limit.
- **SSR works under workerd:** static `/`, per-request `/cockpit`, dynamic `/missions/[slug]` with async params and search params, the `/api/health` route handler, static assets, and `next.config` headers. The full Playwright + axe suite passed 30/30 against workerd.
- **Windows builds are fragile:** two symlink problems needed a local shim (`apps/web/scripts/win-symlink-shim.cjs`), and OpenNext recommends WSL/Linux. `sharp` had to be excluded from tracing.
- **Not yet proven (needs an account):** real deploy, **CPU time per SSR request versus the 10 ms Free-plan cap**, logs, rollback, cron/jobs, and image optimisation (needs a paid Cloudflare Images binding or static images).

## Decision (proposed)
1. Use **Cloudflare Workers via `@opennextjs/cloudflare`** as the primary host for `apps/web`, as long as the account checks in step 2 pass.
2. Before accepting, run the real preview deploy on the Free account (steps in the spike doc) and record:
   - P50/P99 CPU time for `/cockpit` and `/missions/excel-sum-101`
   - `wrangler tail` output
   - a `wrangler rollback` drill
3. **Production builds run on Linux** (GitHub Actions or Cloudflare Workers Builds), never on the Windows dev PC. The Windows shim is only for local spikes.
4. **Plan:** start on Free for previews. Move to **Workers Paid** before real learners if measured SSR CPU time is close to 10 ms, or once Supabase calls are added. Paid allows 30 s CPU by default and 10,000 subrequests.
5. **Jobs:** use Cron Triggers/Queues in a **separate small Worker** that shares `packages/*` code. This keeps the OpenNext entry point unmodified.
6. **Images:** use static, pre-sized assets for now (`images.unoptimized: true`). Revisit Cloudflare Images when course media needs it.

## Fallback trigger (switch to Vercel)
Switch to Vercel if any of these happens:
- the real deploy fails, or SSR breaks on the edge;
- measured CPU time cannot fit even the Paid plan's budget for typical pages;
- logs or rollback cannot be shown;
- a required Next.js feature is unsupported by OpenNext. Watch the peer range: next `>=16.4.5` today, and new Next majors may lag.

The app has no Cloudflare-specific code beyond `wrangler.jsonc`, `open-next.config.ts` and the `cf:*` scripts, so it deploys to Vercel unchanged.

## Consequences
- Low cost and global edge delivery, and the same account can host jobs, R2 and KV later.
- OpenNext adds an adapter layer that must be upgraded alongside Next.js, so pin both and upgrade together.
- The 10 ms Free CPU cap is the main risk to SSR, and it can only be measured with a real deploy.
- Developers on Windows depend on the shim or WSL for `cf:build`; `next dev` and `next build` are unaffected.

## Review
Accountable reviewer: _pending_. Evidence: `docs/architecture/CLOUDFLARE-SPIKE.md`, `docs/design/ACCESSIBILITY-REVIEW.md`.
