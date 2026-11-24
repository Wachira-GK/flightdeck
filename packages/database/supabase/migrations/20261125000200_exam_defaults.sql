-- Exam v1 is questions only (drawn from each level's missions). Spreadsheet tasks inside exams come later, so the
-- default is 10 questions and 0 sheet tasks. Admins can change these with fd_admin_exam_set.
alter table app_private.exam_config alter column sheet_tasks set default 0;
alter table app_private.exam_config alter column questions set default 10;
update app_private.exam_config set sheet_tasks = 0, questions = 10;
