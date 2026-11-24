// SERVER-ONLY. Activity log (ADR-012): who signed in and which days they came back. Records WHO and WHEN only:
// no pages, answers, IP addresses or device details. Uses the SERVICE ROLE key through database functions.
//
// Recording must NEVER get in the way of the learner: every call here is best-effort, short-timed, and swallows
// its own failures (returns false). Nothing in the app waits on it beyond ~1.5 seconds, and nothing depends on it.

import type { AccessConfig } from "./access";
import { accessConfig } from "./access";

export type SignInMethod = "password" | "google" | "signup";

const TIMEOUT_MS = 1500;

async function send(cfg: AccessConfig, fn: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { ok?: unknown } | null;
    return out?.ok === true;
  } catch {
    return false;
  }
}

/** A person just signed in with the given method. userId must come from a token Supabase issued. */
export async function recordSignIn(userId: string | null, method: SignInMethod, cfg: AccessConfig | null = accessConfig()): Promise<boolean> {
  if (!cfg || !userId) return false;
  return send(cfg, "fd_activity_sign_in", { p_user: userId, p_method: method });
}

/** A signed-in person viewed a page. userId must be the VERIFIED session user. */
export async function touchVisit(userId: string | null, cfg: AccessConfig | null = accessConfig()): Promise<boolean> {
  if (!cfg || !userId) return false;
  return send(cfg, "fd_activity_touch", { p_user: userId });
}

// ---------------------------------------------------------------------------
// Admin views
// ---------------------------------------------------------------------------
export interface ActivityDay {
  day: string;
  activeUsers: number;
  signIns: number;
  visits: number;
}
export interface ActiveUser {
  userId: string;
  daysActive: number;
  signIns: number;
  visits: number;
  lastSeen: string;
}
export interface ActivityOverview {
  days: ActivityDay[];
  activeUsers: number;
  signIns: number;
  totalUsers: number;
  topUsers: ActiveUser[];
}
export interface UserActivity {
  signIns7: number;
  signIns30: number;
  daysActive30: number;
  firstSeen: string | null;
  lastSeen: string | null;
  recent: { at: string; method: string }[];
  daily: { day: string; visits: number; signIns: number }[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

async function ask(cfg: AccessConfig, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const out = (await res.json()) as Record<string, unknown> | null;
    return out && out.ok === true ? out : null;
  } catch {
    return null;
  }
}

/** Null when it could not be read (the page then says so; it never shows made-up zeros). */
export async function activityOverview(adminId: string, days: number, cfg: AccessConfig | null = accessConfig()): Promise<ActivityOverview | null> {
  if (!cfg) return null;
  const o = await ask(cfg, "fd_admin_activity_overview", { p_actor: adminId, p_days: days });
  if (!o) return null;
  return {
    days: rows(o.days).map((d) => ({ day: str(d.day), activeUsers: num(d.activeUsers), signIns: num(d.signIns), visits: num(d.visits) })),
    activeUsers: num(o.activeUsers),
    signIns: num(o.signIns),
    totalUsers: num(o.totalUsers),
    topUsers: rows(o.topUsers).map((u) => ({ userId: str(u.userId), daysActive: num(u.daysActive), signIns: num(u.signIns), visits: num(u.visits), lastSeen: str(u.lastSeen) })),
  };
}

export async function userActivity(adminId: string, userId: string, cfg: AccessConfig | null = accessConfig()): Promise<UserActivity | null> {
  if (!cfg) return null;
  const o = await ask(cfg, "fd_admin_user_activity", { p_actor: adminId, p_target: userId });
  if (!o) return null;
  return {
    signIns7: num(o.signIns7),
    signIns30: num(o.signIns30),
    daysActive30: num(o.daysActive30),
    firstSeen: typeof o.firstSeen === "string" ? o.firstSeen : null,
    lastSeen: typeof o.lastSeen === "string" ? o.lastSeen : null,
    recent: rows(o.recent).map((r) => ({ at: str(r.at), method: str(r.method) })),
    daily: rows(o.daily).map((d) => ({ day: str(d.day), visits: num(d.visits), signIns: num(d.signIns) })),
  };
}

// ---------------------------------------------------------------------------
// Learning evidence (stage 2): active time per mission and fast-pass review flags
// ---------------------------------------------------------------------------
/** The learner was active on a mission for about `seconds`. The database credits time no faster than the clock runs. */
export async function recordBeat(userId: string | null, slug: string, seconds: number, cfg: AccessConfig | null = accessConfig()): Promise<boolean> {
  if (!cfg || !userId || !slug || slug.length > 120) return false;
  return send(cfg, "fd_activity_heartbeat", { p_user: userId, p_slug: slug, p_seconds: Math.round(seconds) });
}

export interface ReviewFlag {
  userId: string;
  slug: string;
  score: number;
  gradedAt: string;
  seconds: number;
  reason: "no_time" | "fast";
}
export interface ReviewFlags {
  trackingSince: string | null;
  minSeconds: number;
  flags: ReviewFlag[];
}

export async function reviewFlags(adminId: string, days: number, minSeconds: number, cfg: AccessConfig | null = accessConfig()): Promise<ReviewFlags | null> {
  if (!cfg) return null;
  const o = await ask(cfg, "fd_admin_review_flags", { p_actor: adminId, p_days: days, p_min_seconds: minSeconds });
  if (!o) return null;
  return {
    trackingSince: typeof o.trackingSince === "string" ? o.trackingSince : null,
    minSeconds: num(o.minSeconds),
    flags: rows(o.flags).flatMap((f) =>
      typeof f.userId === "string" && typeof f.slug === "string"
        ? [{ userId: f.userId, slug: f.slug, score: num(f.score), gradedAt: str(f.gradedAt), seconds: num(f.seconds), reason: f.reason === "fast" ? ("fast" as const) : ("no_time" as const) }]
        : [],
    ),
  };
}

export interface MissionTime {
  slug: string;
  seconds: number;
  days: number;
  lastDay: string;
}

export async function userMissionTime(adminId: string, userId: string, cfg: AccessConfig | null = accessConfig()): Promise<MissionTime[] | null> {
  if (!cfg) return null;
  const o = await ask(cfg, "fd_admin_user_mission_time", { p_actor: adminId, p_target: userId });
  if (!o) return null;
  return rows(o.missions).map((m) => ({ slug: str(m.slug), seconds: num(m.seconds), days: num(m.days), lastDay: str(m.lastDay) }));
}

/** 754 -> "12 min" ; 40 -> "40 s". */
export function minutesText(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
