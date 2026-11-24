// SERVER-ONLY. Route guard for /author and /review (ADR-015). Signed-out visitors go to sign-in; anyone signed in who has
// no content role gets the ordinary 404 (the area does not reveal that it exists). What the person may do is read from
// the database (fd_content_list: canWrite / canReview), never from the session or a cookie. Admins must also have
// two-step sign-in set up (ADR-010), exactly as in /admin; everyone else follows the normal rule (a confirmed
// authenticator app is asked for).
import { notFound, redirect } from "next/navigation";
import { requireUser } from "../auth/session";
import type { AdminConfig } from "../admin/admin";
import { contentConfig, listContent, type ContentAccess, type ContentRole, type ContentSummary } from "./content";

/** "any" = any content role (read), "write" = author or admin, "review" = reviewer or admin. */
export type ContentNeed = "any" | "write" | "review";

export async function requireContentRole(
  next: string,
  need: ContentNeed,
  refreshed = false,
): Promise<{ userId: string; email: string; cfg: AdminConfig; role: ContentRole; access: ContentAccess; items: ContentSummary[] }> {
  const { user, factorId } = await requireUser(next, refreshed);
  const cfg = contentConfig();
  const r = await listContent(cfg, user.id);
  if (!cfg || !r.ok) notFound();
  const { role, canWrite, canReview, items } = r.value;
  if ((need === "write" && !canWrite) || (need === "review" && !canReview)) notFound();
  if (role === "admin" && !factorId) redirect(`/account/security?required=admin&next=${encodeURIComponent(next)}`);
  return { userId: user.id, email: user.email, cfg, role, access: { canWrite, canReview }, items };
}
