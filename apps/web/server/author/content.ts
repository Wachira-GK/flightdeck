// SERVER-ONLY. Author / reviewer operations (ADR-015) through the service_role-only fd_content_* functions.
// Uses the SERVICE ROLE key, so: import only from server components and server actions; the actor id must be the
// VERIFIED session user; every rule (who may save, submit, review, retire) is enforced again inside the database.
import type { ExerciseDefinition } from "@flightdeck/excel-engine";
import type { ExcelMission, ExcelMissionKeys } from "../../components/excel/missions";
import { adminConfig, type AdminConfig } from "../admin/admin";
import type { BuiltContent, StoredExerciseKey } from "./convert";

export type ContentFailure =
  | "forbidden"
  | "not_found"
  | "not_yours"
  | "in_review_locked"
  | "not_a_draft"
  | "not_in_review"
  | "own_work"
  | "not_published"
  | "invalid_request"
  | "not_configured"
  | "unavailable";

export const CONTENT_FAILURE_TEXT: Record<ContentFailure, string> = {
  forbidden: "You do not have permission to do that.",
  not_found: "That mission could not be found.",
  not_yours: "Another author owns this draft.",
  in_review_locked: "This mission is waiting for review, so it cannot be edited. Withdraw it first.",
  not_a_draft: "Only a draft can be sent for review.",
  not_in_review: "That revision is not waiting for review.",
  own_work: "You cannot review your own work. Another reviewer or admin must do it.",
  not_published: "That mission is not published.",
  invalid_request: "Something in the request was not valid.",
  not_configured: "The content workspace is not switched on for this server.",
  unavailable: "The content workspace could not be reached just now. Please try again.",
};
const KNOWN = new Set<string>(Object.keys(CONTENT_FAILURE_TEXT));

export type ContentResult<T> = { ok: true; value: T } | { ok: false; reason: ContentFailure };

export type ContentStatus = "draft" | "in_review" | "published" | "retired";
export const STATUS_LABEL: Record<ContentStatus, string> = { draft: "Draft", in_review: "Waiting for review", published: "Live", retired: "Retired" };
export interface ContentSummary {
  slug: string;
  revision: number;
  status: ContentStatus;
  track: "excel" | "math";
  code: string;
  title: string;
  level: string;
  authorId: string | null;
  reviewerId: string | null;
  changeNote: string | null;
  reviewNote: string | null;
  liveSynced: boolean;
  updatedAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  mine: boolean;
}
export interface ContentFull extends ContentSummary {
  mission: ExcelMission;
  exercise: ExerciseDefinition | null;
  keys: ExcelMissionKeys;
  exerciseKey: StoredExerciseKey | null;
}
export type ContentRole = "admin" | "reviewer" | "author";
export interface ContentAccess {
  canWrite: boolean;
  canReview: boolean;
}

export const contentConfig = adminConfig;

async function call<T>(cfg: AdminConfig | null, fn: string, args: Record<string, unknown>, pick: (j: Record<string, unknown>) => T): Promise<ContentResult<T>> {
  if (!cfg) return { ok: false, reason: "not_configured" };
  try {
    const res = await (cfg.fetch ?? fetch)(`${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status !== 200 || !j || typeof j !== "object") return { ok: false, reason: "unavailable" };
    if (j.ok === true) return { ok: true, value: pick(j) };
    return { ok: false, reason: typeof j.reason === "string" && KNOWN.has(j.reason) ? (j.reason as ContentFailure) : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" }; // never leak the cause (it could contain the host name)
  }
}

export const listContent = (cfg: AdminConfig | null, actor: string) =>
  call(cfg, "fd_content_list", { p_actor: actor }, (j) => ({
    role: j.role as ContentRole,
    canWrite: j.canWrite === true,
    canReview: j.canReview === true,
    items: (j.items ?? []) as ContentSummary[],
  }));

export const getContent = (cfg: AdminConfig | null, actor: string, slug: string, revision: number | null) =>
  call(cfg, "fd_content_get", { p_actor: actor, p_slug: slug, p_revision: revision }, (j) => j.item as ContentFull);

export const saveDraft = (cfg: AdminConfig | null, actor: string, built: BuiltContent, changeNote: string) =>
  call(
    cfg,
    "fd_content_save",
    {
      p_actor: actor,
      p_slug: built.mission.slug,
      p_track: "excel",
      p_level: built.mission.level,
      p_mission: built.mission,
      p_exercise: built.exercise,
      p_keys: built.keys,
      p_exercise_key: built.exerciseKey,
      p_change_note: changeNote.slice(0, 500) || null,
    },
    (j) => ({ revision: Number(j.revision) }),
  );

export const submitDraft = (cfg: AdminConfig | null, actor: string, slug: string, revision: number) =>
  call(cfg, "fd_content_submit", { p_actor: actor, p_slug: slug, p_revision: revision }, () => true);

export const withdrawDraft = (cfg: AdminConfig | null, actor: string, slug: string, revision: number) =>
  call(cfg, "fd_content_withdraw", { p_actor: actor, p_slug: slug, p_revision: revision }, () => true);

export const reviewContent = (cfg: AdminConfig | null, actor: string, slug: string, revision: number, decision: "publish" | "return", note: string) =>
  call(cfg, "fd_content_review", { p_actor: actor, p_slug: slug, p_revision: revision, p_decision: decision, p_note: note.slice(0, 1000) || null }, () => true);

export const retireContent = (cfg: AdminConfig | null, actor: string, slug: string) =>
  call(cfg, "fd_content_retire", { p_actor: actor, p_slug: slug }, () => true);

/** Which revision to open in the editor: the open draft or returned draft first, else the newest. */
export function editableRevision(items: ContentSummary[], slug: string): ContentSummary | undefined {
  const rows = items.filter((i) => i.slug === slug).sort((a, b) => b.revision - a.revision);
  return rows.find((r) => r.status === "draft" || r.status === "in_review") ?? rows[0];
}
