# Gate 1 Acceptance

Gate 1 is ready only when all evidence exists:

- Threat model identifies trust boundaries and priority abuse cases.
- ERD covers identity, versioned content, enrolment, progress, assessment, certificates, outbox and audit.
- Every client-reachable table has explicit grants, RLS policies and negative tests.
- Design tokens and accessible Cockpit/lesson prototypes are reviewed.
- CI runs formatting, linting, type checks, unit tests, RLS tests, build and smoke tests.
- Cloudflare compatibility spike verifies SSR, route handlers, images, jobs, logs and rollback, or documents the Vercel fallback decision.
