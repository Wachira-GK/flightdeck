
// SERVER-ONLY. User administration (ADR-009). Uses the SERVICE ROLE key (bypasses row-level security), so:
//   - import this module only from server components, server actions and route handlers, never from a
//     "use client" file (scripts/check-key-leak.mjs fails the build if the key reaches .next/static);
//   - the actor id must be the VERIFIED session user, never a value from a form or URL;
//   - every rule (who may change whom) is enforced again inside the database functions of migration
//     20261123000800, so this layer only adds Supabase Auth calls (emails, ban) and error text.
// Admins never set or see a password: "reset" emails the person a one-time link (PKCE verifier kept server-side).
import { requestPasswordReset, type AuthConfig } from "../auth/gotrue";
import { challengeFor, newVerifier } from "../auth/pkce";

export const ROLES = ["learner", "author", "reviewer", "support", "admin"] as const;
/** Roles an admin can switch on or off: "learner" is always kept. */
export const EDITABLE_ROLES = ["author", "reviewer", "support", "admin"] as const;

export interface AdminConfig {
  url: string;
  serviceKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** null when the server has no service key (administration is then switched off). */
export function adminConfig(): AdminConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
}

export type AdminFailure =
  | "forbidden"
  | "unknown_user"
  | "master_protected"
  | "self_change"
  | "invalid_role"
  | "invalid_status"
  | "invalid_name"
  | "invalid_request"
  | "too_many"
  | "rate_limited"
  | "not_configured"
  | "unavailable";

export type AdminResult<T> = { ok: true; value: T; warning?: string } | { ok: false; reason: AdminFailure };

const KNOWN: ReadonlySet<string> = new Set<AdminFailure>([
  "forbidden",
  "unknown_user",
  "master_protected",
  "self_change",
  "invalid_role",
  "invalid_status",
  "invalid_name",
  "invalid_request",
  "too_many",
]);
const fail = (reason: AdminFailure): { ok: false; reason: AdminFailure } => ({ ok: false, reason });
const reasonOf = (json: unknown): AdminFailure => {
  const r = (json as { reason?: unknown } | null)?.reason;
  return typeof r === "string" && KNOWN.has(r) ? (r as AdminFailure) : "unavailable";
};

const base = (cfg: AdminConfig) => cfg.url.replace(/\/+$/, "");
const headers = (cfg: AdminConfig, json = false): Record<string, string> => ({
  apikey: cfg.serviceKey,
  authorization: `Bearer ${cfg.serviceKey}`,
  accept: "application/json",
  ...(json ? { "content-type": "application/json" } : {}),
});

async function rpc(cfg: AdminConfig, fn: string, args: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(cfg, true),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
    cache: "no-store",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** Calls a database function that answers {ok, reason}; never leaks the cause of a network error. */
async function call<T>(cfg: AdminConfig | null, fn: string, args: Record<string, unknown>, pick: (json: Record<string, unknown>) => T): Promise<AdminResult<T>> {
  if (!cfg) return fail("not_configured");
  try {
    const r = await rpc(cfg, fn, args);
    if (r.status !== 200 || typeof r.json !== "object" || r.json === null) return fail("unavailable");
    const j = r.json as Record<string, unknown>;
    return j.ok === true ? { ok: true, value: pick(j) } : fail(reasonOf(j));
  } catch {
    return fail("unavailable");
  }
}

// ---------------------------------------------------------------------------
// Supabase Auth admin API (emails, ban). Needs the service key.
// ---------------------------------------------------------------------------
export interface AuthAdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  /** Has a confirmed authenticator app (two-step sign-in is on). */
  mfa: boolean;
  /** Every factor id, confirmed or not (used by "reset two-step sign-in"). */
  factorIds: string[];
}

function toAuthAdminUser(u: Record<string, unknown>): AuthAdminUser | null {
  if (typeof u.id !== "string" || typeof u.email !== "string") return null;
  const bannedUntil = typeof u.banned_until === "string" ? Date.parse(u.banned_until) : NaN;
  const factors = (Array.isArray(u.factors) ? u.factors : []) as Record<string, unknown>[];
  return {
    mfa: factors.some((f) => f?.factor_type === "totp" && f?.status === "verified"),
    factorIds: factors.flatMap((f) => (typeof f?.id === "string" ? [f.id] : [])),
    id: u.id,
    email: u.email,
    createdAt: typeof u.created_at === "string" ? u.created_at : "",
    lastSignInAt: typeof u.last_sign_in_at === "string" ? u.last_sign_in_at : null,
    banned: Number.isFinite(bannedUntil) && bannedUntil > Date.now(),
  };
}

/** Up to `max` accounts, newest first. Enough for the MVP; a search endpoint replaces this once there are thousands. */
export async function listAuthUsers(cfg: AdminConfig, max = 1000): Promise<AuthAdminUser[] | null> {
  const perPage = 200;
  const out: AuthAdminUser[] = [];
  try {
    for (let page = 1; out.length < max; page++) {
      const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
        headers: headers(cfg),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { users?: Record<string, unknown>[] } | null;
      const rows = (json?.users ?? []).map(toAuthAdminUser).filter((u): u is AuthAdminUser => u !== null);
      out.push(...rows);
      if ((json?.users ?? []).length < perPage) break;
    }
  } catch {
    return null;
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max);
}

export async function getAuthUser(cfg: AdminConfig, id: string): Promise<AuthAdminUser | null> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
      cache: "no-store",
    });
    return res.ok ? toAuthAdminUser((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Blocks (or allows) new sign-ins and token refreshes. Existing access tokens still work until they expire (at most an hour). */
async function setBan(cfg: AdminConfig, id: string, banned: boolean): Promise<boolean> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: headers(cfg, true),
      body: JSON.stringify({ ban_duration: banned ? "876000h" : "none" }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// What the screens use
// ---------------------------------------------------------------------------
export interface UserFacts {
  id: string;
  displayName: string;
  createdAt: string;
  roles: string[];
  status: "active" | "suspended";
  isMaster: boolean;
}
export interface AdminUserRow extends UserFacts {
  email: string;
  lastSignInAt: string | null;
  /** Two-step sign-in is on. */
  mfa: boolean;
}
export interface ProgressSummary {
  enrolments: number;
  stepsCompleted: number;
  assessmentAttempts: number;
  exerciseAttempts: number;
}

const toFacts = (u: unknown): UserFacts | null => {
  const o = u as Record<string, unknown> | null;
  if (!o || typeof o.id !== "string") return null;
  return {
    id: o.id,
    displayName: typeof o.displayName === "string" ? o.displayName : "",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    roles: Array.isArray(o.roles) ? o.roles.map(String) : [],
    status: o.status === "suspended" ? "suspended" : "active",
    isMaster: o.isMaster === true,
  };
};

/** Is this verified user an active admin? Asked of the database, not guessed from the session. */
export async function actorFacts(cfg: AdminConfig | null, actorId: string): Promise<AdminResult<UserFacts>> {
  const r = await call(cfg, "fd_admin_user_facts", { p_actor: actorId, p_ids: [actorId] }, (j) => toFacts((j.users as unknown[])[0]));
  if (!r.ok) return r;
  return r.value ? { ok: true, value: r.value } : fail("forbidden");
}

export const PAGE_SIZE = 25;

export interface UserPage {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
}

export async function listUsers(cfg: AdminConfig | null, actorId: string, query: string, page: number): Promise<AdminResult<UserPage>> {
  if (!cfg) return fail("not_configured");
  const auth = await listAuthUsers(cfg);
  if (!auth) return fail("unavailable");
  const q = query.trim().toLowerCase();
  const wanted = auth.filter((u) => !q || u.email.toLowerCase().includes(q) || u.id.startsWith(q));
  const pages = Math.max(1, Math.ceil(wanted.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const slice = wanted.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const facts = await call(cfg, "fd_admin_user_facts", { p_actor: actorId, p_ids: slice.map((u) => u.id) }, (j) =>
    (j.users as unknown[]).map(toFacts).filter((f): f is UserFacts => f !== null),
  );
  if (!facts.ok) return facts;
  const byId = new Map(facts.value.map((f) => [f.id, f]));
  const rows: AdminUserRow[] = slice.flatMap((u) => {
    const f = byId.get(u.id);
    return f ? [{ ...f, email: u.email, lastSignInAt: u.lastSignInAt, mfa: u.mfa }] : [];
  });
  return { ok: true, value: { rows, total: wanted.length, page: p, pages } };
}

export async function userDetail(
  cfg: AdminConfig | null,
  actorId: string,
  targetId: string,
): Promise<AdminResult<{ user: AdminUserRow; summary: ProgressSummary }>> {
  const r = await call(cfg, "fd_admin_user_detail", { p_actor: actorId, p_target: targetId }, (j) => j);
  if (!r.ok) return r;
  if (!cfg) return fail("not_configured");
  const facts = toFacts(r.value.user);
  const au = await getAuthUser(cfg, targetId);
  if (!facts || !au) return fail("unavailable");
  const s = (r.value.summary ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
  return {
    ok: true,
    value: {
      user: { ...facts, email: au.email, lastSignInAt: au.lastSignInAt, mfa: au.mfa },
      summary: { enrolments: n("enrolments"), stepsCompleted: n("stepsCompleted"), assessmentAttempts: n("assessmentAttempts"), exerciseAttempts: n("exerciseAttempts") },
    },
  };
}

export function setRoles(cfg: AdminConfig | null, actorId: string, targetId: string, roles: string[], reason: string | null): Promise<AdminResult<string[]>> {
  return call(cfg, "fd_admin_set_roles", { p_actor: actorId, p_target: targetId, p_roles: roles, p_reason: reason }, (j) => (Array.isArray(j.roles) ? j.roles.map(String) : []));
}

export function setName(cfg: AdminConfig | null, actorId: string, targetId: string, name: string): Promise<AdminResult<true>> {
  return call(cfg, "fd_admin_set_name", { p_actor: actorId, p_target: targetId, p_name: name }, () => true as const);
}

/** Database first (it is the authority and writes the audit entry), then Supabase Auth. A failed ban is reported, not hidden. */
export async function setStatus(
  cfg: AdminConfig | null,
  actorId: string,
  targetId: string,
  status: "active" | "suspended",
  reason: string | null,
): Promise<AdminResult<"active" | "suspended">> {
  const r = await call(cfg, "fd_admin_set_status", { p_actor: actorId, p_target: targetId, p_status: status, p_reason: reason }, () => status);
  if (!r.ok || !cfg) return r;
  const done = await setBan(cfg, targetId, status === "suspended");
  return done ? r : { ...r, warning: "Status saved, but Supabase Auth did not confirm the sign-in block. Try the same action again." };
}

/** Emails the person a one-time reset link. The admin never sees a password, a link or a code. */
export async function sendResetLink(cfg: AdminConfig | null, authCfg: AuthConfig, actorId: string, targetId: string, origin: string): Promise<AdminResult<true>> {
  if (!cfg) return fail("not_configured");
  const au = await getAuthUser(cfg, targetId);
  if (!au) return fail("unknown_user");
  const verifier = newVerifier();
  const begun = await call(cfg, "fd_admin_reset_begin", { p_actor: actorId, p_target: targetId, p_verifier: verifier }, (j) => String(j.rid ?? ""));
  if (!begun.ok) return begun;
  if (!begun.value) return fail("unavailable");
  const sent = await requestPasswordReset(authCfg, au.email, `${origin}/auth/callback?rid=${encodeURIComponent(begun.value)}`, await challengeFor(verifier));
  if (!sent.ok) return fail(sent.reason === "rate_limited" ? "rate_limited" : "unavailable");
  return { ok: true, value: true };
}

/**
 * Lost phone: removes the person's authenticator factors so they can set up again (ADR-010). The database says yes
 * first (active admin, not self, not master) and writes the audit entry; a failed removal is reported, not hidden.
 */
export async function resetMfa(cfg: AdminConfig | null, actorId: string, targetId: string): Promise<AdminResult<true>> {
  const ok = await call(cfg, "fd_admin_mfa_reset", { p_actor: actorId, p_target: targetId }, () => true as const);
  if (!ok.ok || !cfg) return ok;
  const au = await getAuthUser(cfg, targetId);
  if (!au) return fail("unknown_user");
  let failed = 0;
  for (const fid of au.factorIds) {
    try {
      const res = await (cfg.fetch ?? fetch)(`${base(cfg)}/auth/v1/admin/users/${encodeURIComponent(targetId)}/factors/${encodeURIComponent(fid)}`, {
        method: "DELETE",
        headers: headers(cfg),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
        cache: "no-store",
      });
      if (!res.ok) failed++;
    } catch {
      failed++;
    }
  }
  return failed ? { ok: true, value: true, warning: "Some factors could not be removed. Try again." } : ok;
}

// ---------------------------------------------------------------------------
// Mission access (ADR-011): free tier, availability switch, per-learner unlocks
// ---------------------------------------------------------------------------
export interface MissionAccessRow {
  slug: string;
  title: string;
  position: number;
  course: string;
  isFree: boolean;
  isEnabled: boolean;
  /** Learners this mission is unlocked for by hand. */
  unlocks: number;
}

const toMissionRow = (u: unknown): MissionAccessRow | null => {
  const o = u as Record<string, unknown> | null;
  if (!o || typeof o.slug !== "string") return null;
  return {
    slug: o.slug,
    title: typeof o.title === "string" ? o.title : o.slug,
    position: typeof o.position === "number" ? o.position : 0,
    course: typeof o.course === "string" ? o.course : "",
    isFree: o.isFree === true,
    isEnabled: o.isEnabled !== false,
    unlocks: typeof o.unlocks === "number" ? o.unlocks : 0,
  };
};

export function listMissionAccess(cfg: AdminConfig | null, actorId: string): Promise<AdminResult<MissionAccessRow[]>> {
  return call(cfg, "fd_admin_mission_list", { p_actor: actorId }, (j) => (Array.isArray(j.missions) ? j.missions.map(toMissionRow).filter((m): m is MissionAccessRow => m !== null) : []));
}

export function setMissionAccess(cfg: AdminConfig | null, actorId: string, slug: string, isFree: boolean, isEnabled: boolean): Promise<AdminResult<true>> {
  return call(cfg, "fd_admin_set_mission", { p_actor: actorId, p_slug: slug, p_free: isFree, p_enabled: isEnabled }, () => true as const);
}

export function userUnlocks(cfg: AdminConfig | null, actorId: string, targetId: string): Promise<AdminResult<string[]>> {
  return call(cfg, "fd_admin_user_unlocks", { p_actor: actorId, p_target: targetId }, (j) => (Array.isArray(j.slugs) ? j.slugs.filter((s): s is string => typeof s === "string") : []));
}

/** Grants or removes unlocks, in batches of 60 (the database limit per call). */
export async function setUnlocks(cfg: AdminConfig | null, actorId: string, targetId: string, slugs: string[], grant: boolean): Promise<AdminResult<number>> {
  let changed = 0;
  for (let i = 0; i < slugs.length; i += 60) {
    const r = await call(cfg, "fd_admin_set_unlocks", { p_actor: actorId, p_target: targetId, p_slugs: slugs.slice(i, i + 60), p_grant: grant }, (j) => (typeof j.changed === "number" ? j.changed : 0));
    if (!r.ok) return r;
    changed += r.value;
  }
  return { ok: true, value: changed };
}

/** Used by /auth/callback when the link carries ?rid= : the verifier is returned once, then deleted. */
export async function takeResetVerifier(cfg: AdminConfig | null, rid: string): Promise<string | null> {
  if (!cfg || !/^[0-9a-f-]{36}$/i.test(rid)) return null;
  try {
    const r = await rpc(cfg, "fd_reset_handoff_take", { p_rid: rid });
    return r.status === 200 && typeof r.json === "string" ? r.json : null;
  } catch {
    return null;
  }
}

export const FAILURE_TEXT: Record<AdminFailure, string> = {
  forbidden: "You do not have permission to do that.",
  unknown_user: "That account was not found.",
  master_protected: "The master admin account cannot be changed here.",
  self_change: "You cannot change your own roles, status or password from the dashboard.",
  invalid_role: "That role is not valid.",
  invalid_status: "That status is not valid.",
  invalid_name: "Enter a name of 1 to 80 characters.",
  invalid_request: "We could not process that request.",
  too_many: "A reset link was already sent three times in the last hour. Wait before sending another.",
  rate_limited: "The email service is rate-limited right now. Wait a few minutes and try again.",
  not_configured: "Administration is not switched on for this server.",
  unavailable: "The service is temporarily unavailable. Try again shortly.",
};
