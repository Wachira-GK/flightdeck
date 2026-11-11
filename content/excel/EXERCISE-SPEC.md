# Excel Simulator Exercise Contract v0.1

Each exercise defines:
- ID and immutable version
- Learning objective
- Starter grid and named ranges
- Allowed formula subset
- Expected value or formula-normalisation rules
- Hints and reset state
- Maximum grid size and calculation budget
- Completion evidence sent to the server

## Gate 3 starter exercises
1. SUM and relative references
2. IF with business thresholds
3. XLOOKUP exact-match lookup (`xlookup-price-list`); nested-IF tier table as the approximate-match alternative

The simulator must not claim full Microsoft Excel compatibility.

## File format v0.1 (FD-XLS01)

Each exercise is two JSON files in `content/excel/exercises/`:

- `<id>.json`: **learner-safe** `ExerciseDefinition` (safe to ship to the browser): `schemaVersion`, `id`, immutable `version`, `title`, `objective`, `instructions`, `grid` `{rows, cols}` (max 100 x 30), `starter` (cell inputs; also the reset state), `editableCells`, `allowedFunctions` (subset of SUM, AVERAGE, MIN, MAX, COUNT, IF, XLOOKUP), `hints`, `namedRanges` (must be `{}` in v0), optional `limits` (calculation budget) and `timeoutMs` (max 500).
- `<id>.key.json`: **server-only** `ExerciseKey` (for `app_private.exercise_keys`; never import it into client code): `expected` value checks, `requireFormula` cells, `requireFunctions` per cell, `hiddenTests` (override locked inputs, expect recomputed outputs), `passThreshold` (default 100). Labels must not reveal expected values.

Completion evidence sent to the server: `{ exerciseId, exerciseVersion, cells }` with the editable cells' inputs only, posted to `POST /api/exercises/<id>/check`. The server recomputes everything with `validateSubmission` (see `docs/architecture/EXCEL-ENGINE.md` §4.1). Nothing is saved yet.

Registering a new exercise: add the learner-safe JSON to `apps/web/components/excel/exercises.ts` and the key to `apps/web/server/excel-keys.ts` (never the other way round). The key-leak script picks up key files automatically.

Starter exercises: `sum-relative-refs`, `if-business-thresholds`, `commission-tier-if-chain` (nested IF over a tier table: approximate-match lookup without XLOOKUP), `xlookup-price-list` (exact-match XLOOKUP with `if_not_found`).

## Missions

Missions are data-driven: `content/excel/missions/<slug>.json` (learner-safe; steps briefing, training, simulation, assessment, debrief; one `exerciseId` mounted in the simulation step) and `<slug>.keys.json` (server-only assessment keys: `numeric` with `expected` + `tolerance`, or `single-choice` with `correctOptionId`; each with a `rationale`). Contract and checks: `apps/web/components/excel/missions.ts`.
