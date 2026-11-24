// SERVER-ONLY. Certificate exams (ADR-016, stage 3). The pure part (plan building, grading, what the browser may see)
// is separate from the database part so it can be tested without a server. The answer key lives only in the stored
// plan (app_private, service_role) and never leaves the server: the browser gets `publicView` only.
// Rules: the clock, tries, cooldown, hint budget and certificate issuing are enforced in the database (migration
// 20261125000100). Failed attempts reveal only the topics to revisit, never the right answers.
import { gradeNumericAnswer } from "@flightdeck/math";
import type { ExcelAnswerKeyItem, ExcelAssessmentItem, ExcelMission, ExcelMissionKeys } from "../components/excel/missions";
import { adminConfig, type AdminConfig } from "./admin/admin";
import { contentGrading, publishedSummaries } from "./content-db";
import { getBuiltInExcel, EXCEL_ASSESSMENT_SLUGS } from "./excel-assessment";
import { progressConfig } from "./progress";

export type ExamLevel = "beginner" | "intermediate" | "advanced";
export const EXAM_LEVELS: ExamLevel[] = ["beginner", "intermediate", "advanced"];
export const isExamLevel = (v: unknown): v is ExamLevel => typeof v === "string" && (EXAM_LEVELS as string[]).includes(v);
export const LEVEL_LABEL: Record<ExamLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export interface PoolItem {
  slug: string;
  code: string;
  title: string;
  item: ExcelAssessmentItem;
  key: ExcelAnswerKeyItem;
}
export interface PlanTask {
  slug: string;
  code: string;
  title: string;
  itemId: string;
  type: "numeric" | "single-choice";
  prompt: string;
  options?: { id: string; label: string }[];
  /** numeric: the author's hint text; single-choice: two wrong options a hint removes. */
  hintText?: string;
  dropOptions?: string[];
  key: { correctOptionId: string } | { expected: number; tolerance: { kind: "absolute"; value: number } };
}
/** The name printed on the certificate, as the learner typed it (letters, spaces and . ' - only, 2-80 characters). */
export const cleanHolder = (s: string): string => s.replace(/[^\p{L}\p{M}\s.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
export const validHolder = (s: string): boolean => cleanHolder(s).length >= 2;

export interface Plan {
  v: 1;
  seed: string;
  holder?: string;
  tasks: PlanTask[];
}

// ---- seeded randomness (so a plan is reproducible from its seed, and different per attempt) ----
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(xs: readonly T[], seed: string): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Picks `count` questions from the pool: spread over as many different missions as possible, then shuffled. */
export function buildPlan(pool: PoolItem[], count: number, seed: string): Plan {
  const bySlug = new Map<string, PoolItem[]>();
  for (const p of shuffled(pool, `${seed}:pool`)) bySlug.set(p.slug, [...(bySlug.get(p.slug) ?? []), p]);
  const rounds: PoolItem[] = [];
  const queues = shuffled([...bySlug.values()], `${seed}:slugs`);
  for (let round = 0; rounds.length < pool.length; round++) {
    let added = false;
    for (const q of queues) if (q[round]) { rounds.push(q[round]!); added = true; }
    if (!added) break;
  }
  const chosen = shuffled(rounds.slice(0, Math.max(0, count)), `${seed}:order`);
  const tasks: PlanTask[] = chosen.map((p, i) => {
    const base = { slug: p.slug, code: p.code, title: p.title, itemId: p.item.id, prompt: p.item.prompt };
    if (p.item.type === "single-choice" && p.key.type === "single-choice") {
      const options = shuffled(p.item.options, `${seed}:opt:${i}`);
      const correctId = p.key.correctOptionId;
      const wrong = options.filter((o) => o.id !== correctId).map((o) => o.id);
      return { ...base, type: "single-choice", options, dropOptions: wrong.slice(0, Math.max(0, Math.min(2, wrong.length - 1))), key: { correctOptionId: p.key.correctOptionId } };
    }
    if (p.item.type === "numeric" && p.key.type === "numeric") {
      return { ...base, type: "numeric", ...(p.item.answerHint ? { hintText: p.item.answerHint } : {}), key: { expected: p.key.expected, tolerance: p.key.tolerance } };
    }
    throw new Error(`item ${p.item.id} does not match its key`);
  });
  return { v: 1, seed, tasks };
}

export interface HintLogEntry { task: number; hint: number }
export interface PublicTask {
  index: number;
  type: "numeric" | "single-choice";
  prompt: string;
  options?: { id: string; label: string }[];
  hintAvailable: boolean;
  /** Present only for hints the learner has already paid for. */
  hint?: { text?: string; dropOptions?: string[] };
}
export const hintAvailableFor = (t: PlanTask): boolean => (t.type === "single-choice" ? (t.dropOptions?.length ?? 0) > 0 : Boolean(t.hintText));
export const hintPayload = (t: PlanTask) => (t.type === "single-choice" ? { dropOptions: t.dropOptions ?? [] } : { text: t.hintText ?? "" });

/** What the browser may see: prompts and options only. No key, no mission code or title, no hint text unless it was paid for. */
export function publicView(plan: Plan, hintLog: HintLogEntry[]): PublicTask[] {
  const paid = new Set(hintLog.map((h) => h.task));
  return plan.tasks.map((t, index) => ({
    index,
    type: t.type,
    prompt: t.prompt,
    ...(t.options ? { options: t.options } : {}),
    hintAvailable: hintAvailableFor(t),
    ...(paid.has(index) && hintAvailableFor(t) ? { hint: hintPayload(t) } : {}),
  }));
}

export interface ExamResult {
  passed: boolean;
  /** Percentage 0-100. */
  score: number;
  correct: number;
  total: number;
  /** Missions to go back to. Never the questions or answers. */
  topics: { code: string; title: string }[];
}

const MAX_ANSWER = 64;
/** Grades answers keyed by task index ("0", "1", ...). Pure; the database refuses late results separately. */
export function gradePlan(plan: Plan, answers: Record<string, unknown>, passPct: number): ExamResult {
  let correct = 0;
  const missed = new Map<string, string>();
  plan.tasks.forEach((t, i) => {
    const raw = Object.hasOwn(answers, String(i)) ? answers[String(i)] : undefined;
    const answer = typeof raw === "string" ? raw.trim().slice(0, MAX_ANSWER) : "";
    let ok = false;
    if (answer !== "") {
      if ("correctOptionId" in t.key) ok = answer === t.key.correctOptionId;
      else ok = gradeNumericAnswer({ expected: t.key.expected, tolerance: t.key.tolerance, answer }).correct === true;
    }
    if (ok) correct++;
    else missed.set(t.code, t.title);
  });
  const total = plan.tasks.length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 10000) / 100;
  return { passed: total > 0 && score >= passPct - 1e-9, score, correct, total, topics: [...missed].map(([code, title]) => ({ code, title })).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })) };
}

/** Soft integrity signals for reviewers. Nothing here fails an attempt by itself. */
export function integrityFlags(input: { seconds: number; limitSeconds: number; blurs?: unknown; pastes?: unknown; total: number }): Record<string, number | boolean> {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(10000, Math.floor(v))) : 0);
  const flags: Record<string, number | boolean> = { seconds: Math.round(input.seconds), blurs: n(input.blurs), pastes: n(input.pastes) };
  if (input.total > 0 && input.seconds < input.total * 8) flags.veryFast = true;
  if (n(input.blurs) >= 10) flags.manyTabSwitches = true;
  if (n(input.pastes) >= 3) flags.manyPastes = true;
  return flags;
}

// ---- pool (published questions for a level) ----
const toPool = (mission: ExcelMission, keys: ExcelMissionKeys): PoolItem[] => {
  const byId = new Map(keys.items.map((k) => [k.id, k]));
  return mission.assessment.items.flatMap((item) => {
    const key = byId.get(item.id);
    return key && key.type === item.type ? [{ slug: mission.slug, code: mission.code, title: mission.title, item, key }] : [];
  });
};

/** All assessment questions of a level's published Excel missions (database first, built-in files as fallback). */
export async function loadPool(level: ExamLevel): Promise<PoolItem[]> {
  const cfg = progressConfig();
  const summaries = await publishedSummaries(cfg);
  let slugs: string[];
  if (summaries) slugs = summaries.filter((s) => s.track === "excel" && s.level === level).map((s) => s.slug);
  else slugs = EXCEL_ASSESSMENT_SLUGS.filter((s) => getBuiltInExcel(s)?.mission.level === level);
  const parts = await Promise.all(
    slugs.map(async (slug) => {
      const db = await contentGrading(null, slug, cfg);
      const src = db ?? getBuiltInExcel(slug);
      return src ? toPool(src.mission, src.keys) : [];
    }),
  );
  return parts.flat();
}

// ---- database calls ----
export type ExamFailure =
  | "signed_out" | "not_found" | "disabled" | "already_certified" | "open_attempt" | "no_tries_left" | "cooldown" | "no_hints_left"
  | "closed" | "time_up" | "invalid_request" | "forbidden" | "not_configured" | "unavailable" | "not_enough_questions";
export type ExamCall<T> = ({ ok: true } & T) | { ok: false; reason: ExamFailure; nextAllowedAt?: string; attemptId?: string };

export const EXAM_FAILURE_TEXT: Record<ExamFailure, string> = {
  signed_out: "Please sign in first.",
  not_found: "That exam could not be found.",
  disabled: "This exam is not open right now.",
  already_certified: "You already hold this certificate.",
  open_attempt: "You already have an attempt in progress.",
  no_tries_left: "You have used all your tries for this level.",
  cooldown: "You need to wait before the next try.",
  no_hints_left: "You have no hints left.",
  closed: "This attempt is already finished.",
  time_up: "Time is up for this attempt.",
  invalid_request: "Something in the request was not valid.",
  forbidden: "You do not have permission to do that.",
  not_configured: "Exams are not switched on for this server.",
  unavailable: "Exams could not be reached just now. Please try again.",
  not_enough_questions: "This level does not have enough questions yet.",
};
const KNOWN = new Set<string>(Object.keys(EXAM_FAILURE_TEXT));

export const examConfig = adminConfig;

export async function examCall<T = Record<string, unknown>>(cfg: AdminConfig | null, fn: string, args: Record<string, unknown>): Promise<ExamCall<T>> {
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
    if (j.ok === true) return j as unknown as ExamCall<T>;
    return {
      ok: false,
      reason: typeof j.reason === "string" && KNOWN.has(j.reason) ? (j.reason as ExamFailure) : "unavailable",
      ...(typeof j.nextAllowedAt === "string" ? { nextAllowedAt: j.nextAllowedAt } : {}),
      ...(typeof j.attemptId === "string" ? { attemptId: j.attemptId } : {}),
    };
  } catch {
    return { ok: false, reason: "unavailable" }; // never leak the cause (it could contain the host name)
  }
}

export interface ExamState {
  config: { enabled: boolean; minutes: number; maxHints: number; maxAttempts: number; cooldownHours: number; passPct: number; sheetTasks: number; questions: number };
  used: number;
  triesLeft: number;
  nextAllowedAt: string | null;
  openAttemptId: string | null;
  openDeadline: string | null;
  certificate: { number: string; issuedAt: string } | null;
  now: string;
}
export const examState = (cfg: AdminConfig | null, userId: string, level: ExamLevel) => examCall<ExamState>(cfg, "fd_exam_state", { p_user: userId, p_level: level });

/** Starts an attempt: builds the plan from the live pool with a fresh seed, then lets the database apply the rules. */
export async function startExam(cfg: AdminConfig | null, userId: string, level: ExamLevel, state: ExamState, holder: string): Promise<ExamCall<{ attemptId: string }>> {
  const pool = await loadPool(level);
  const count = Math.min(state.config.questions, pool.length);
  if (count < Math.max(1, Math.min(state.config.questions, 3))) return { ok: false, reason: "not_enough_questions" };
  const seed = `${userId}:${level}:${state.used + 1}:${crypto.randomUUID()}`;
  return examCall(cfg, "fd_exam_start", { p_user: userId, p_level: level, p_plan: { ...buildPlan(pool, count, seed), holder: cleanHolder(holder) } });
}

export interface AttemptRow {
  id: string;
  level: ExamLevel;
  attemptNo: number;
  status: "in_progress" | "passed" | "failed" | "expired";
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  secondsLeft: number;
  now: string;
  plan: Plan;
  answers: Record<string, unknown>;
  hintsUsed: number;
  maxHints: number;
  hintLog: HintLogEntry[];
  result: (ExamResult & { late?: boolean }) | null;
  passPct: number;
}
export const getAttempt = (cfg: AdminConfig | null, userId: string, attemptId: string) => examCall<AttemptRow>(cfg, "fd_exam_get", { p_user: userId, p_attempt: attemptId });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
