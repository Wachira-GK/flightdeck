# FlightDeck privacy / personal-data map

Status: **AI-drafted 2026-11-11, pending Security Architect + Product Owner review.** Jurisdiction focus: Kenya Data Protection Act 2019 (ODPC); also GDPR-style principles for non-Kenyan learners.

## 1. Personal data inventory

| Data | Table / system | Purpose | Lawful basis | Who can read | Retention (proposed — OPEN DECISION) |
|---|---|---|---|---|---|
| Email, auth identifiers | Supabase Auth | Sign-in, notices | Contract | Owner, server | Account life + 30 days |
| Display name, locale, timezone | `profiles` | Personalisation, certificates | Contract | Owner | Account life |
| Preferences | `user_preferences` | UX, consent to product email | Consent (email) / contract | Owner | Account life |
| Enrolments, progress | `enrolments`, `step_progress` | Learning delivery | Contract | Owner | Account life |
| Notes, bookmarks | `notes`, `bookmarks` | Learner tools | Contract | Owner | Account life |
| Assessment answers, grades | `assessment_attempts`, `assessment_answers` | Assessment, certification | Contract | Owner (+ server) | 24 months after attempt |
| Simulator submissions + evidence | `exercise_attempts` | Validation | Contract | Owner (+ server) | 12 months |
| Certificates | `certificates` | Proof of completion | Contract / legitimate interest | Owner; public verify = course + date only | Indefinite (until revoked/erased on request) |
| Entitlements, payments | `entitlements`, `app_private.payments` | Access, accounting | Contract / legal obligation | Owner (entitlement), server | 7 years (tax records) |
| Webhook payloads | `app_private.webhook_events` | Payment proof, replay protection | Legal obligation | Server | 13 months |
| Audit log | `app_private.audit_log` | Security accountability | Legitimate interest | Server/admin | 24 months |
| Product analytics | PostHog | Product measurement (G5) | Consent | Analysts | 12 months, pseudonymous user id only |
| Errors | Sentry | Reliability | Legitimate interest | Engineers | 90 days, scrubbed |

## 2. Data flows to processors (TB5)
Supabase (DB/Auth), Cloudflare or Vercel (hosting), Bunny (video, no PII), Resend (email address + template data), PostHog (pseudonymous id + events), Sentry (scrubbed errors), Paystack (payer data held by Paystack; FlightDeck stores reference, amount, status only).

## 3. Data-subject rights
Access/export: server job assembles owner rows from all owner-only tables. Erasure: delete `auth.users` row → `on delete cascade` removes owner data; payments retained (legal obligation) with user link pseudonymised. Requests logged in `audit_log`.

## 4. Open decisions
1. Retention periods above are proposals — Product Owner to confirm (brief: "retention periods for events/answers/audit").
2. Data residency of the Supabase region (EU vs nearest region) and ODPC registration need.
