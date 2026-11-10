# ADR-002: Direct owner-only browser writes vs server-only mutations

Status: **Proposed 2026-11-11 — pending Security Architect + Product Owner decision** (open decision from G0).

## Context
Supabase lets the browser write through the Data API, protected by grants + RLS. Every direct write path is attack surface; every server-only path costs a server action and latency.

## Proposal (as implemented in migrations 0100–0300)
Hybrid. The browser may write **only low-risk rows it owns**, each limited by column grants and RLS `WITH CHECK`:

| Allowed browser write | Columns | Guard |
|---|---|---|
| Profile name/locale/timezone, preferences | listed columns only | owner RLS |
| Notes, bookmarks | body / step | owner RLS + step readable |
| Free-course enrolment | course, version | `can_enrol` |
| Start assessment attempt | assessment | enrolled, limit, one open |
| Save answer in open attempt | attempt, item, response | `answer_slot_open` |
| Simulator submission + client evidence | exercise, submission, evidence | enrolled; verdict server-only |

Everything that decides value — completion, score, pass, verdicts, entitlements, payments, certificates, roles, publication, audit — is **server-only** (service_role through invoker functions that check the actor).

## Consequences
+ Fast UX for notes/answers; fewer server actions. + Verdict integrity does not depend on the client.
− More RLS to test (covered by RLS-T01..T24 + mutation check). − If a column grant is widened by mistake, CI must catch it (mutation check proves the suite does).

## Alternative
Server-only for all writes: simplest threat model, more server code, slightly slower notes/answers. Switching later = revoke the listed INSERT/UPDATE grants; no schema change.
