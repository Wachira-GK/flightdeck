# ADR-017: Sim Bay merged under /simbay (gateway, shared sign-in, split CSP)

Status: accepted (Godfrey GREEN, plan A+B+C, 24 Nov 2026). Built 25 Nov 2026 (FlightDeck c703172, Sim Bay f45704c).

## Context
Sim Bay (Excel simulator, Worker `excel-sim`) had its own address, sign-in and database tables. Learners should meet one product: one sign-in, one database, a button from a mission into Sim Bay and back.

## Decision
1. Sim Bay tables live in the shared Supabase database (migration 20261125000300), default-deny, answer keys only in `app_private`.
2. FlightDeck serves Sim Bay at `/simbay` through a gateway (`server/simbay-proxy.ts`) that calls the `excel-sim` Worker over a service binding (`SIMBAY`).
3. The browser never holds a token. The gateway reads the HttpOnly FlightDeck session cookie, adds the Authorization header itself (only when signed in; two-step respected), drops any browser-supplied Authorization/Cookie, checks Origin on POST, allows only GET/HEAD/POST and validated paths. Page entry requires sign-in.
3b. The old address redirects (308) to `/simbay` unless the request carries the gateway marker header.
4. Content-Security-Policy is split: the normal policy everywhere except `/simbay`, which adds `'wasm-unsafe-eval'` and `blob:` images (the spreadsheet engine needs them). Nothing else is relaxed.
5. Mission pages show "Open in Sim Bay" (hidden below 1024 px); Sim Bay shows "Back to mission" (return target validated by regex) and a narrow-screen message.

## Consequences
- One account, one cookie, no token in the browser; the key `SUPABASE_SERVICE_ROLE_KEY` is a secret on the `excel-sim` Worker (entered by the owner, never by Claude).
- Engine parity checked across 50 missions (2,116 cells, 0 differences).
- Not done: Sim Bay lessons are not tied to the 50 missions; Sim Bay scores do not feed exams or Cockpit.
- Tests: SBX-T01..04 (database), SBP-01..06 (gateway), parity test in the Sim Bay repo.
