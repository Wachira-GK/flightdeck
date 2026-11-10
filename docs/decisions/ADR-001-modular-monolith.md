# ADR-001: Modular monolith before microservices

Status: Accepted on 26 October 2026

## Decision
Use one monorepo and one principal web deployment. Enforce identity, catalogue, content, progress, assessment, certification and integration boundaries in code.

## Consequences
Simpler local development, deployment, secrets and transactions. A module may be extracted only after measured scale or isolation requirements justify the operational cost.
