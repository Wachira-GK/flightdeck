# FlightDeck Threat Model

## Assets
Accounts, roles, lesson content, learner notes, progress, assessment answers, grades, certificates, payment entitlements and audit logs.

## Trust boundaries
1. Internet to web edge
2. Browser to application API
3. Application to PostgreSQL
4. Application to video, email, payments and analytics
5. Author/reviewer/admin routes
6. Excel simulator runtime to progress/grading service

## Priority abuse cases
- Learner reads or changes another learner's progress.
- Client submits a fabricated Excel exercise pass.
- Author publishes unreviewed content.
- Replayed payment webhook grants duplicate entitlement.
- Certificate is issued without deterministic eligibility.
- Spreadsheet formula causes uncontrolled resource usage or unsafe external access.

## Required evidence
For each abuse case record prevention, detection, test, owner and residual risk.
