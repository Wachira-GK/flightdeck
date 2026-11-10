# Cloudflare Workers compatibility spike (G1)

Status: **local spike complete. Real-account items pending.** Date: 11 Nov 2026. Decision record: `docs/decisions/ADR-003-hosting-spike.md`.
Environment: Windows 11, no admin rights, Node 26.3.0 (CI uses Node 22), pnpm 10.34.9.

## Versions

| Package | Version | Notes |
|---|---|---|
| next | 16.4.6 | Newest Next.js major that the adapter supports. `@opennextjs/cloudflare@1.20.16` peer range: `next >=15.5.29 <16 \|\| >=16.4.5` |
| react / react-dom | 19.3.1 | |
| @opennextjs/cloudflare | 1.20.16 | Uses @opennextjs/aws 4.1.15 |
| wrangler | 4.160.0 | Peer needs `^4.148.0`. It pulls miniflare 5.20261110.0-beta and workerd 1.20261110.1 |
| Build | Turbopack (Next 16 default) | No `--webpack` fallback needed |

Config files: `apps/web/wrangler.jsonc` (worker `flightdeck-web`, `nodejs_compat`, assets binding, self-reference service binding, `workers_dev: true`, observability on, no account ID, no secrets) and `apps/web/open-next.config.ts` (default, no incremental cache).

## Commands run and results

| # | Command (from `apps/web`) | Result |
|---|---|---|
| 1 | `pnpm build` (`next build`) | **Pass**. Routes: `/` static, `/cockpit` dynamic, `/missions/[slug]` dynamic, `/api/health` dynamic |
| 2 | `pnpm cf:build` (`node scripts/cf.mjs build` → `opennextjs-cloudflare build`) | **Pass** after two Windows-only fixes (below). Output: "OpenNext build complete" |
| 3 | `pnpm exec wrangler deploy --dry-run --outdir .wrangler/dryrun` | **Pass**. `Total Upload: 4988.06 KiB / gzip: 1053.02 KiB`. 21 static asset files |
| 4 | `pnpm cf:preview` (`opennextjs-cloudflare preview --ip 127.0.0.1 --port 8787`, local **workerd**) | **Pass**. workerd runs on this PC without admin |
| 5 | `curl http://127.0.0.1:8787/…` | See SSR results |
| 6 | `PW_BASE_URL=http://127.0.0.1:8787 pnpm test:e2e` | **30/30 pass** (axe + keyboard + health) against workerd |

### Worker size against limits

| Measure | FlightDeck | Limit |
|---|---|---|
| Uncompressed bundle (`Total Upload`) | **4,988 KiB ≈ 4.87 MiB** | **64 MiB** on Free and Paid (current Cloudflare docs) |
| gzip (`wrangler` reference figure) | **1,053 KiB ≈ 1.03 MiB** | Historical limits **3 MiB Free / 10 MiB Paid** (compressed) |

Verified 11 Nov 2026 at https://developers.cloudflare.com/workers/platform/limits/. The page now says: "There is no compressed size limit. Only the uncompressed bundle size counts". It lists **64 MiB** for both plans, and the gzip figure is "shown for reference but is not a limit". The brief assumed the older 3 MiB / 10 MiB compressed limits. We fit comfortably under both the old and the new rules: about 34% of the old Free 3 MiB gzip limit and about 8% of the 64 MiB uncompressed limit.

Other Free-plan limits from the same page matter more than size:
- **CPU time: 10 ms per HTTP request on Free** (Paid: 30 s default, up to 5 min).
- 50 subrequests per invocation on Free (Paid: 10,000).
- 20,000 static asset files per version on Free.
- Worker startup must finish within 1 s.

Measured local latencies were 120–500 ms wall time on cold-ish requests. That is wall time on this PC, not billed CPU time. **We cannot measure the real CPU time per SSR render without an account.** The 10 ms Free CPU cap is the main risk for SSR on Free (see ADR-003).

### SSR results under workerd (`127.0.0.1:8787`)

| Request | Result |
|---|---|
| `GET /api/health` (route handler) | **200** `application/json` `{"status":"ok","service":"flightdeck-web","time":"…"}`. The time changes per request, so the handler is dynamic |
| `GET /` (static prerender) | **200** HTML, `h1` "Learn Excel and the maths behind your numbers…" |
| `GET /cockpit` (`force-dynamic`) | **200** HTML server-rendered per request, `h1` "Good evening, Amina." (greeting computed in Africa/Nairobi time) |
| `GET /missions/excel-sum-101?step=simulation` (dynamic, async `params`/`searchParams`) | **200** HTML, step rail + placeholder grid |
| `GET /missions/nope` | Not-found page (soft 404, HTTP 200, `noindex`, same as Node) |
| CSS chunk `/_next/static/chunks/*.css` | **200** `text/css` from the Workers Assets binding |
| Security headers from `next.config.ts` | Present (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`) |

### Windows-only build problems and fixes

1. **`EPERM: operation not permitted, symlink`**: OpenNext re-creates pnpm symlinks in `.open-next/`. Windows needs admin rights or Developer Mode to create symlinks.
2. **Links escaping `.open-next`**: on Windows, Next's standalone output stores pnpm links as junctions with *absolute* targets inside `.next/standalone`. OpenNext copied those targets as they were, so the bundle loaded the **unpatched** `next-server.js`. At runtime under workerd this failed with `Dynamic require of "/.next/server/middleware-manifest.json" is not supported` (every route returned 500).

**Fix:** `apps/web/scripts/win-symlink-shim.cjs`, preloaded only by `scripts/cf.mjs`. It (a) re-roots absolute `.next/standalone` link targets into the matching `.open-next/server-functions/<fn>` tree, as Linux does with relative links, and (b) retries an EPERM symlink as a directory junction (no admin needed) or as a file copy. The shim does nothing on non-Windows platforms. OpenNext itself warns that Windows is "not fully compatible" and recommends WSL, so **production builds should run on Linux (CI or Cloudflare Workers Builds)**.

3. **`sharp` native binaries** (`No loader is configured for ".node" files`): Next 16.4 traces `sharp` for its built-in image optimiser. Images are `unoptimized: true` in this prototype, so `outputFileTracingExcludes` removes `sharp`/`@img/*` from the trace. This is probably needed on Linux too, but it is unverified there.

## Images

The G1 prototype ships no raster images. `next.config.ts` sets `images.unoptimized: true`. To optimise images on Workers, OpenNext uses **Cloudflare Images** through an `IMAGES` binding (`"images": { "binding": "IMAGES" }` in `wrangler.jsonc`). Its docs warn this "can incur additional costs" (https://opennext.js.org/cloudflare/howtos/image). Options for later: (a) pre-sized static images in Workers Assets (free, simplest), (b) Cloudflare Images binding (paid usage), (c) external image CDN loader. Not tested.

## Not testable without an account

- Real deploy to `*.workers.dev`, TLS, and real cold-start and **CPU-time per request** against the 10 ms Free cap.
- Workers Logs / `wrangler tail` (observability is enabled in config).
- Rollback (`wrangler rollback`, `wrangler deployments list`) and gradual deployments / versions.
- Preview URLs per version (`preview_urls: true` is set).
- Cron Triggers / Queues for jobs (outbox processing, certificate generation). OpenNext's worker exports only `fetch`. A scheduled handler would need a custom worker entry or a separate Worker.
- Incremental cache (R2/KV) for ISR. Not needed: every route is static or `force-dynamic`.
- Secrets (`wrangler secret put`) and Supabase connectivity from Workers.

## Steps for Godfrey: real preview deploy on the Cloudflare FREE account

Run these in PowerShell on the work PC. No admin is needed. `wrangler login` opens a browser to authorise.

```powershell
cd C:\WebDev\Projects\Flight-Deck\flightdeck
pnpm install
cd apps\web

# 1. Sign in. A browser window opens: log in to Cloudflare and click "Allow".
pnpm exec wrangler login
pnpm exec wrangler whoami            # confirm the right account

# 2. Build for Workers (uses the Windows shim automatically).
pnpm cf:build

# 3. Optional: test locally on workerd first.
pnpm exec opennextjs-cloudflare preview --ip 127.0.0.1 --port 8787   # then open http://127.0.0.1:8787

# 4. Deploy to <name>.<your-subdomain>.workers.dev
#    The first time, Wrangler may ask you to pick a workers.dev subdomain in the dashboard.
node scripts/cf.mjs deploy

# 5. Smoke test (replace the URL with the one wrangler prints).
curl https://flightdeck-web.<your-subdomain>.workers.dev/api/health
#    then open /, /cockpit, /missions/excel-sum-101 in a browser

# 6. Evidence for G1 (copy the output into this document).
pnpm exec wrangler deployments list
pnpm exec wrangler tail flightdeck-web          # live logs; refresh /cockpit while it runs
#    Dashboard > Workers & Pages > flightdeck-web > Metrics: note "CPU time" median/P99 for /cockpit

# 7. Rollback drill: deploy a trivial change, then
pnpm exec wrangler rollback                     # choose the previous version, then re-check /api/health

# 8. Clean up when done (optional).
pnpm exec wrangler delete flightdeck-web
```

Do not commit `.dev.vars`, `.wrangler/` or `.open-next/`. They are git-ignored in `apps/web/.gitignore`. No secrets are needed for the prototype.

## Real deploy on Cloudflare FREE account — 2026-11-11 (evidence)

Account: Godfrey's personal Cloudflare Free account (logged in with `wrangler login`, OAuth). URL: `https://flightdeck-web.godmarklee.workers.dev`.

| Check | Result |
|---|---|
| Deploy (`node scripts/cf.mjs deploy`) | ✔ 17 assets, upload 4,988 KiB / gzip 1,053 KiB, **worker startup 17 ms**, version `16adc846` |
| SSR routes live | ✔ `/`, `/cockpit`, `/missions/excel-sum-101?step=simulation` → 200; warm responses 40–120 ms; first (cold) 0.7–1.1 s |
| Route handler | ✔ `/api/health` → 200 JSON |
| Security headers | ◐ `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy` present; **CSP and HSTS not yet set** (ASVS V14.4, G2) |
| Unknown mission | ◐ soft 404 (200 + `noindex`) — known review item |
| **CPU time per request** (`wrangler tail --format json`, 11 sampled requests) | `/` 9–11 ms · `/cockpit` 6–10 ms · `/missions/…` 7–10 ms · `/api/health` 3–4 ms. All outcomes `ok` (none killed). |
| Logs | ✔ `wrangler tail` live JSON logs with CPU/wall time |
| Rollback drill | ✔ deployed `9c0f417d`, `wrangler rollback 16adc846 --message "G1 rollback drill"` → 100% traffic back on `16adc846` in seconds; `/api/health` 200 |
| Not tested | cron/jobs (none yet), image optimisation (disabled: `unoptimized: true`), custom domain |

**Verdict:** compatibility PASS. The prototype runs on Workers with SSR, route handlers, assets, logs and rollback.
**CPU risk confirmed:** mock-data SSR already uses 6–11 ms, i.e. at the Free plan's 10 ms cap. Real pages (Supabase queries, auth) will cost more. → Production must run on **Workers Paid** (as approved at G0: "Cloudflare Workers Paid"); Free is suitable only for this preview. Vercel fallback not triggered.
