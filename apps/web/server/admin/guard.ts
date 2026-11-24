
// SERVER-ONLY. Route guard for /admin. Signed-out visitors go to sign-in (like /cockpit); anyone who is signed in
// but is not an ACTIVE admin gets the ordinary 404 page, so the admin area does not reveal that it exists.
// The check is made by the database (fd_admin_user_facts), not read from the session or a cookie.
// Admins must also use two-step sign-in (ADR-010): no authenticator app yet -> set-up page; app set up but this
// session has not confirmed a code -> code page. Both come AFTER the admin check so non-admins learn nothing.
import { notFound, redirect } from "next/navigation";
import { requireUser } from "../auth/session";
import { actorFacts, adminConfig, type AdminConfig, type UserFacts } from "./admin";

export async function requireAdmin(next: string, refreshed = false): Promise<{ userId: string; email: string; cfg: AdminConfig; me: UserFacts }> {
  const { user, factorId, aal } = await requireUser(next, refreshed, { allowAal1: true });
  const cfg = adminConfig();
  const me = await actorFacts(cfg, user.id);
  if (!cfg || !me.ok || !me.value.roles.includes("admin") || me.value.status !== "active") notFound();
  if (!factorId) redirect(`/account/security?required=admin&next=${encodeURIComponent(next)}`);
  if (aal !== "aal2") redirect(`/mfa?next=${encodeURIComponent(next)}`);
  return { userId: user.id, email: user.email, cfg, me: me.value };
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
