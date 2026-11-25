-- Exams: switch on 2 spreadsheet tasks per exam (graded on the server with the same engine as the missions).
-- Admins can change this at /admin/exams.
-- (When applied to the live database on 25 Nov 2026 an 'exam_defaults' audit row was also written by hand; not repeated here
-- because the seed test counts audit rows.)
update app_private.exam_config set sheet_tasks = 2, updated_at = now() where sheet_tasks = 0;
