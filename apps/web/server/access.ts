// SERVER-ONLY. Mission access (ADR-011): free tier, availability switch and per-learner unlocks.
// Uses the SERVICE ROLE key through one database function, so import it only from server components, server
// actions and route handlers. The user id must be the VERIFIED session user (or null for a signed-out visitor).
//
// Fail-closed: if the database cannot be asked, a mission is NOT opened ("error"), so an outage can never hand out
// paid content. The one exception is a server with no service key at all (local development without secrets).

export type MissionAccess = "open" | "locked" | "disabled" | "unknown" | "error";

export interface AccessConfig {
  url: string;
  serviceKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** null when the server has no service key (access control is then off, for local development only). */
export function accessConfig(): AccessConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
}

const KNOWN: ReadonlySet<string> = new Set(["open", "locked", "disabled", "unknown"]);

async function rpc(cfg: AccessConfig, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 5000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("rpc");
  return res.json();
}

export async function missionAccess(cfg: AccessConfig | null, userId: string | null, slug: string): Promise<MissionAccess> {
  if (!cfg) return "open";
  try {
    const out = await rpc(cfg, "fd_mission_access", { p_user: userId, p_slug: slug });
    return typeof out === "string" && KNOWN.has(out) ? (out as MissionAccess) : "error";
  } catch {
    return "error";
  }
}

export interface AccessSummary {
  /** Admin, author or reviewer: every enabled mission is open. */
  staff: boolean;
  free: string[];
  disabled: string[];
  unlocked: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Null when it could not be read (the page then shows no badges and the server still enforces on open). */
export async function accessSummary(cfg: AccessConfig | null, userId: string | null): Promise<AccessSummary | null> {
  if (!cfg) return null;
  try {
    const o = (await rpc(cfg, "fd_access_summary", { p_user: userId })) as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return null;
    return { staff: o.staff === true, free: strings(o.free), disabled: strings(o.disabled), unlocked: strings(o.unlocked) };
  } catch {
    return null;
  }
}

/** Same rule as the database check, for hiding closed missions in lists. (The server still enforces on open.) */
export function isOpenFor(s: AccessSummary, slug: string): boolean {
  if (s.disabled.includes(slug)) return false;
  return s.staff || s.free.includes(slug) || s.unlocked.includes(slug);
}

/** Why a mission is closed, in words for the learner. */
export function accessMessage(a: Exclude<MissionAccess, "open">): { title: string; body: string } {
  switch (a) {
    case "locked":
      return { title: "This mission is not unlocked for your account yet", body: "The free missions are open to everyone. Ask your instructor or the FlightDeck team to unlock this one for you." };
    case "disabled":
      return { title: "This mission is switched off for now", body: "It is being updated and will return soon." };
    case "unknown":
      return { title: "Mission not found", body: "That mission does not exist." };
    case "error":
      return { title: "We could not check your access", body: "The service is temporarily unavailable. Try again shortly." };
  }
}
