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
3. XLOOKUP-style lookup or documented compatible substitute

The simulator must not claim full Microsoft Excel compatibility.

## File format v0.1 (FD-XLS01)

Each exercise is two JSON files in `content/excel/exercises/`:

- `<id>.json`: **learner-safe** `ExerciseDefinition` (safe to ship to the browser): `schemaVersion`, `id`, immutable `version`, `title`, `objective`, `instructions`, `grid` `{rows, cols}` (max 100 x 30), `starter` (cell inputs; also the reset state), `editableCells`, `allowedFunctions` (subset of SUM, AVERAGE, MIN, MAX, COUNT, IF), `hints`, `namedRanges` (must be `{}` in v0), optional `limits` (calculation budget) and `timeoutMs` (max 500).
- `<id>.key.json`: **server-only** `ExerciseKey` (for `app_private.exercise_keys`; never import it into client code): `expected` value checks, `requireFormula` cells, `requireFunctions` per cell, `hiddenTests` (override locked inputs, expect recomputed outputs), `passThreshold` (default 100). Labels must not reveal expected values.

Completion evidence sent to the server: `{ exerciseId, exerciseVersion, cells }` with the editable cells' inputs only. The server recomputes everything with `validateSubmission` (see `docs/architecture/EXCEL-ENGINE.md`).

Starter exercises: `sum-relative-refs`, `if-business-thresholds`, `commission-tier-if-chain` (nested IF over a tier table: the documented lookup substitute).
