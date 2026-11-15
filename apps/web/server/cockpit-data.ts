// SERVER-ONLY. Reads the signed-in learner's OWN saved progress with their own access token and the
// public anon key: Row Level Security returns only their rows (no service key needed for reads).
import type { SavedProgress } from "@/lib/cockpit";

export interface ReadConfig {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
/** PostgREST returns an embedded to-one row as an object; tolerate a one-element array too. */
const one = (v: unknown): Row => (Array.isArray(v) ? obj(v[0]) : obj(v));

export function parseProgress(steps: Row[], attempts: Row[]): SavedProgress {
  return {
    steps: steps
      .map((r) => ({ missionSlug: str(one(one(r.mission_steps).missions).slug), kind: str(one(r.mission_steps).kind), at: str(r.completed_at) }))
      .filter((s) => s.missionSlug && s.kind && s.at),
    attempts: attempts
      .map((r) => ({
        missionSlug: str(one(r.assessments).slug).replace(/-assessment$/, ""),
        passed: r.passed === true,
        score: Number(r.score),
        at: str(r.graded_at),
      }))
      .filter((a) => a.missionSlug && a.at && Number.isFinite(a.score)),
  };
}

/** The learner's saved progress, or null when it could not be read (callers then show an empty start). */
export async function getOwnProgress(cfg: ReadConfig, accessToken: string): Promise<SavedProgress | null> {
  try {
    const get = async (path: string) => {
      const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/${path}`, {
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
        cache: "no-store",
      });
      return res.ok ? ((await res.json()) as Row[]) : null;
    };
    const [steps, attempts] = await Promise.all([
      get("step_progress?select=completed_at,mission_steps(kind,missions(slug))&status=eq.completed&order=completed_at.desc&limit=1000"),
      get("assessment_attempts?select=score,passed,graded_at,assessments(slug)&status=eq.graded&order=graded_at.desc&limit=200"),
    ]);
    if (!steps || !attempts) return null;
    return parseProgress(steps, attempts);
  } catch {
    return null;
  }
}
