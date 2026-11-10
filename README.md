# FlightDeck

Mission-control learning platform: Excel and Mathematics first, CodeVerse SQL after measured usage (G5).

Repository: `C:\WebDev\Projects\Flight-Deck\flightdeck` (remote: `Wachira-GK/flightdeck`, private).

## Current milestone
G1 Architecture Foundation. Status and evidence: `docs/architecture/G1-STATUS.md`.

## Approved architecture (G0, 26 Oct 2026)
- Modular monolith in a pnpm + Turborepo monorepo
- Next.js + TypeScript web application (`apps/web`)
- PostgreSQL/Supabase with mandatory grants + Row Level Security (`packages/database`)
- Excel and Mathematics vertical slice first
- Cloudflare Workers compatibility spike, with Vercel as fallback

## Local commands (Windows, no admin)

```powershell
npm i -g pnpm@10      # once; corepack is not bundled with Node 25+
pnpm install
pnpm test:rls         # RLS-T01..T24 against embedded PostgreSQL 17 (PGlite)
pnpm check            # secret scan, lint, typecheck, tests, build
```

AI-generated code and documents are unreviewed until checks pass and an accountable human reviews them (Definition of Done).
