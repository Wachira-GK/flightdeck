# ADR-015: Content workspace (author and reviewer screens, content in the database)

Status: Proposed 2026-11-24 (Godfrey: GREEN for step 2). Builds on ADR-002, ADR-008, ADR-009, ADR-011.

## Goal

Authors add and edit missions without code. A reviewer publishes. Published content is live for learners without a new
deploy. Everything keeps working with progress saving, mission access, grading and the answer-key rules.

## Decision

1. **One document per mission, same shape as today.** A mission is stored as the same JSON the files hold now:
   learner-safe mission, learner-safe exercise, and the SERVER-ONLY keys (assessment keys and exercise key). The same
   validators (`validateExcelMission`, exercise checks, key-leak checks SEED-T06/T07) run on every save. No new content
   format to maintain.
2. **Revisions, not edits.** Table `app_private.content_items` holds every revision of every mission:
   `(slug, revision, status draft|in_review|approved|published|retired, level, code, mission, exercise, keys, author,
   reviewer, notes, timestamps)`. Only one revision per slug is `published`. Old revisions are never changed or deleted.
3. **Roles.** author: create/edit own drafts, submit. reviewer: see submitted items, preview as a learner, publish or
   return with a comment. admin: everything, plus retire. Author cannot publish their own item. All actions are audited.
4. **Answer keys stay server-only.** Keys live only in `app_private`, are never returned to the browser, and the author
   editor sends them to the server only.
5. **Publishing** writes the live rows (`public.missions`, steps, assessments, items, exercises, keys) in the published
   course version in one transaction so progress, access and cockpit keep working with stable mission ids.
6. **Learners keep the revision they started.** The revision is pinned per learner and mission at first start, and every
   saved attempt records it. New learners get the newest published revision.
7. **Read path.** Catalogue, mission page and grading read published content from the database through the server
   (service key, short cache). The built-in files stay as the import source and a fallback if the database cannot be
   read, so a database outage never blanks the catalogue.
8. **Level** (Beginner/Intermediate/Advanced) becomes a database column on the mission.

## Stages (each ships on its own, with tests)

- 2a Database: `content_items`, author/reviewer functions, audit, import of the 51 existing missions as revision 1.
- 2b Server read path with fallback and revision pinning.
- 2c Author screens: list, mission editor (details, steps, questions, practice sheet with editable cells and solution).
- 2d Reviewer screens: queue, preview as learner, publish or return with comment.
- 2e Submit checks: validators, leak scan, and the author's solution must pass its own grader.

## Consequences

- Exams (ADR to follow) reuse revisions and pinning; variants are part of the exercise document.
- Sim Bay reads the same published documents.
- Limits: free Supabase plan; documents are capped (256 KB per item, matching the existing step limit).
