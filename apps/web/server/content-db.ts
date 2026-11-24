// SERVER-ONLY. Reads published mission content from the database (ADR-015, stage 2b) through the four
// service_role-only functions in migration 20261124001800. Rules:
//   - import only from route handlers / server components, never from components/ or "use client" files
//     (the same key-leak guards as progress.ts apply; this module can return answer keys);
//   - every call is best-effort: on any failure (no key, timeout, error) it returns null and the caller falls back
//     to the built-in files, so a database problem never takes the platform down;
//   - the user id must come from the verified session, never from the request.
import type { ExerciseDefinition, ExerciseKey } from "@flightdeck/excel-engine";
import type { ExcelMission, ExcelMissionKeys } from "../components/excel/missions";
import { progressConfig, type ProgressConfig } from "./progress";

export interface PublishedSummary {
  slug: string;
  revision: number;
  track: "excel" | "math";
  code: string;
  title: string;
  level: "beginner" | "intermediate" | "advanced";
  summary: string;
  estimatedMinutes: number;
}
export interface LearnerContent {
  revision: number;
  track: "excel" | "math";
  level: PublishedSummary["level"];
  mission: ExcelMission;
  exercise: ExerciseDefinition;
}
export interface GradingContent {
  revision: number;
  mission: ExcelMission;
  keys: ExcelMissionKeys;
}
export interface ExerciseGrading {
  /** The mission that owns this exercise, so access rules can be applied. */
  slug: string;
  exercise: ExerciseDefinition;
  key: ExerciseKey;
}

const TIMEOUT_MS = 1500;
const SUMMARY_TTL_MS = 30_000;
const SLUG = /^[a-z0-9-]{2,64}$/;

async function rpc<T>(cfg: ProgressConfig | null, fn: string, args: Record<string, unknown>): Promise<T | null> {
  if (!cfg) return null;
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // never leak the cause (it could contain the host name)
  }
}

interface Ok {
  ok?: unknown;
}
const isOk = (v: unknown): v is Ok & Record<string, unknown> => typeof v === "object" && v !== null && (v as Ok).ok === true;

let summaryCache: { at: number; value: PublishedSummary[] } | null = null;

/** Published missions for the catalogue (no documents, no keys). Cached for 30 s; null when the database is unreachable. */
export async function publishedSummaries(cfg: ProgressConfig | null = progressConfig(), now: number = Date.now()): Promise<PublishedSummary[] | null> {
  const useCache = !cfg?.fetch; // tests inject a fetch and must always see a fresh call
  if (useCache && summaryCache && now - summaryCache.at < SUMMARY_TTL_MS) return summaryCache.value;
  const rows = await rpc<unknown>(cfg, "fd_content_published_summary", {});
  if (!Array.isArray(rows)) return summaryCache && now - summaryCache.at < SUMMARY_TTL_MS * 10 ? summaryCache.value : null;
  const value = rows.filter((r): r is PublishedSummary => typeof r === "object" && r !== null && SLUG.test(String((r as { slug?: unknown }).slug)));
  if (useCache) summaryCache = { at: now, value };
  return value;
}

/** Learner-safe mission + exercise. With `pin`, a signed-in learner is pinned to the revision they first open. */
export async function contentForLearner(userId: string | null, slug: string, pin: boolean, cfg: ProgressConfig | null = progressConfig()): Promise<LearnerContent | null> {
  if (!SLUG.test(slug)) return null;
  const r = await rpc<unknown>(cfg, "fd_content_for_learner", { p_user: userId, p_slug: slug, p_pin: pin });
  if (!isOk(r)) return null;
  return { revision: Number(r.revision), track: r.track as LearnerContent["track"], level: r.level as LearnerContent["level"], mission: r.mission as ExcelMission, exercise: r.exercise as ExerciseDefinition };
}

/** Assessment keys from the learner's pinned revision (else the published one). */
export async function contentGrading(userId: string | null, slug: string, cfg: ProgressConfig | null = progressConfig()): Promise<GradingContent | null> {
  if (!SLUG.test(slug)) return null;
  const r = await rpc<unknown>(cfg, "fd_content_grading", { p_user: userId, p_slug: slug });
  if (!isOk(r)) return null;
  return { revision: Number(r.revision), mission: r.mission as ExcelMission, keys: r.keys as ExcelMissionKeys };
}

/** Exercise + answer key for the live simulation check. */
export async function contentExercise(id: string, cfg: ProgressConfig | null = progressConfig()): Promise<ExerciseGrading | null> {
  if (!SLUG.test(id)) return null;
  const r = await rpc<unknown>(cfg, "fd_content_exercise", { p_exercise_id: id });
  if (!isOk(r)) return null;
  return { slug: String(r.slug), exercise: r.exercise as ExerciseDefinition, key: r.exerciseKey as ExerciseKey };
}
