# ADR-013: Audit log screen

Status: accepted (24 Nov 2026).

The audit log (app_private.audit_log) was append-only but had no way to be read except SQL. Admins now have /admin/audit: newest first, 50 per page, filter by action, readable names for people. It reads through one service-role function (fd_admin_audit_list) that checks the caller is an active admin. The log stays append-only (no edit or delete anywhere). Opening the first page is itself recorded (admin_view_audit); later pages and filters are not, to avoid noise. Details can contain names (for example a changed display name), so the screen is admin-only. Not built yet: export to CSV, search by person, alerts on unusual actions.
