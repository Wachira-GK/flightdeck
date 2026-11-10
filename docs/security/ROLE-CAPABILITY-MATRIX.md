# FlightDeck role / capability matrix (RBAC)

Status: **AI-drafted 2026-11-11, pending Security Architect + Product Owner review.**
Roles live in `public.user_roles` (written only by the server). Enforcement: DB grants + RLS (`docs/security/RLS-MATRIX.md`) and server-side checks in invoker functions. ✔ = allowed, ✖ = denied, S = only through a server action (service_role) that checks the actor.

| Capability | anon | learner | author | reviewer | support | admin | Enforced by |
|---|---|---|---|---|---|---|---|
| Browse published catalogue, missions, safe exercise definitions | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | RLS `catalogue_read` |
| See assessments/items of published versions | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | grant to authenticated + RLS |
| Read own profile / preferences; edit name, locale, theme | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | column grants + owner RLS |
| Enrol in free published course | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | `can_enrol` (RLS-T23) |
| Enrol in paid course | ✖ | entitlement | entitlement | entitlement | entitlement | entitlement | `can_enrol` (RLS-T22) |
| Mark progress / completion | ✖ | S | S | S | S | S | no client grant (RLS-T10) |
| Write notes and bookmarks (own) | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | owner RLS (RLS-T06..T08) |
| Start assessment attempt | ✖ | enrolled | enrolled | enrolled | enrolled | enrolled | `can_start_attempt` (RLS-T12) |
| Save answers in own open attempt | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | `answer_slot_open` (RLS-T13/T14) |
| Grade, score, pass | ✖ | ✖ | ✖ | ✖ | ✖ | S | server only (RLS-T11) |
| Submit simulator evidence | ✖ | enrolled | enrolled | enrolled | enrolled | enrolled | `can_attempt_exercise` (RLS-T15) |
| Simulator verdict | ✖ | ✖ | ✖ | ✖ | ✖ | S | `record_exercise_verdict` |
| Read another user's learner data | ✖ | ✖ | ✖ | ✖ | S (ticketed, audited) | S (audited) | no RLS path; server-mediated |
| Create / edit draft content | ✖ | ✖ | S | ✖ | ✖ | S | server actions (G2) |
| Read own drafts | ✖ | ✖ | ✔ | assigned only | ✖ | ✔ | `can_read_version` (RLS-T18/T19) |
| Publish a version | ✖ | ✖ | ✖ (never own) | S (assigned, not author) | ✖ | ✖ unless assigned | `publish_course_version` (RLS-T18/T19) |
| Assign reviewers | ✖ | ✖ | ✖ | ✖ | ✖ | S | server only |
| Grant / revoke roles | ✖ | ✖ | ✖ | ✖ | ✖ | S | no client grant (RLS-T21) |
| Issue / revoke certificate | ✖ | ✖ | ✖ | ✖ | ✖ | S | server only (RLS-T21) |
| Verify certificate by code | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | `verify_certificate()` (RLS-T24) |
| Create entitlement / record payment | ✖ | ✖ | ✖ | ✖ | ✖ | S | webhook handler only (RLS-T21, DB-I01) |
| Read audit log / outbox / webhooks | ✖ | ✖ | ✖ | ✖ | ✖ | S | `app_private`, no grants (RLS-T20) |

Separation of duties: the author of a version can never publish it, even with admin role (`publish_course_version` checks `actor ≠ created_by` and an explicit reviewer assignment).
Public learner profiles are excluded from the MVP.
