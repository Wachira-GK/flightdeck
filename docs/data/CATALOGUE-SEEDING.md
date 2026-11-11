# Catalogue seeding (FD-C01)

Status: draft, AI-generated, for Data Architect + Security Architect review. Last verified: 11 Nov 2026.
**Supabase: PAUSED.** No Supabase project exists yet. Everything below runs on the embedded PostgreSQL 17 (PGlite) test harness in `packages/database`. The Supabase steps only apply once the owner creates the project.

## Pipeline

```
content/excel/exercises/<id>.json          learner-safe exercise      -> public.exercises.definition
content/excel/exercises/<id>.key.json      expected + hidden tests    -> app_private.exercise_keys
content/<dir>/missions/<slug>.json         learner-safe mission       -> public.missions, public.mission_steps,
                                                                         public.assessments, public.assessment_items
content/<dir>/missions/<slug>.keys.json    assessment answer keys     -> app_private.assessment_item_keys
packages/database/seeds/catalogue.config.json   tracks, courses, versions, seed actors
        |
        |  pnpm --filter @flightdeck/database seed:generate   (node scripts/generate-seed.ts)
        v
packages/database/seeds/catalogue.sql      content (safe for any environment)
packages/database/seeds/local-users.sql    placeholder author/reviewer (LOCAL/TEST ONLY)
```

Both SQL files are generated and committed. Do not edit them by hand.

| Command | What it does |
|---|---|
| `pnpm --filter @flightdeck/database seed:generate` | Validate content and rewrite both SQL files |
| `pnpm --filter @flightdeck/database seed:check` | Exit 1 if the committed SQL differs from the content (no writes) |
| `pnpm --filter @flightdeck/database test` | RLS suite plus `test/seed.test.ts`. SEED-T09 fails on drift, so CI catches a content change without a regenerate |

### Mapping rules

- **Tracks and courses** come from `catalogue.config.json`. Each track maps to one `content/<dir>` folder. Each published track has exactly one course that receives its content: Excel Masterclass → Excel Foundations, MathLab → Statistics Foundations. Both courses are free. CodeVerse SQL is seeded as a `draft` track with no course, so anon cannot see it in the database. The web catalogue shows it as "Coming later".
- **Course versions**: `version` from config, `status = published`, `created_by` = seed author, `published_by` = seed reviewer, `published_at` = config `publishedAt` (a fixed timestamp, so output is deterministic). The seed also writes the matching `app_private.review_assignments` row and one `publish` row in `app_private.audit_log`.
- **Excel exercises**: every `<id>.json` in `content/excel/exercises` goes into the Excel course version, including exercises no mission uses yet. The whole learner-safe file becomes `definition`. The key file (without `hiddenTests`) becomes `expected`, and `hiddenTests` becomes `hidden_tests`.
- **Math missions**: `datasets` + `practice` become one `math` exercise, `<slug>-practice`. Its key holds the practice answers, computed from the public datasets with the same conventions as `packages/math`.
- **Missions**: `position` follows the mission code (EX-101, EX-102 ...). Each step becomes a `mission_steps` row. `kind` comes from the step `id` (or `kind`), and `body` = `{ stepId, blocks, ... }`. A simulation step links the exercise named by a step-level `exerciseId`, otherwise the mission-level `exerciseId`, otherwise (math) the mission's practice exercise. The assessment step links the mission's assessment.
- **Assessments**: one per mission (`<slug>-assessment`). `pass_mark` = `passMark × 100` and `max_attempts` = 3. Each item's `prompt` = `{ itemId, text, answerHint?, dataset? }`, and `options` is stored as-is. `correct` = the key entry without `id`/`rationale`, and `explanation` = `rationale`.
- **Ids** are stable UUIDs (SHA-1, v5 layout) derived from the slug path, for example `mission/<course>/<version>/<slug>`. A new course version therefore gets new row ids for all of its content.
- **Idempotent**: every insert is `on conflict do nothing`, and the audit row is guarded with `not exists`, so re-running on the same database changes nothing. The whole file runs in one transaction.

### Validation (the generator fails loudly)

Duplicate mission slugs or codes, a file name that does not match its slug or id, an invalid step kind, a duplicate step kind, a simulation step without an existing exercise, an assessment step without items, an assessment item without a key, a key without an item, a `correctOptionId` that is not an option, an exercise without a key, an `expected` cell that is not editable or is pre-filled, a key/exercise version mismatch, and any answer-bearing property (`expected`, `hiddenTests`, `correct*`, `rationale`, `answer`, `solution` ...) anywhere in a public file or public column.

## Versioning rule

Published content is immutable. **A new content round = a new `course_versions` row. Never edit published rows.**

1. Edit `content/**`. If an exercise changes, bump its `version` in both the exercise file and the key file.
2. Bump the course's `version` in `catalogue.config.json` and write a `changeNote`.
3. Run `seed:generate`. The new version gets fresh ids. Rows of the old version are untouched, because `on conflict do nothing` never updates.
4. In a live database, the new version goes through review and `app_private.publish_course_version` (assigned reviewer, not the author). That function retires the old version. Enrolments stay pinned to the version they enrolled in.

The seed only *creates* a published version in an empty database. Against a database that already has version N published, inserting version N+1 as `published` breaks `course_versions_one_published_idx`. That is deliberate: production promotion goes through the publish function, not the seed.

## Key-handling rule

- Answers, expected values, hidden tests and rationales live **only** in `*.key.json` / `*.keys.json` and in `app_private.exercise_keys` / `app_private.assessment_item_keys`. No grant exists for `anon` or `authenticated` on these tables, RLS is enabled with no policy, and the schema is not exposed by the Data API.
- Learner-safe content goes into public tables. Anon sees published tracks, courses, versions, missions, steps and exercises. Assessments and items need a signed-in user.
- Web code must never import a key file. `apps/web/lib/catalogue.ts` reads only mission files and skips key files.
- Evidence: SEED-T05 (keys unreadable by anon and learner, readable by service_role), SEED-T06/T07 (no expected values in public exercise definitions, steps or items), and the generator's forbidden-property check.

## Seed users (local/test only)

`course_versions.created_by`/`published_by` reference `auth.users`. `catalogue.sql` looks the actors up **by email** (`content-author@flightdeck.local`, `content-reviewer@flightdeck.local`). If either is missing, it aborts with a clear error.

- **Local/test:** apply `local-users.sql` first. It inserts two password-less placeholder `auth.users` rows with fixed ids and gives them the `author`/`reviewer` roles. A production database can block it: `alter database postgres set flightdeck.allow_local_seed_users = 'off'` makes the file raise an error.
- **Production:** never apply `local-users.sql`. Instead, create two real accounts (Dashboard → Authentication) with the emails in `catalogue.config.json`, grant them `author`/`reviewer`, and then run `catalogue.sql`. To use different people, change `seedActors` in the config and regenerate.

## Applying on Supabase later (PAUSED until the owner creates the project)

1. `supabase init` in `packages/database`, keeping `supabase/migrations/`.
2. In `supabase/config.toml`, list the seeds for local resets:
   ```toml
   [db.seed]
   enabled = true
   sql_paths = ["../seeds/local-users.sql", "../seeds/catalogue.sql"]
   ```
   Order matters: users first.
3. Local: `supabase db reset` applies the migrations and then the seeds.
4. Remote (staging/production): `supabase db push` for migrations. Then create the two actor accounts and run **only** `catalogue.sql` (for example `psql "$DATABASE_URL" -f seeds/catalogue.sql`). Remote seeding is a one-off bootstrap. Later content rounds follow the versioning rule above.

## Web catalogue

`/catalogue` is a static page (`dynamic = "force-static"`, no searchParams or cookies) built from `apps/web/lib/catalogue.ts`. That file reads `catalogue.config.json` and `content/*/missions/*.json` at build time. Missions whose content file does not exist yet, or is invalid, are left out.

The data source sits behind `CatalogueSource.listTracks(): Promise<CatalogueTrack[]>`. To move to Supabase, implement the same interface with anon queries on `tracks`, `courses`, `course_versions` (published) and `missions`, and switch `catalogueSource`. Keep the page static and rebuild or revalidate on publish.

**Schema gap:** mission `code` (EX-101) and `estimatedMinutes` have no column in `public.missions` today. A Supabase-backed source needs a migration (for example `missions.code text`, `missions.estimated_minutes integer`) before it can match the content source.
