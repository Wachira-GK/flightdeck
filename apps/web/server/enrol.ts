// SERVER-ONLY. Enrolment: writing goes through the service_role-only fd_enrol (migration 20261125000600; the user id comes
// from the verified session, never the browser); reading uses the learner's own token and row-level security.
import type { ReadConfig } from "./cockpit-data";
import type { ProgressConfig } from "./progress";

export type EnrolResult = { ok: true; already: boolean; course: string } | { ok: false; reason: string };

export async function enrolInCourse(cfg: ProgressConfig | null, userId: string, courseSlug: string): Promise<EnrolResult> {
  if (!cfg) return { ok: false, reason: "not_configured" };
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/fd_enrol`, {
      method: "POST",
      headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_user: userId, p_course_slug: courseSlug }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 5000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "error" };
    const j = (await res.json()) as { ok?: unknown; already?: unknown; course?: unknown; reason?: unknown } | null;
    if (j?.ok === true) return { ok: true, already: j.already === true, course: typeof j.course === "string" ? j.course : "" };
    return { ok: false, reason: typeof j?.reason === "string" ? j.reason : "error" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type EnrolState = { count: number; slugs: string[] };

/** The signed-in learner's own enrolments, or null when they could not be read. */
export async function getOwnEnrolments(cfg: ReadConfig, accessToken: string): Promise<EnrolState | null> {
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/enrolments?select=courses(slug)&limit=100`, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 4000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    const slugs = rows.flatMap((r) => {
      const c = (r as { courses?: unknown }).courses;
      const one = Array.isArray(c) ? c[0] : c;
      const s = (one as { slug?: unknown } | null | undefined)?.slug;
      return typeof s === "string" ? [s] : [];
    });
    return { count: rows.length, slugs };
  } catch {
    return null;
  }
}
