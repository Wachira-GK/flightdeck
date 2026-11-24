
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig } from "@/server/auth/session";
import { cleanName } from "@/server/auth/validate";
import { EDITABLE_ROLES, resetMfa, sendResetLink, setName, setRoles, setStatus, type AdminResult } from "@/server/admin/admin";
import { isUuid, requireAdmin } from "@/server/admin/guard";

// Each action: (1) re-checks that the caller is an active admin, (2) takes the actor id from the verified session
// (never from the form), (3) lets the database apply the rules, (4) returns to the user page with ?done= or ?error=.
// Redirect targets are built from a validated UUID only, so they cannot point anywhere else.

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function back(target: string, r: AdminResult<unknown>, done: string): never {
  const q = new URLSearchParams();
  if (r.ok) {
    q.set("done", done);
    if (r.warning) q.set("warn", "1");
  } else q.set("error", r.reason);
  redirect(`/admin/users/${target}?${q.toString()}`);
}

async function begin(fd: FormData) {
  const target = field(fd, "target");
  if (!isUuid(target)) redirect("/admin");
  const a = await requireAdmin(`/admin/users/${target}`);
  return { target, actor: a.userId, cfg: a.cfg };
}

export async function setRolesAction(fd: FormData): Promise<void> {
  const { target, actor, cfg } = await begin(fd);
  const wanted = fd.getAll("role").map(String).filter((r) => (EDITABLE_ROLES as readonly string[]).includes(r));
  back(target, await setRoles(cfg, actor, target, ["learner", ...wanted], cleanReason(field(fd, "reason"))), "roles");
}

export async function setStatusAction(fd: FormData): Promise<void> {
  const { target, actor, cfg } = await begin(fd);
  const status = field(fd, "status") === "suspended" ? "suspended" : "active";
  back(target, await setStatus(cfg, actor, target, status, cleanReason(field(fd, "reason"))), status === "suspended" ? "suspended" : "reactivated");
}

export async function setNameAction(fd: FormData): Promise<void> {
  const { target, actor, cfg } = await begin(fd);
  back(target, await setName(cfg, actor, target, cleanName(field(fd, "name"))), "name");
}

export async function sendResetAction(fd: FormData): Promise<void> {
  const { target, actor, cfg } = await begin(fd);
  back(target, await sendResetLink(cfg, authConfig(), actor, target, await origin()), "reset");
}

export async function resetMfaAction(fd: FormData): Promise<void> {
  const { target, actor, cfg } = await begin(fd);
  back(target, await resetMfa(cfg, actor, target), "mfareset");
}

function cleanReason(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return t || null;
}
